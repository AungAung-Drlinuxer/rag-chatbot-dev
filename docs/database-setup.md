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
| Database | အသစ်၊ အလွတ် | `CREATE DATABASE assistant OWNER app` |
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

## 3. အဆင့် ၁ — Database အသစ် ဖန်တီး

```sql
-- superuser နဲ့ တစ်ကြိမ်
CREATE ROLE app LOGIN PASSWORD '<strong-password>';
CREATE DATABASE assistant OWNER app;
\c assistant
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector; app role က မလုပ်နိုင်လို့
```

Password ကို repo မှာ မ ထည့်ပါ။ Kubernetes ဆိုရင် Secret နဲ့၊ local ဆိုရင် shell env နဲ့
ပေးပါ။

---

## 4. အဆင့် ၂ — Schema ထည့်နည်း (နှစ်လမ်း)

**(A) Application ကနေ ဖန်တီးခိုင်း** (အလွယ်ဆုံး၊ upgrade လုပ်တိုင်း အလိုအလျောက် ဖြည့်ပေး)

```bash
DATABASE_URL='postgresql+psycopg2://app:<pw>@<host>:5432/assistant' \
  python -m app.bootstrap --check
```

`init_db()` က extension, ORM tables ၂၀, နဲ့ hand-written tables ၅ ခု (`system_settings`,
`approvals`, `chat_attachments`, `semantica_entities`, `semantica_relations`,
`ticket_comments`, `ticket_attachments`) တွေကို ဖန်တီးပြီး၊ နောက်ပိုင်း ထပ်တိုးထားတဲ့ columns
(ALTER ... IF NOT EXISTS) တွေကို **statement တစ်ခုချင်း** idempotent ဖြစ်အောင် လုပ်ပေးတယ်။

ဒီလမ်းနဲ့ ရလာတဲ့ fresh database မှာ **tables ၂၅ ခု** ရှိမယ်။ ကျန်တဲ့ ၆ ခု
(`langchain_pg_collection`, `langchain_pg_embedding`, `checkpoints*` ၄ ခု) ကို library
တွေက ပထမဆုံး embed / graph run လုပ်တဲ့အခါ အလိုအလျောက် ဖန်တီးတယ် (HNSW/FTS index ကို
နောက် boot တစ်ခါမှာ ဖန်တီးပေးတယ်)။ ၃၁ ခုလုံးကို ချက်ချင်း လိုချင်ရင် လမ်း (B) ကို သုံးပါ။

**(B) Reference dump ကို တိုက်ရိုက် apply** (schema ကို အတိအကျ လိုချင်ရင်၊ ဒါမှမဟုတ်
application ကို မ run ခင် DBA က စစ်ချင်ရင်)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/schema.sql
```

Verify (ဒီ dump ကို clean database ပေါ် apply လုပ်ပြီး စစ်ထားတာပါ):

```
tables=31  indexes=48  vector=0.8.0
```

လမ်း (A) နဲ့ ရတဲ့ ပထမ output က `tables=25, users=0, admins=0, kb_articles=0, tickets=0`
ဖြစ်တယ် — vector store နဲ့ checkpoint tables က အသုံးပြုတဲ့အခါမှ ပေါ်လာတာမို့ပါ။

နှစ်လမ်းစလုံးမှာ **data မပါ**၊ seed/demo record မရှိ။

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

## 7. Verification queries (fresh install မှန်/မမှန်)

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema='public';       -- 25 (A) / 31 (B)
SELECT extversion FROM pg_extension WHERE extname='vector';                       -- 0.8.0
SELECT indexname FROM pg_indexes WHERE indexname='langchain_pg_embedding_hnsw_idx';
SELECT count(*) FROM users;             -- 1 (ပထမ admin) — demo user မရှိ
SELECT count(*) FROM kb_meta;           -- 0
SELECT count(*) FROM jira_tickets;      -- 0
SELECT count(*) FROM audit_log;         -- 0 (စတင်ပြီးမှ ဖြစ်ပေါ်မယ်)
SELECT key FROM system_settings;        -- llm/integrations/smtp/security ... UI က ထည့်သလို
```

---

## 8. ဖြစ်လေ့ရှိတဲ့ ပြဿနာများ

| လက္ခဏာ | အကြောင်း | ဖြေရှင်း |
| --- | --- | --- |
| `must be superuser to create this extension` | app role က superuser မဟုတ် | section 3 က `CREATE EXTENSION` ကို superuser နဲ့ တစ်ကြိမ် run၊ သို့မဟုတ် `BOOTSTRAP_SUPERUSER_URL` ပေး |
| `must be owner of table chat_messages` (startup warning) | table owner က app role မဟုတ် | `ALTER TABLE ... OWNER TO app;` (ဒါမှ FTS/meta migration လုပ်နိုင်) |
| Login 401 ချက်ချင်း | admin မ ရှိသေး / password မ ကိုက် | `--admin` ပြန် run (idempotent) |
| `system_settings` ထဲ key မရှိ | ဘာမှ မ configure ရသေး | UI → Settings မှာ ထည့် (code ထဲ default မ ထည့်ပါ) |

---

## 9. Backup / ရွှေ့ပြောင်း

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

## 10. Upgrade လုပ်တဲ့အခါ

ကုဒ်အသစ်ကို deploy လုပ်တာနဲ့ `init_db()` က လိုအပ်တဲ့ tables/columns တွေကို ဖြည့်ပေးတယ်
(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`)။ Migration tool
မ လိုပါ၊ ဒါပေမယ့် **table owner က app role ဖြစ်ဖို့** လိုတယ် — မဟုတ်ရင် warning ထွက်ပြီး
အဲဒီ column က မ ထည့်ဖြစ်ဘူး။

Reference dump ကို upgrade တစ်ခုပြီးတိုင်း refresh လုပ်ထားပါ:

```bash
pg_dump -s -O -x -U postgres assistant > backend/db/schema.sql
```
