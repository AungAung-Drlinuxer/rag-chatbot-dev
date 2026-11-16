# Setting up a fresh database

This guide is for another team that wants to stand this application up with its own new
database. It is written against a PostgreSQL 16 + pgvector install measured on this repository:
a fresh `--init` produces **34 tables / 51 indexes**, and the first knowledge-base ingest adds
the two LangChain tables (+9 indexes), giving **36 tables / 60 indexes**. **No data is
included** — schema only.

---

## 1. Prerequisites

| Component | Version | Note |
| --- | --- | --- |
| PostgreSQL | **16** | can be a CNPG/cluster or managed Postgres |
| pgvector | **0.8.x** (>= 0.5 works) | `langchain_pg_embedding.embedding` uses the `vector` type |
| Database | new, empty | `--init` runs `CREATE DATABASE assistant OWNER app` automatically |
| App credentials | non-superuser role | only the extension is created with the superuser |

Do **not** give the application role superuser.

> So that everything works on the first attempt — the bundled CloudNativePG cluster creates
> `CREATE EXTENSION vector` automatically as superuser via `postInitApplicationSQL`
> (`infra/k8s-dev/20-database.yaml`). The manual step described below is only needed when using
> **external PostgreSQL**. In that case the one-time superuser requirement for `CREATE EXTENSION vector`
> is handled by `BOOTSTRAP_SUPERUSER_URL`: point it at any database the superuser can log into
> (usually `/postgres`) and the bootstrap retargets it to the application's database before
> creating the extension.

---

## 2. What the schema contains (reference)

The full schema is stored here — `backend/db/schema.sql` (a production-shaped dump produced with
`pg_dump -s -O -x`, without data).

| Group | Tables | Purpose |
| --- | --- | --- |
| Identity & access | `users`, `local_user_credentials`, `user_settings`, `user_permission_overrides`, `app_groups`, `app_group_members`, `rbac_matrix`, `api_keys` | login, role, permission, API key |
| Chat | `chat_sessions`, `chat_messages`, `chat_attachments`, `feedback` | conversation + transcript + attachment + rating |
| Knowledge | `kb_meta`, `langchain_pg_collection`, `langchain_pg_embedding` (HNSW index) | article metadata + chunk vectors |
| Domains & routing | `classifier_domains` | domain → team routing |
| Tickets | `jira_tickets`, `ticket_comments`, `ticket_attachments` | Jira-bound tickets |
| Approvals / audit | `approvals`, `audit_log` | human-in-the-loop + activity trail |
| Settings | `system_settings` (LLM/integrations/SMTP/security key), `runtime_kv` | admin-configurable state |
| Orchestration | `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` | LangGraph state |
| Graph RAG | `semantica_entities`, `semantica_relations` | (optional) knowledge graph |

Two counts are correct, depending on when you look:

| Moment | Tables | Indexes | Why |
| --- | --- | --- | --- |
| immediately after `--init` | **34** | **51** | schema + migrations + the four LangGraph checkpoint tables |
| after the first KB ingest | **36** | **60** | LangChain creates `langchain_pg_collection` and `langchain_pg_embedding`, plus their indexes |

The vector index is `langchain_pg_embedding_hnsw_idx` (`vector_cosine_ops`, m=16,
ef_construction=64) and exists only after that first ingest.

---

## 3. Build the whole database with the single installer

`app.bootstrap --init` creates the **role, database, pgvector extension, all tables, table ownership,
LangGraph checkpoint tables** in order and verifies them at the end.
Every step is idempotent, so re-running breaks nothing.

```bash
BOOTSTRAP_SUPERUSER_URL='postgresql://postgres:<superuser-pw>@<host>:5432/postgres' \
BOOTSTRAP_APP_PASSWORD='<app-role-password>' \
DATABASE_URL='postgresql+psycopg2://app:<app-role-password>@<host>:5432/assistant' \
  python -m app.bootstrap --init
```

