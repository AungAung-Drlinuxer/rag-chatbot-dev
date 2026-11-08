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
