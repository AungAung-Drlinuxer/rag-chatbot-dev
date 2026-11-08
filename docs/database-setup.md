# Database အသစ် setup လုပ်ခြင်း (Fresh database guide)

ဒီ guide က ဒီ application ကို **တခြား team / တခြား org** က ကိုယ်ပိုင် database အသစ်နဲ့
stand-up လုပ်ချင်တဲ့အခါ လိုက်နာရန် ရေးထားတာပါ။ Reference အနေနဲ့ လက်ရှိ run နေတဲ့
dev/prod database ရဲ့ schema (PostgreSQL 16 + pgvector 0.8.0, tables ၃၁ ခု, indexes ၄၈ ခု) ကို
အခြေခံထားပါတယ်။ **Data မပါဝင်ပါ** — schema တစ်ခုတည်း။

---

## 1. လိုအပ်ချက်များ (Prerequisites)

| Component | Version | မှတ်ချက် |
| --- | --- | --- |
| PostgreSQL | **16** | CNPG/cluster သို့မဟုတ် managed Postgres ဖြစ်နိုင် |
| pgvector | **0.8.0** (>= 0.5 ရ) | `langchain_pg_embedding.embedding` က `vector` type သုံး |
| Database | အသစ်၊ အလွတ် | `--init` က `CREATE DATABASE assistant OWNER app` ကို အလိုအလျောက် လုပ်တယ် |
| App credentials | non-superuser role | extension တစ်ခုတည်းကို superuser နဲ့ လုပ်မယ် |

Application role ကို **superuser မပေးပါနဲ့**။ `CREATE EXTENSION vector` တစ်ကြိမ်တည်း
superuser လိုတာကို `BOOTSTRAP_SUPERUSER_URL` နဲ့ ဖြေရှင်းထားပါတယ်။

---

## 2. Schema ထဲမှာ ဘာတွေ ပါလဲ (reference)

Schema ကို ဒီနေရာမှာ အပြည့်အစုံ သိမ်းထားပါတယ် — `backend/db/schema.sql` (`pg_dump -s -O -x`
နဲ့ ထုတ်ထားတဲ့ production-shaped dump၊ data မပါ)။

| အုပ်စု | Tables | အသုံး |
| --- | --- | --- |
| Identity & access | `users`, `local_user_credentials`, `user_settings`, `user_permission_overrides`, `app_groups`, `app_group_members`, `departments`, `department_members`, `rbac_matrix`, `api_keys` | login, role, permission, API key |
| Chat | `chat_sessions`, `chat_messages`, `chat_attachments`, `feedback` | conversation + transcript + attachment + rating |
| Knowledge | `kb_meta`, `langchain_pg_collection`, `langchain_pg_embedding` (HNSW index) | article metadata + chunk vectors |
| Domains & routing | `classifier_domains` | domain → team routing |
| Tickets | `jira_tickets`, `ticket_comments`, `ticket_attachments` | Jira-bound tickets |
| Approvals / audit | `approvals`, `audit_log` | human-in-the-loop + activity trail |
| Settings | `system_settings` (LLM/integrations/SMTP/security key), `runtime_kv` | admin-configurable state |
| Orchestration | `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` | LangGraph state |
| Graph RAG | `semantica_entities`, `semantica_relations` | (optional) knowledge graph |

စုစုပေါင်း **31 tables / 48 indexes**၊ vector index က
`langchain_pg_embedding_hnsw_idx` (`vector_cosine_ops`, m=16, ef_construction=64)။

---

## 3. အဆင့် ၁ — Installer တစ်ခုတည်းနဲ့ database တစ်ခုလုံး ဆောက်

`app.bootstrap --init` က **role, database, pgvector extension, tables အားလုံး, table ownership,
LangGraph checkpoint tables** တွေကို အစဉ်လိုက် ဖန်တီးပြီး နောက်ဆုံးမှာ verify လုပ်ပေးတယ်။
အဆင့်တိုင်း idempotent ဖြစ်လို့ ပြန် run လည်း ဘာမှ မပျက်ပါ။

```bash
BOOTSTRAP_SUPERUSER_URL='postgresql://postgres:<superuser-pw>@<host>:5432/postgres' \
BOOTSTRAP_APP_PASSWORD='<app-role-password>' \
DATABASE_URL='postgresql+psycopg2://app:<app-role-password>@<host>:5432/assistant' \
  python -m app.bootstrap --init
```