The resulting report (example):

```
database ready: tables=34, users=0, admins=0, local_credentials=0, settings_rows=0, kb_articles=0, tickets=0
schema: 34/30 tables, pgvector 0.8.7
  owners: app=34
note: no administrator yet — run with --admin <username> before using the UI
```

| Flag / env | Effect |
| --- | --- |
| `BOOTSTRAP_SUPERUSER_URL` | creating the role/database, `CREATE EXTENSION vector`, changing ownership — if not provided, these steps are skipped and the schema is created with the app role only |
| `BOOTSTRAP_APP_PASSWORD` | the password used when creating a new app role (unchanged if the role already exists) |
| `--json` | machine-readable report for CI/Jobs |
| `--check` | create nothing (build the schema if needed) and report the current state |

`tables=34` means **30 required + 4 LangGraph checkpoint**. The vector store's
`langchain_pg_collection`/`langchain_pg_embedding` are created by LangChain on the first ingest —
the installer reports those two as `lazy_tables_missing`, which is not an error. The `36` in
readiness and dashboards is simply the count after that ingest has run.

### Running it in Kubernetes

```bash
kubectl apply -f infra/k8s-dev/15-db-init.yaml
kubectl -n rag-chatbot-dev wait --for=condition=complete job/db-init --timeout=180s
kubectl -n rag-chatbot-dev logs job/db-init
```

Run the Job after `20-database.yaml` in apply order and before the backend is deployed. When a superuser
URL is needed, create the `db-init-superuser` Secret (`url` key); if it is absent the Job continues with the
schema-only steps.

---

## 4. Manual path (if the DBA wants to do it personally)

```sql
-- once, as superuser
CREATE ROLE app LOGIN PASSWORD '<strong-password>';
CREATE DATABASE assistant OWNER app;
\c assistant
CREATE EXTENSION IF NOT EXISTS vector;
```

Then let the application create the schema (it fills in whatever is missing on every upgrade):

```bash
DATABASE_URL='postgresql+psycopg2://app:<pw>@<host>:5432/assistant' \
  python -m app.bootstrap --check
```

Or apply the reference dump directly (no `data`, schema only):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/schema.sql
```

Neither path includes **data**; there are no seed/demo records. If you use the manual path, check
ownership carefully — if `ALTER TABLE ... OWNER TO app` has not been done, later migrations will fail
(`--init` does this automatically).

---

## 5. Create the first administrator

There is no default account (intentionally). So one is needed before opening the UI:

```bash
# takes the password from a prompt, or BOOTSTRAP_ADMIN_PASSWORD / stdin; never from argv
DATABASE_URL='postgresql+psycopg2://app:<pw>@<host>:5432/assistant' \
  python -m app.bootstrap --admin <username>
```

The output should be `database ready: tables=…, users=1, admins=1, local_credentials=1, …`.
The password is stored as salted SHA-256 (`salt$digest`) in `local_user_credentials` —
the same path as setting a password from the UI.

If you use a directory (LDAP/AD), no local password is needed — set `DEV_ADMIN_USERNAMES=<username>`
and log in with directory credentials.

---

## 6. Connect the app

| Env / Secret | Required? | Explanation |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | may contain the password — keep it in a Secret |
| `JWT_SECRET` | optional | if not provided, it is generated on first boot and stored in `system_settings.security` |
| `MAIL_DOMAIN` | optional | for building addresses when the directory has no mail |
| `DEV_ADMIN_USERNAMES` | optional | to grant a directory account admin |
| LLM key, LDAP, Keycloak, Confluence, Jira, SMTP | — | enter via **UI → Settings** (stored in the DB, write-only) |

After booting, check:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/branding     # 200
curl -s https://<host>/api/dashboard/health                               # 401 (login required)
```

---

## 7. Becoming ready once setup is done from the frontend

