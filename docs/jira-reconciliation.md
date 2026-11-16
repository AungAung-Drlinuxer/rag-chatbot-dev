# Jira Reconciliation — keeping the mirror in sync with Jira

`jira_tickets` is a **mirror** of Jira. A row is created when a ticket is filed, and the status is
refreshed every time the list is read. But there is no way to learn that **an issue was deleted in
Jira** — a deleted ticket keeps showing on the board.

Reconciliation closes that gap: every key in the mirror is queried against Jira and corrected to match.

## 1. Three possible decisions

| Jira's answer | Action |
|---|---|
| **404** (issue no longer exists) | set `status='deleted'` + `remote_missing_at` on the row → hide it from the board (do not delete the row — it records that an escalation happened) |
| **200 + status** | adopt the canonical status (`open \| pending \| resolved \| closed`); revive it if it was previously `deleted` |
| timeout / 401 / 500 / not configured | **do nothing** — a Jira outage is not a deleted ticket |

The last point matters most: if an outage were allowed to wipe the board, that would be data
loss. So only a 404 is treated as a delete.

## 2. When it runs

- **Nightly 03:15 UTC** — Celery beat (`reconcile-jira` → `workers.sync_tasks.reconcile_jira`)
- **Manual** — the **Reconcile** button on the Tickets page (admin/agent), or
  `POST /api/tickets/reconcile?limit=200`

Use manual when you want the board cleared immediately after an issue is deleted in Jira.
The nightly run checks up to 500 keys; manual defaults to 200.

## 3. How to verify

```bash
# is the nightly schedule present?
kubectl -n rag-chatbot-dev exec deploy/celery-beat -- \
  python -c "from workers.celery_app import celery_app; print(celery_app.conf.beat_schedule['reconcile-jira'])"

# run it yourself (from inside the backend pod)
kubectl -n rag-chatbot-dev exec -i deploy/backend -- python - <<'PY'
from app.integrations.jira_reconcile import reconcile_jira
print(reconcile_jira(limit=200))
PY
# → {"checked": 4, "missing": 0, "updated": 0, "revived": 0, "unreachable": 0, ...}

# what is marked deleted in the DB
kubectl -n rag-chatbot-dev exec postgres-dev-1 -- psql -U postgres -d assistant -c \
  "SELECT jira_key, status, remote_missing_at FROM jira_tickets WHERE status='deleted';"
```

## 4. Code

- `backend/app/integrations/jira_reconcile.py` — `decide()` (pure rules) + `reconcile_jira()`
- `backend/app/integrations/jira.py::fetch_issue_status` — returns a 404 as `missing: True`
- `backend/workers/sync_tasks.py` — `reconcile_jira_task`
- `backend/workers/celery_app.py` — beat schedule
- `backend/app/api/tickets.py` — `list_tickets` excludes `deleted`; `POST /api/tickets/reconcile`
- `frontend/src/features/tickets` — **Reconcile** button (shows the result in a toast)

## 5. Things to watch

- A ticket **deleted in Jira** and one whose **archive/permission changed** can both return 404 in
  Jira. So the row is not deleted but marked `deleted` — it can be revived if needed.
- Without Jira credentials `unreachable` increases and nothing changes; check Jira first in
  Settings → Integrations.
- Above 500 keys the nightly run checks only the first 500 — to raise `limit`, edit
  `reconcile_jira_task`.