ထွက်လာတဲ့ report (ဥပမာ):

```
database ready: tables=29, users=0, admins=0, local_credentials=0, settings_rows=0, kb_articles=0, tickets=0
schema: 29/25 tables, pgvector 0.8.0
  owners: app=29
note: no administrator yet — run with --admin <username> before using the UI
```

| Flag / env | လုပ်ဆောင်ချက် |
| --- | --- |
| `BOOTSTRAP_SUPERUSER_URL` | role/database ဖန်တီးခြင်း၊ `CREATE EXTENSION vector`၊ ownership ပြောင်းခြင်း — မပေးရင် ဒီအဆင့်တွေ ကျော်ပြီး schema ကို app role နဲ့ပဲ ဆောက်တယ် |
| `BOOTSTRAP_APP_PASSWORD` | app role အသစ် ဆောက်ရာမှာ သုံးမယ့် password (role ရှိပြီးသားဆိုရင် မ ပြောင်းပါ) |
| `--json` | CI/Job အတွက် machine-readable report |
| `--check` | ဘာမှ မ ဆောက်ဘဲ (လိုအပ်ရင် schema ဆောက်ပြီး) လက်ရှိ state ကို report |

`tables=29` ဖြစ်တာက **25 required + 4 LangGraph checkpoint**။ Vector store ရဲ့
`langchain_pg_collection`/`langchain_pg_embedding` ကို ပထမဆုံး ingest လုပ်တဲ့အခါ LangChain
က ဖန်တီးတယ် — installer က အဲဒီနှစ်ခုကို `lazy_tables_missing` အနေနဲ့ report လုပ်တယ်၊ error မ ဟုတ်ပါ။

### Kubernetes မှာ run လုပ်ခြင်း

```bash
kubectl apply -f infra/k8s-dev/15-db-init.yaml
kubectl -n rag-chatbot-dev wait --for=condition=complete job/db-init --timeout=180s
kubectl -n rag-chatbot-dev logs job/db-init
```

Job ကို apply order မှာ `20-database.yaml` ပြီးနောက်၊ backend မတင်ခင် run ပါ။ Superuser URL
လိုတဲ့အခါ `db-init-superuser` Secret (`url` key) ကို ဖန်တီးပါ; မရှိရင် Job က schema-only
အဆင့်တွေကို ဆက်လုပ်တယ်။

---

## 4. Manual လမ်း (DBA က ကိုယ်တိုင် လုပ်ချင်ရင်)

```sql
-- superuser နဲ့ တစ်ကြိမ်
CREATE ROLE app LOGIN PASSWORD '<strong-password>';
CREATE DATABASE assistant OWNER app;
\c assistant
CREATE EXTENSION IF NOT EXISTS vector;
```

ပြီးရင် schema ကို application ကနေ ဆောက်ခိုင်းပါ (upgrade တိုင်း အလိုအလျောက် ဖြည့်ပေးတယ်):

```bash
DATABASE_URL='postgresql+psycopg2://app:<pw>@<host>:5432/assistant' \
  python -m app.bootstrap --check
```

သို့မဟုတ် reference dump ကို တိုက်ရိုက် apply လုပ်နိုင်တယ် (`data` မပါ၊ schema သက်သက်):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/schema.sql
```

နှစ်လမ်းစလုံးမှာ **data မပါ**၊ seed/demo record မရှိ။ Manual လမ်းသုံးရင် ownership ကို
သေချာစစ်ပါ — `ALTER TABLE ... OWNER TO app` မ လုပ်ထားရင် နောက် migration တွေ ကျမယ်
(`--init` က ဒါကို အလိုအလျောက် လုပ်ပေးတယ်)။

---

## 5. အဆင့် ၃ — ပထမ administrator ဖန်တီး

Default account မရှိပါ (တမင်ဖြစ်ပါတယ်)။ ဒါကြောင့် UI မ ဖွင့်ခင် တစ်ခု လိုတယ်:

```bash
# password ကို prompt (သို့) BOOTSTRAP_ADMIN_PASSWORD / stdin ကနေ ယူတယ်၊ argv မှာ မ ထည့်ပါ
DATABASE_URL='postgresql+psycopg2://app:<pw>@<host>:5432/assistant' \
  python -m app.bootstrap --admin <username>