Once the database is built with `--init` and one admin exists, everything else must be completed
**from the UI** — there is no need to log back into the server.

| What the admin does (Settings → Integrations) | What happens automatically |
| --- | --- |
| Save **Confluence** base URL + account email + API token | as soon as it is saved, a KB sync is queued in the background (Celery). Saving again within 2 minutes does not queue another (dedupe). Articles are ingested and domains are registered automatically |
| Save **Jira** base URL + email + token | the Tickets page reads live Jira (can be confirmed with test connection) |
| Save **LDAP/AD** server, base DN, bind DN + password | directory login works (the user row is created on first login; approve it if admin approval is required) |
| Save **Keycloak** issuer, client id/secret, redirect URI | `/api/auth/sso/enabled` → `true`; “Sign in with SSO” appears on the login page |

**Readiness check** — `GET /api/setup/readiness` (login required) reads the following points
directly from the database and returns them:

```json
{
  "ready": false,
  "steps": [
    {"key": "database",      "status": "done", "detail": "34 tables · pgvector 0.8.7"},
    {"key": "administrator", "status": "done", "detail": "1 admin account"},
    {"key": "knowledge",     "status": "todo", "detail": "Confluence connected, nothing indexed yet",
     "hint": "Open Knowledge and press Sync — or wait for the sync queued by saving credentials"},
    {"key": "ticketing",     "status": "done", "detail": "Jira connected"},
    {"key": "identity",      "status": "todo", "detail": "neither configured"}
  ]
}
```

At the top of Settings → Integrations these steps are shown as a “Finish setting up” card;
when all of them are done it collapses to a single line (“Installation ready — …”).
`blocked` means it cannot be fixed from the UI (e.g. no admin yet / no pgvector) — in that case
the hint shows directly which command to run.

---

## 8. Verification queries (is the fresh install correct?)

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema='public';       -- 34 (--init) / 36 (after first ingest)
SELECT extversion FROM pg_extension WHERE extname='vector';                       -- 0.8.x
SELECT indexname FROM pg_indexes WHERE indexname='langchain_pg_embedding_hnsw_idx';
SELECT count(*) FROM users;             -- 1 (the first admin) — no demo user
SELECT count(*) FROM kb_meta;           -- 0
SELECT count(*) FROM jira_tickets;      -- 0
SELECT count(*) FROM audit_log;         -- 0 (appears only after the first activity)
SELECT key FROM system_settings;        -- llm/integrations/smtp/security ... as entered by the UI
```

---

## 9. Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `must be superuser to create this extension` | the app role is not superuser | run `CREATE EXTENSION` once as superuser (section 4), or provide `BOOTSTRAP_SUPERUSER_URL` |
| `must be owner of table chat_messages` (startup warning) | the table owner is not the app role | `ALTER TABLE ... OWNER TO app;` (only then can the FTS/meta migration run) |
| Login 401 immediately | no admin yet / wrong password | re-run `--admin` (idempotent) |
| no key in `system_settings` | nothing has been configured yet | enter it in UI → Settings (no defaults are baked into the code) |

---

## 10. Backup / migration

```bash
# full, with data (schema + data) — to move to another environment
pg_dump -Fc -U postgres assistant > assistant.dump
pg_restore -d assistant_new --no-owner -U postgres assistant.dump

# schema only (to refresh this repo's reference)
pg_dump -s -O -x -U postgres assistant > backend/db/schema.sql
```

`system_settings.security.jwt_secret` comes along too — after moving the database, tokens
keep working. To get a new key, delete that key and restart (a new one is
generated automatically, but existing sessions become invalid).

---

## 11. When upgrading

Deploying new code makes `init_db()` add the tables/columns it needs
(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). No migration tool
is needed, but the **table owner must be the app role** — otherwise a warning is emitted and
that column is not added.

Refresh the reference dump after every upgrade:

```bash
pg_dump -s -O -x -U postgres assistant > backend/db/schema.sql
```
