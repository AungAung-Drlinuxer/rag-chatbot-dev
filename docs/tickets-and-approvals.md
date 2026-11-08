# Tickets from chat, and the approval queue (HITL)

## One create form

`Create Jira ticket` in a chat answer opens the **same** dialog as `Create ticket` on the
Tickets page (`features/tickets/components/CreateTicketDialog.tsx`). The chat only presets two
fields — the user's question as the subject, the answer as the description — and passes the
session id, so the issue stays linked to the conversation.

Fields: Subject · Description (+ AI assist) · Category · Priority · Assignee · Due date ·
Attachments. Destination is always Jira; the dialog says so, and says when Jira is not
configured instead of failing at submit time.

Why one component: the chat used to have its own two-field dialog (priority pinned to
`medium`, domain `general`, no assignee/due date/attachments), so the same button produced a
weaker ticket depending on where it was pressed.

## Human in the loop

The escalation is not created silently. When an answer needs a human decision — an explicit
"create a ticket" intent, or `auto_escalate_on_caution` on a low-confidence answer — the
LangGraph pauses at its approval node (`app/graph_rag.py`) and writes an `approvals` row.

```
chat answer → graph interrupt → approvals row (pending)
                                   ↓
              bell notification → Tickets → "Awaiting your decision"
                                   ↓
              Approve → graph resumes → create_ticket node → Jira issue
              Reject  → graph resumes → no ticket
```

The queue is `features/tickets/components/ApprovalQueue.tsx`, rendered on the Tickets page for
administrators only (the API refuses everyone else). It calls `PUT /api/approvals/{id}` with
`approved` / `rejected`; **it never calls the ticket API** — the issue is created by the
graph's `create_ticket` node, so a decision cannot produce two tickets.

The requester can also send `cancelled` to supersede their own escalation with a direct form
submission (no graph resume, so no duplicate).

## Checking it end to end

```bash
# Ask for a ticket in the chat UI, then:
kubectl -n rag-chatbot-dev exec postgres-dev-1 -c postgres -- \
  psql -U postgres -d assistant -c \
  "select id, username, status, created_at from approvals order by created_at desc limit 5;"
```

The Tickets page shows the same row under **Awaiting your decision**. Approving logs
`approval resumed: approved=true` in the backend log and stores the Jira key on the row.

## Status model — Jira's own workflow

The board shows exactly the statuses the ITHD project runs, no invented ones:

| Board | Jira | Terminal |
|---|---|---|
| Open | OPEN (also To Do / Backlog) | no |
| Pending | PENDING / Waiting for customer | no |
| In progress | WORK IN PROGRESS | no |
| Done | DONE | **yes** |
| Reopened | REOPENED | no |

Rules enforced by `app/integrations/ticket_status.py`:

- `resolved` and `closed` were invented here; they are read as `done` and migrated to `done`
  on start-up (idempotent `UPDATE … WHERE status IN ('resolved','closed')`).
- A status change is pushed to Jira **before** the local row is written. A refusal returns
  `409` with Jira's own reason and changes nothing, so the board cannot claim a state Jira
  never accepted.
- Asking for the status an issue already has is an accepted no-op.
- If a transition lands next to what was asked (from `DONE` the only exit is *Reopen issue*,
  which produces `REOPENED`), the stored status is re-read from Jira rather than assumed.
- An unknown Jira status falls back to `open`.

## One save: status + comment

The workflow rail selects a step; it no longer fires a transition on click. The note field and
the step are submitted together (`PUT /api/tickets/{ref}` with `status` and `comment`), so the
explanation can never be forgotten as a "second step". Order of operations:

1. transition pushed to Jira — a refusal is `409` and nothing is written locally,
2. comment posted to the issue (`comment_synced` reports it),
3. the local mirror and its activity log updated.

## Attachments

`POST /api/tickets/{ref}/attachments` uploads to the Jira issue **first** (multipart with
`X-Atlassian-Token: no-check`, required by Jira's XSRF guard) and only then records the row in
`ticket_attachments`. A Jira refusal is a `502` with Jira's reason — an attachment that exists
only inside this app is invisible to the person working the ticket. Files are capped at 8 MB;
nginx accepts up to 12 MB because the payload is base64 (4/3 of the file).

## Category → assignees

`domain_assignees` maps a category to app groups and/or users (Domains → **Assignees**).
`GET /api/tickets/assignees?domain=<key>` expands groups through `app_group_members`, so the
create dialog offers the network team for a network ticket and preselects its first person.
No mapping means no restriction: the whole assignable directory is offered and
`configured: false` says so. Jira takes an `accountId`, so the chosen username is resolved
through `assignable/search` and the issue is assigned after creation.