```

Output က `database ready: tables=…, users=1, admins=1, local_credentials=1, …` ဖြစ်ရမယ်။
Password ကို salted SHA-256 (`salt$digest`) အနေနဲ့ `local_user_credentials` မှာ သိမ်းတယ် —
UI က password သတ်မှတ်တဲ့ လမ်းကြောင်းနဲ့ အတူတူ။

Directory (LDAP/AD) သုံးမယ်ဆိုရင် local password မလိုပါ — `DEV_ADMIN_USERNAMES=<username>`
သတ်မှတ်ပြီး directory credential နဲ့ login လုပ်ပါ။

---

## 6. အဆင့် ၄ — App ကို ချိတ်

| Env / Secret | လိုအပ်? | ရှင်းလင်း |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | password ပါနိုင်၊ Secret ထဲ ထားပါ |
| `JWT_SECRET` | optional | မ ပေးရင် ပထမ boot မှာ generate လုပ်ပြီး `system_settings.security` မှာ သိမ်း |
| `MAIL_DOMAIN` | optional | directory မှာ mail မရှိရင် address ဆောက်ဖို့ |
| `DEV_ADMIN_USERNAMES` | optional | directory account ကို admin ပေးဖို့ |
| LLM key, LDAP, Keycloak, Confluence, Jira, SMTP | — | **UI → Settings** ကနေ ထည့် (DB ထဲ သိမ်း၊ write-only) |

Boot လုပ်ပြီး စစ်ရန်:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/branding     # 200
curl -s https://<host>/api/dashboard/health                               # 401 (login လိုတယ်)
```

---

## 7. Frontend ကနေ setup လုပ်ပြီးတာနဲ့ ready ဖြစ်ခြင်း

Database ကို `--init` နဲ့ ဆောက်ပြီး admin တစ်ခု ရှိပြီးဆိုရင် ကျန်တာအားလုံး **UI ထဲကနေပဲ**
ပြီးရမယ် — server ပေါ် ပြန် login လုပ်စရာ မ လိုပါ။

| Admin လုပ်တာ (Settings → Integrations) | အလိုအလျောက် ဖြစ်သွားတာ |
| --- | --- |
| **Confluence** base URL + account email + API token သိမ်း | သိမ်းပြီးတာနဲ့ KB sync တစ်ခု background (Celery) မှာ queue ဝင်တယ်။ ၂ မိနစ်အတွင်း ထပ်သိမ်းရင် ထပ် မ queue ပါ (dedupe)။ Articles ဝင်ပြီး domains တွေ အလိုအလျောက် register ဖြစ်တယ် |
| **Jira** base URL + email + token သိမ်း | Tickets page က live Jira ကို ဖတ်တယ် (test connection နဲ့ အတည်ပြုနိုင်) |
| **LDAP/AD** server, base DN, bind DN + password သိမ်း | Directory login အလုပ်လုပ်တယ် (first login မှာ user row ဖန်တီး၊ admin approve လိုအပ်ရင် approve လုပ်ရန်) |
| **Keycloak** issuer, client id/secret, redirect URI သိမ်း | `/api/auth/sso/enabled` → `true`; login page မှာ “Sign in with SSO” ပေါ်လာတယ် |

**Readiness check** — `GET /api/setup/readiness` (login လိုတယ်) က အောက်ပါအချက်တွေကို
database ကနေ တိုက်ရိုက် ဖတ်ပြီး ပြန်ပေးတယ်:

```json
{
  "ready": false,
  "steps": [
    {"key": "database",      "status": "done", "detail": "29 tables · pgvector 0.8.0"},
    {"key": "administrator", "status": "done", "detail": "1 admin account"},
    {"key": "knowledge",     "status": "todo", "detail": "Confluence connected, nothing indexed yet",
     "hint": "Open Knowledge and press Sync — or wait for the sync queued by saving credentials"},
    {"key": "ticketing",     "status": "done", "detail": "Jira connected"},
    {"key": "identity",      "status": "todo", "detail": "neither configured"}
  ]
}
```

