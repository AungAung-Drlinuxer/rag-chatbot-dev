# Confluence KB and Jira Tickets — preparation & setup guide

In this app the two Atlassian products work as follows:

| Integration | Direction | Where in the app |
| --- | --- | --- |
| **Confluence** | **Input** — pages are chunked → embedded → pgvector → answer source | Knowledge page, Chat citations |
| **Jira** | **Output + read-back** — create escalation tickets, transition status, comment, pull existing tickets | Tickets page, Chat escalation |

Jira is based on **ticket existence** — without credentials no mock key is issued; an error is shown.
Confluence likewise pulls **real pages only** — there is no sample data.

---

# Part 1 — Confluence (Knowledge Base input)

## 1.1 Preparation on the Atlassian side

Create a **dedicated service account** (do not use an individual's token) —
`svc-chatbot@your-domain.com`. This prevents users from being logged out when the token is rotated.

| Task | Where | Note |
| --- | --- | --- |
| Create API token | https://id.atlassian.com/manage-profile/security/api-tokens | Prefer a **Classic token** (Basic auth is required). For a scoped token, add `read:confluence-content.all` + `read:confluence-space.summary` |
| Space permission | Space settings → Permissions | Give the service account **Can view**, only on the spaces it needs (do not grant all) |
| Page restrictions | page → ⋯ → Restrictions | Pages the chatbot must read should carry no restriction — if restricted, CQL will not return them |
| Labels | page → ⋯ → Labels | Apply labels according to the label rule below |

### Label rule (as the app actually enforces it)

```cql
space = "HELP" AND type = page
AND label = "approved"
AND label = "chatbot-safe"
AND label != "restricted"
AND label != "internal-only"
AND label != "on-call"
```

- A page is ingested only if it has **both `approved` and `chatbot-safe`**
- If `restricted` / `internal-only` / `on-call` is applied, the page is skipped even when both are present
- To try a new space on the first run, set the env `CONFLUENCE_SKIP_LABEL_FILTER=1` and test
  (but do not leave it set in production)

Paste the CQL above directly into Atlassian search and first check **which pages are included**.
If it returns 0, the app will also get 0.

### Content quality (for answer quality)

- **One page = one topic**. Split pages that are too long
- **Write the title as a question** ("What do I do if VPN won't connect") — the title is included in the chunk
- Images/attachments/macros are not read (HTML → text only); tables are included as text
- Code blocks are included as plain text — indentation may be lost, so use step-by-step wording where needed
- Include a date/owner — this makes later maintenance easier

## 1.2 Entering it in the app

**Settings → Integrations → Confluence**

| Field | Example | Note |
| --- | --- | --- |
| Base URL | `https://your-domain.atlassian.net/wiki` | Include up to `/wiki` (Cloud) |
| Account Email | `svc-chatbot@your-domain.com` | the account that created the token |
| API Token | `ATATT3xFfGF0...` | **write-only** — not displayed again after saving |
| Space Keys | `HELP, IT, ENG` | comma-separated, including the first/last space |

Save, then click **Test connection** — the app calls `GET /rest/api/content?limit=1`
with Basic auth. `200` means connected.

> **What changed (backend `dev-1.0.5`)**: previously Confluence sync read only env vars
> (`CONFLUENCE_*`) — values entered in the UI did not work. It now reads the DB (`system_settings`)
> first, with env as fallback only. So what you enter in the UI actually works.

## 1.3 Running a sync

**Knowledge → Sync from Confluence** (API: `POST /api/articles/sync`, admin/agent)

Flow: fetch page → HTML→text → chunk → **embed** → store in `langchain_pg_embedding` →
record the hash in `kb_meta`. If the page is unchanged the hash matches and it is **skipped** (not re-embedded).

**Requirement**: embeddings come from **Ollama** (`OLLAMA_URL`, default
`http://localhost:11434`, model `nomic-embed-text`). If Ollama is unreachable, sync produces no vectors
and no answers are produced — configuring the AI service (chat) alone is not enough.

```bash
# check from the backend pod in the cluster
kubectl -n rag-chatbot-dev exec deploy/backend -- \
  python -c "import httpx,os;from app.config import SETTINGS as s;print(httpx.get(s.ollama_url+'/api/tags',timeout=5).status_code)"
```

## 1.4 Domain mapping (important)

During ingest a page is first assigned a domain from the **space key (lowercase)**; the
classifier then switches it to the real domain if it matches an existing domain rule.

Therefore the domains must already exist in **Domains & Routing** — otherwise articles stay
in a placeholder domain such as `help`/`it` and chat retrieval filters will not find them.

## 1.5 Verify

- Knowledge page: are total / per-domain counts increasing
- `GET /api/articles-list?domain=<domain>` → are titles returned
- `GET /api/sync-status` → last sync stats (`pages/inserted/updated/skipped`)
- A `sync` event in the audit log
- DB checks:
  ```sql
  SELECT count(*), count(DISTINCT domain) FROM kb_meta;
  SELECT count(*) FROM langchain_pg_embedding;
  SELECT domain, count(*) FROM kb_meta GROUP BY 1 ORDER BY 2 DESC;
  ```
- Ask one question in Chat → does the citation point to the relevant page

## 1.6 Troubleshooting (Confluence)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Test → `401` | a scoped token is being used with Basic auth | Create a Classic API token (or check the email is correct) |
| Test → `403` | the service account has no space access | Space permissions → Can view |
| Test `200` but sync `pages=0` | label rule not matched / wrong space key in CQL | Try the CQL directly in Atlassian search |
| Some pages missing | page restriction / wrong label | Remove restrictions, set labels `approved`+`chatbot-safe` |
| `pages>0` but `inserted=0` | identical hash (unchanged) | Normal — `updated` only appears after the page is edited |
| Embedding error / timeout | Ollama unreachable, model not pulled | `ollama pull nomic-embed-text`, check `OLLAMA_URL` |
| Chat finds nothing after sync | stuck in a placeholder domain | Create the domain in Domains & Routing → re-sync/reclassify |
| Confluence **Server/DC** | PAT + `/wiki` path differ | Do not append `https://confluence.corp/rest/api` to the Base URL — enter the host only, use Basic auth |

---

# Part 2 — Jira (ticket output)

## 2.1 Preparation on the Atlassian side

| Task | Where | Note |
| --- | --- | --- |
| service account | Jira admin | `svc-chatbot@...` — appears as the reporter |
| API token | id.atlassian.com → API tokens | Classic token |
| Project | Project settings | note the key (e.g. `ITHD`) |
| Permissions | Project → Permissions | **Browse Projects**, **Create Issues**, **Transition Issues**, **Add Comments**, **Create Attachments** |
| Issue type | Project settings → Issue types | the fallback path hardcodes **`Task`** — if the project has no Task, create it (or use the JSM path) |
| Required fields | Project settings → Fields | if a company-managed project requires a custom field, the fallback path returns `400` → use a JSM request type |

### Should you use JSM (Jira Service Management)?

- The **JSM request** path is more suitable for creating customer-facing tickets; the request type
  fills in the fields automatically
- Required: `serviceDeskId` + `requestTypeId` (can be split per domain)
- These two settings can be entered directly in **Settings → Integrations → Jira**
  (no env needed, stored in the DB):
  - **Service Desk ID (JSM, optional)** — e.g. `12`
  - **Request Type IDs by domain (optional)** — JSON map:
    `{"server": "101", "network": "102", "general": "100"}`
- If you do not know the IDs, use the app's discovery endpoint (admin) — it fetches them
  with the stored credentials:

```bash
curl -s -H "Authorization: Bearer <app-token>" \
  https://<chatbot-host>/api/settings/integrations/jira/service-desks
curl -s -H "Authorization: Bearer <app-token>" \
  https://<chatbot-host>/api/settings/integrations/jira/service-desks/12/request-types
```

(or directly against Jira:)

```bash
curl -s -u "$EMAIL:$TOKEN" https://your-domain.atlassian.net/rest/servicedeskapi/servicedesk | jq '.values[] | {id, projectKey}'
curl -s -u "$EMAIL:$TOKEN" https://your-domain.atlassian.net/rest/servicedeskapi/servicedesk/<ID>/requesttype | jq '.values[] | {id, name}'
```

- On save the app validates the shape — a non-numeric desk id or invalid JSON
  returns `400` (so the failure does not surface only when a ticket is created)
- The `domain` key falls back to `general`. If it is absent the app
  falls back to `POST /rest/api/3/issue` (Task, project key).

### Workflow transitions

The app's four statuses (`open | pending | resolved | closed`) are matched against the Jira transition
**name** (first match wins):

| App status | Transition names searched |
| --- | --- |
| `open` | Reopen, Re-open, To Do, Open, Backlog, Pending |
| `pending` | Start progress, Start Progress, In Progress, Pending |
| `resolved` | Mark as done, Done, Resolve Issue, Resolve |
| `closed` | Close Issue, Close, Mark as done, Done |

If no name matches, the app **does not change anything** and returns the list of available
transitions (`no matching transition for 'pending' (available: [...])`). Adjust the workflow to
match these names (or change the app).

## 2.2 Entering it in the app

**Settings → Integrations → Jira**

| Field | Example |
| --- | --- |
| Base URL | `https://your-domain.atlassian.net` |
| Account Email | `svc-chatbot@your-domain.com` |
| API Token | `ATATT3xFfGF0...` (write-only) |
| Default Project Key | `ITHD` |
| Service Desk ID (JSM, optional) | `12` |
| Request Type IDs by domain (optional) | `{"server": "101", "general": "100"}` |

Save → **Test connection** (`GET /rest/api/3/myself` → `200` means connected).

## 2.3 Ticket operations

| Operation | How | API |
| --- | --- | --- |
| Chat escalation → ticket | escalate in Chat | JSM/issue REST |
| Create a new ticket | Tickets → Create support ticket | `POST /api/tickets` |
| Pull from Jira | Tickets → Sync from Jira | `POST /api/tickets/jira/sync` (idempotent) |
| Change status | Tickets → workflow step | `PUT /api/tickets/{ref}` → Jira transitions |
| Comment | Ticket detail | `POST /api/tickets/{ref}/comments` |
| Attach a file | Ticket detail | `POST /api/tickets/{ref}/attachments` |

When pulling, `jira_key` (ITHD-123) is used as the key — on a later run it does not
create, it only updates. Jira status names are mapped back to the four canonical ones
(`ticket_status.canonical_from_jira_status`).

## 2.4 Verify

- Do Jira keys appear on the Tickets page (there must be no mock `ESC-xxxx`)
- Does the ticket really exist in Jira (click the link)
- Change the status — did it change in the Jira UI
- Do comments/attachments also appear in Jira
- DB:
  ```sql
  SELECT jira_key, status, created_by FROM jira_tickets ORDER BY created_at DESC LIMIT 5;
  ```

## 2.5 Troubleshooting (Jira)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Test `401` | wrong token/email (or a scoped token that Basic auth rejects) | recreate a Classic token |
| `403` on create | no Create Issues permission | Project permissions |
| `400 issuetype` | the project has no `Task` | create a Task (or use a JSM request type) |
| `400 customfield required` | company-managed required field | use a JSM request type (fields are automatic) |
| `404 project` | wrong project key / archived | check in Project settings |
| Ticket created but status not changed | transition name not matched | check the available list in the error detail → fix the workflow |
| Pull `total=0` | no JSM, wrong project key, permission | check the `fetch_all_tickets` log, verify the project key |
| `429` | rate limit | wait a little, do not run sync repeatedly |

---

# Part 3 — Security & Operations

- Tokens are stored in the **database (`system_settings`)**; the API is **write-only** (returns a mask only)
- Rotating a token: paste the new token in the field → Save (if left empty the old one keeps being used)
- Deleting an integration: `DELETE /api/settings/integrations/<key>?confirm=<key>` — irreversible
- Least privilege: read access only to the spaces needed, Jira only for a single project
- Audit log: `sync`, ticket create/update and settings changes are recorded
- Backup: DB backups include the tokens — protect the backup as a credential
- **There is no automatic sync** — currently manual (Knowledge → Sync); a cron job can be added if needed

## One-time setup checklist

**Confluence**
- [ ] service account + Classic API token
- [ ] space Can view permission
- [ ] page labels: `approved` + `chatbot-safe` (remove restricted/internal-only/on-call)
- [ ] test the CQL in Atlassian search (must not return 0)
- [ ] Settings → Integrations → Confluence → Test 200
- [ ] domains already exist in Domains & Routing
- [ ] Knowledge → Sync → insert count > 0
- [ ] ask a question in Chat → citation is correct

**Jira**
- [ ] service account + Classic API token
- [ ] Project key + Browse/Create/Transition/Comment/Attachment permissions
- [ ] issue type `Task` exists (or JSM serviceDeskId + requestTypeId)
- [ ] workflow transition names match
- [ ] Settings → Integrations → Jira → Test 200
- [ ] Tickets → Create support ticket → appears in Jira
- [ ] change status → changes in Jira
- [ ] Sync from Jira → existing tickets are pulled in

## Not included in this version

- Reading Confluence attachments/images (text only)
- Writing articles back to Confluence (read only; the write path exists in code but the UI does not expose it)
- Per-space credential separation (single account only)
- Jira custom required field mapping (resolve via JSM request type)
- Selecting the service desk / request type from dropdowns in the Jira panel (currently a JSON field)
- Scheduled sync (manual only)

## The "configured but not connected" situation

Confluence/Jira are stored **per site** (`integration_connections`). On an installation where the legacy
single-site row (`system_settings.confluence|jira`) has been deleted, if any of the three places below
still read the legacy row, "not connected" is reported incorrectly.

| Symptom | Root cause | Fix already in place |
|---|---|---|
| In Settings, "Finish setting up" shows "No document source connected" / "Jira not connected" | `/api/setup/readiness` only checks legacy config | site rows are counted too · `199 articles · 8 domains · 1 site` |
| Tickets → "Sync from Jira" → `No tickets returned` | `fetch_all_tickets()` reads `_jira_cfg()` without binding the connection | binds per site and merges (`updated 12`) |
| Knowledge → Sync → 409 "already running" (permanently) | the deploy replaced the pod mid-run, so the `kb_sync_run` marker stayed at `running` | runs older than 30 minutes are marked `stale` and a new sync is allowed |
| Overview's SERVICE STATUS shows "Confluence sync" / "Jira" in red (Down) | `/api/dashboard/health` only checks the legacy token | site rows are counted too; a healthy row shows "1 site" |
| The Create/Edit ticket dialog says "Jira offline" but the ticket really reached Jira | `/api/ticket-destinations` reads legacy config | it now also checks `effective_connections("jira")` → "Connected to Jira" / "Jira synced" |
| A comment written in the app does not appear on the Jira ticket | `add_comment()` reads legacy config → "Jira is not configured", leaving only a toast | site fallback (dev-1.0.114) + `ticket_comments.jira_synced` → "Local only" pill + "Send to Jira" + admin repair endpoint |
| After adding 2 sites the first one disappears / only one site shows | the backend keeps `(provider, base_url)` unique → the same URL does not insert a new row, it **overwrites** the existing one (old spaces/token lost, articles deleted on the next sync) | the unique key became `(provider, base_url, label)` (dev-1.0.118) → the same URL with a different label can hold two bindings side by side. The dialog now warns when the URL is duplicated |
| Test reports "1 pages visible" | `size` in `/rest/api/content` is the number of response rows (we only request 1) | reads the space list and reports "3 spaces visible · not listed: …" |

So whether something is "connected" is answered by the **Test** button (per site, with that site's token)
and by `Finish setting up` — it may differ from what the catalogue shows as "In use".

### How to tell and fix it when a comment does not reach Jira

- `ticket_comments.jira_synced` is **true / false / null** — false means "it exists only in this app".
- In Ticket → Edit → **Activity**, under that comment a **"Local only"** pill + **"Send to Jira"** appear.
- To resend all of them instead of one at a time: `POST /api/ticket-comments/sync-pending` (admin) —
  identical bodies are skipped, so running it twice creates no duplicates.
- An internal note reaches Jira with a role visibility. If the API account is not in the "Service Desk Team"
  role, Jira picks "Administrators" — that has to be filled in on the Jira admin side
  (not in code).

## Two sources on a single-site Atlassian account

One Confluence **site** can hold many spaces. To have two sources there are two approaches:

1. **One site, all spaces** — write `AEC, IHKB, HELP, IT` comma-separated in a single row. This is the simplest and uses a single token.
2. **Two bindings, split spaces** — keep two rows: `AI Engineer Course` (AEC) and `HQ Confluence` (IHKB, HELP, IT). The same URL is allowed (since dev-1.0.118); the labels must differ.

For both approaches, enter them in Settings → Integrations → Confluence → Configure and click **Sync now**. The **Sources** card on the Knowledge page shows the number of configured sites (even before any article is ingested), and the **Site** filter lets you view each site separately.

> Caution: on deletion during sync (since dev-1.0.119) — deletion only happens within the (binding, space) **fetched in this run**. If a space key is removed from the config, that space's articles remain in the KB (not deleted), but if the page is actually deleted in Confluence it will be deleted. There used to be a bug where changing the config deleted the articles of all other spaces. If you delete a space key by accident, that space's articles disappear — re-add it and press Sync now and they come back.

## Ticket fields: what actually reaches Jira

A ticket created from the chat or from the Tickets page is now a Jira issue with the fields the
create screen shows, not just a summary and a description.

| Field | Where it comes from | What Jira gets |
|---|---|---|
| Summary | the draft / the form | `summary` (110 characters, enforced) |
| Description | the draft / the form | `description` as ADF paragraphs |
| Priority | the draft (`low…critical`) or the form | `priority` mapped to Jira's names (`critical` → **Highest**) |
| Category | the routing domain | project + issue type; the label is stored here |
| Assignee | the form, or the category's first owner | `assignee`, only if Jira resolves the account |
| Labels | the draft or the form | `labels` (free form, any string) |
| Components | **the form only** | `components` by name — must already exist in the project |
| Original estimate | the draft or the form | `timetracking.originalEstimate` in `w/d/h/m` |
| Due date | the draft or the form | `duedate` |

How it is applied: JSM's request API (`/rest/servicedeskapi/request`) accepts a summary and a
description and little else, so the issue is created there and the remaining fields are written
with a follow-up `PUT /rest/api/3/issue/{key}`. That PUT is **best-effort per field**: if the
project has no such component, or time tracking is switched off, Jira's refusal is returned as a
`field_warnings` entry and the other fields still land. The ticket is never lost to a bad field.

The draft endpoint never invents a component — a name the project has not defined would fail on
every create. Labels are free form, so the model may propose those.