Settings → Integrations ရဲ့ ထိပ်မှာ ဒီ step တွေကို “Finish setting up” card အနေနဲ့ ပြတယ်;
အားလုံး done ဖြစ်ရင် တစ်လိုင်းတည်း (“Installation ready — …”) အဖြစ် ကျုံ့သွားတယ်။
`blocked` ဆိုတာ UI ကနေ မ ပြင်နိုင်တာ (ဥပမာ admin မရှိသေး / pgvector မရှိ) — အဲဒီအခါ
ဘာ command run ရမလဲ ကို hint မှာ တိုက်ရိုက် ပြထားတယ်။

---

## 8. Verification queries (fresh install မှန်/မမှန်)

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema='public';       -- 29 (--init) / 31 (after first ingest)
SELECT extversion FROM pg_extension WHERE extname='vector';                       -- 0.8.0
SELECT indexname FROM pg_indexes WHERE indexname='langchain_pg_embedding_hnsw_idx';
SELECT count(*) FROM users;             -- 1 (ပထမ admin) — demo user မရှိ
SELECT count(*) FROM kb_meta;           -- 0
SELECT count(*) FROM jira_tickets;      -- 0
SELECT count(*) FROM audit_log;         -- 0 (စတင်ပြီးမှ ဖြစ်ပေါ်မယ်)
SELECT key FROM system_settings;        -- llm/integrations/smtp/security ... UI က ထည့်သလို
```

---

## 9. ဖြစ်လေ့ရှိတဲ့ ပြဿနာများ

| လက္ခဏာ | အကြောင်း | ဖြေရှင်း |
| --- | --- | --- |
| `must be superuser to create this extension` | app role က superuser မဟုတ် | section 3 က `CREATE EXTENSION` ကို superuser နဲ့ တစ်ကြိမ် run၊ သို့မဟုတ် `BOOTSTRAP_SUPERUSER_URL` ပေး |
| `must be owner of table chat_messages` (startup warning) | table owner က app role မဟုတ် | `ALTER TABLE ... OWNER TO app;` (ဒါမှ FTS/meta migration လုပ်နိုင်) |
| Login 401 ချက်ချင်း | admin မ ရှိသေး / password မ ကိုက် | `--admin` ပြန် run (idempotent) |
| `system_settings` ထဲ key မရှိ | ဘာမှ မ configure ရသေး | UI → Settings မှာ ထည့် (code ထဲ default မ ထည့်ပါ) |

---

## 10. Backup / ရွှေ့ပြောင်း

```bash
# data ပါ အပြည့် (schema + data) — တခြား environment ကို ရွှေ့ရန်
pg_dump -Fc -U postgres assistant > assistant.dump
pg_restore -d assistant_new --no-owner -U postgres assistant.dump

# schema တစ်ခုတည်း (ဒီ repo ရဲ့ reference ကို refresh လုပ်ရန်)
pg_dump -s -O -x -U postgres assistant > backend/db/schema.sql
```

`system_settings.security.jwt_secret` ပါ ပါလာမယ် — database ကို ရွှေ့ရင် token တွေ
ဆက်အလုပ်လုပ်တယ်။ Key အသစ် လိုချင်ရင် အဲဒီ key ကို ဖျက်ပြီး restart လုပ်ပါ (အလိုအလျောက်
အသစ် generate လုပ်တယ်၊ ဒါပေမယ့် ရှိပြီးသား session တွေ invalid ဖြစ်မယ်)။

---

## 11. Upgrade လုပ်တဲ့အခါ

ကုဒ်အသစ်ကို deploy လုပ်တာနဲ့ `init_db()` က လိုအပ်တဲ့ tables/columns တွေကို ဖြည့်ပေးတယ်
(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)။ Migration tool
မ လိုပါ၊ ဒါပေမယ့် **table owner က app role ဖြစ်ဖို့** လိုတယ် — မဟုတ်ရင် warning ထွက်ပြီး
အဲဒီ column က မ ထည့်ဖြစ်ဘူး။

Reference dump ကို upgrade တစ်ခုပြီးတိုင်း refresh လုပ်ထားပါ:

```bash
pg_dump -s -O -x -U postgres assistant > backend/db/schema.sql
```
