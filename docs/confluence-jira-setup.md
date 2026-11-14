# Confluence KB နှင့် Jira Ticket — preparation & setup guide

ဒီ app မှာ Atlassian နှစ်ခုက ဒီလို အလုပ်လုပ်ပါတယ်:

| Integration | လမ်းကြောင်း | App ထဲမှာ ဘယ်နေရာ |
| --- | --- | --- |
| **Confluence** | **အဝင်** — page တွေ chunk → embed → pgvector → answer source | Knowledge page, Chat citations |
| **Jira** | **အထွက် + ပြန်လည်** — escalation ticket ဖန်တီး၊ status transition၊ comment၊ existing tickets pull | Tickets page, Chat escalation |

Jira က **ticket တည်ရှိမှု** အပေါ် အခြေခံတယ် — credentials မရှိရင် mock key မ ထုတ်ပါ၊
error ပြတယ်။ Confluence ကလည်း **စစ်မှန်တဲ့ page** ပဲ ဆွဲတယ် — sample data မ ရှိပါ။

---

# အပိုင်း ၁ — Confluence (Knowledge Base အဝင်)

## 1.1 Atlassian ဘက်က ပြင်ဆင်ရန် (Preparation)

**ကိုယ်ပိုင် service account** တစ်ခု ဖန်တီးပါ (လူတစ်ယောက်ရဲ့ token မ သုံးပါနဲ့) —
`svc-chatbot@your-domain.com`။ ဒါက token လဲလှယ်တဲ့အခါ လူတွေ logout မ ဖြစ်စေဖို့။

| လုပ်ရန် | ဘယ်မှာ | မှတ်ချက် |
| --- | --- | --- |
| API token ဖန်တီး | https://id.atlassian.com/manage-profile/security/api-tokens | **Classic token** ကို ဦးစားပေး (Basic auth လိုတယ်)။ Scoped token သုံးရင် `read:confluence-content.all` + `read:confluence-space.summary` ထည့် |
| Space ခွင့်ပြုချက် | Space settings → Permissions | service account ကို **Can view** ပေး၊ လိုအပ်တဲ့ space တွေပဲ (အားလုံး မ ပေးပါ) |
| Page restrictions | page → ⋯ → Restrictions | chatbot ဖတ်ရမယ့် page တွေမှာ restriction မ ရှိစေရ — restriction ရှိရင် CQL က မ ပြန်ပါ |
| Labels | page → ⋯ → Labels | အောက်ပါ label rule အတိုင်း တပ်ရမယ် |

### Label rule (app က တကယ် စစ်တဲ့ အတိုင်း)

```cql
space = "HELP" AND type = page
AND label = "approved"
AND label = "chatbot-safe"
AND label != "restricted"
AND label != "internal-only"
AND label != "on-call"
```

- page တစ်ခုမှာ **`approved` နဲ့ `chatbot-safe` နှစ်ခုလုံး** ရှိမှ ingest လုပ်တယ်
- `restricted` / `internal-only` / `on-call` တပ်ထားရင် နှစ်ခုလုံး ရှိလည်း မ ယူပါ
- ပထမ run မှာ space အသစ်နဲ့ စမ်းချင်ရင် env `CONFLUENCE_SKIP_LABEL_FILTER=1` ထားပြီး စမ်းနိုင်
  (ဒါပေမယ့် production မှာ မ ထားပါ)

Atlassian search မှာ အထက်က CQL ကို တိုက်ရိုက် paste ပြီး **ဘယ် page တွေ ပါမလဲ** အရင်စစ်ပါ။
0 ပြန်ရင် app ကလည်း 0 ပဲ ရမယ်။

### Content အရည်အသွေး (answer quality အတွက်)

- **page တစ်ခု = topic တစ်ခု**။ ရှည်လွန်းတဲ့ page ကို ခွဲပါ
- **title ကို မေးခွန်းပုံစံ** ရေးပါ (“VPN ချိတ်လို့ မရရင် ဘယ်လိုလုပ်မလဲ”) — title က chunk ထဲ ထည့်ထားတယ်
- ပုံ/attachment/macro ကို မ ဖတ်ပါ (HTML → text ပဲ)၊ ဇယားက text အနေနဲ့ ပါမယ်
- code block ကို plain text အနေနဲ့ ပါတယ် — indentation ပျက်နိုင်တာမို့ လိုအပ်ရင် အဆင့်လိုက် ရေးပါ
- ရက်စွဲ/ပိုင်ရှင် ပါစေ — နောက်မှ မွန်းမံရလွယ်တယ်

## 1.2 App ထဲမှာ ထည့်ရန်

**Settings → Integrations → Confluence**

| Field | ဥပမာ | မှတ်ချက် |
| --- | --- | --- |
| Base URL | `https://your-domain.atlassian.net/wiki` | `/wiki` အဆုံးထိ ထည့်ပါ (Cloud) |
| Account Email | `svc-chatbot@your-domain.com` | token ဖန်တီးတဲ့ account |
| API Token | `ATATT3xFfGF0...` | **write-only** — သိမ်းပြီးရင် ပြန်မ ပြပါ |
| Space Keys | `HELP, IT, ENG` | comma ခြားပြီး၊ အစ/အဆုံး space ပါ |

Save လုပ်ပြီး **Test connection** နှိပ်ပါ — app က `GET /rest/api/content?limit=1` ကို
Basic auth နဲ့ ခေါ်တယ်။ `200` ဆိုရင် ချိတ်ပြီ။

> **ဘာပြောင်းသွားလဲ (backend `dev-1.0.5`)**: အရင် Confluence sync က env var
> (`CONFLUENCE_*`) ပဲ ဖတ်တယ် — UI မှာ ထည့်ထားတာ အလုပ်မ လုပ်ခဲ့ပါ။ အခု DB (`system_settings`)
> ကို ဦးစားပေးဖတ်တယ်၊ env က fallback ပဲ။ ဒါကြောင့် UI ကနေ ထည့်တာ တကယ် အလုပ်လုပ်တယ်။

## 1.3 Sync လုပ်ခြင်း

**Knowledge → Sync from Confluence** (API: `POST /api/articles/sync`, admin/agent)

လုပ်ငန်းစဉ်: page ဆွဲ → HTML→text → chunk → **embed** → `langchain_pg_embedding` သိမ်း →
`kb_meta` မှာ hash နဲ့ မှတ်။ page မ ပြောင်းရင် hash တူလို့ **ကျော်**တယ် (ထပ်ကို မ embed ပါ)။

**လိုအပ်ချက်**: embedding က **Ollama** ကနေ လာတယ် (`OLLAMA_URL`, default
`http://localhost:11434`, model `nomic-embed-text`)။ Ollama မ ရောက်ရင် sync မှာ vector မ
ဖြစ်ဘဲ answer မ ထွက်ပါ — AI service (chat) ကို configure လုပ်ရုံနဲ့ မ လုံလောက်ပါ။

```bash
# cluster ထဲက backend pod ကနေ စစ်ရန်
kubectl -n rag-chatbot-dev exec deploy/backend -- \
  python -c "import httpx,os;from app.config import SETTINGS as s;print(httpx.get(s.ollama_url+'/api/tags',timeout=5).status_code)"
```

## 1.4 Domain mapping (အရေးကြီး)

Ingest လုပ်တဲ့အခါ page ကို **space key (lowercase)** နဲ့ စတင် domain သတ်မှတ်ပြီး၊
classifier က ရှိပြီးသား domain rule တွေနဲ့ ကိုက်ညီမှ real domain ပြောင်းတယ်။

ဒါကြောင့် **Domains & Routing** မှာ domain တွေ အရင် ရှိထားရမယ် — မ ရှိရင် article တွေ
`help`/`it` လို placeholder domain မှာ ကျန်ပြီး chat retrieval filter က မ ရှာနိုင်တော့ပါ။

## 1.5 Verify

- Knowledge page: total / per-domain counts တက်လား
- `GET /api/articles-list?domain=<domain>` → title တွေ ပြန်လား
- `GET /api/sync-status` → last sync stats (`pages/inserted/updated/skipped`)
- Audit log မှာ `sync` event
- DB စစ်ချက်:
  ```sql
  SELECT count(*), count(DISTINCT domain) FROM kb_meta;
  SELECT count(*) FROM langchain_pg_embedding;
  SELECT domain, count(*) FROM kb_meta GROUP BY 1 ORDER BY 2 DESC;
  ```
- Chat မှာ တစ်ခုမေးကြည့် → citation က သက်ဆိုင်တဲ့ page ကို ညွှန်လား

## 1.6 Troubleshooting (Confluence)

| လက္ခဏာ | အကြောင်း | ဖြေရှင်း |
| --- | --- | --- |
| Test → `401` | scoped token ကို Basic auth နဲ့ သုံးနေ | Classic API token ဖန်တီးပါ (သို့) email မှန်လား စစ် |
| Test → `403` | service account ကို space access မ ပေး | Space permissions → Can view |
| Test `200` ဒါပေမယ့် sync `pages=0` | label rule မ ကိုက် / CQL မှာ space key မှား | Atlassian search မှာ CQL တိုက်ရိုက် စမ်း |
| Page တချို့ မ ပါ | page restriction / label လွဲ | Restrictions ဖျက်၊ label `approved`+`chatbot-safe` |
| `pages>0` ဒါပေမယ့် `inserted=0` | hash တူ (မ ပြောင်း) | ပုံမှန် — page ပြင်မှ updated တက် |
| Embedding error / timeout | Ollama မ ရောက်၊ model မ ဆွဲထား | `ollama pull nomic-embed-text`, `OLLAMA_URL` စစ် |
| Sync ပြီး chat မ ရှာ | domain placeholder မှာ ကျနေ | Domains & Routing မှာ domain ဖန်တီး → ပြန် sync/reclassify |
| Confluence **Server/DC** | PAT + `/wiki` path မတူ | Base URL ကို `https://confluence.corp/rest/api` အထိ မထည့်ပါ — host ပဲ ထည့်၊ Basic auth သုံး |

---

# အပိုင်း ၂ — Jira (Ticket အထွက်)

## 2.1 Atlassian ဘက်က ပြင်ဆင်ရန်

| လုပ်ရန် | ဘယ်မှာ | မှတ်ချက် |
| --- | --- | --- |
| service account | Jira admin | `svc-chatbot@...` — reporter အနေနဲ့ ပေါ်မယ် |
| API token | id.atlassian.com → API tokens | Classic token |
| Project | Project settings | key ကို မှတ်ထား (ဥပမာ `ITHD`) |
| Permissions | Project → Permissions | **Browse Projects**, **Create Issues**, **Transition Issues**, **Add Comments**, **Create Attachments** |
| Issue type | Project settings → Issue types | fallback လမ်းက **`Task`** ကို hardcode သုံးတယ် — project မှာ Task မရှိရင် ဖန်တီးပါ (သို့) JSM လမ်း သုံး |
| Required fields | Project settings → Fields | company-managed project မှာ custom field မဖြစ်မနေ လိုရင် fallback လမ်း `400` ပြမယ် → JSM request type သုံးပါ |

### JSM (Jira Service Management) သုံးမလား?

- **JSM request** လမ်းက customer-facing ticket ဖန်တီးတာ ပိုသင့်တော်၊ request type က
  field တွေ ကို အလိုအလျောက် ဖြည့်ပေးတယ်
- လိုတာ: `serviceDeskId` + `requestTypeId` (domain အလိုက် ခွဲနိုင်)
- ဒီ setting နှစ်ခုကို **Settings → Integrations → Jira** မှာ တိုက်ရိုက် ထည့်နိုင်တယ်
  (env မလို၊ DB မှာ သိမ်း):
  - **Service Desk ID (JSM, optional)** — ဥပမာ `12`
  - **Request Type IDs by domain (optional)** — JSON map:
    `{"server": "101", "network": "102", "general": "100"}`
- ID ကို မ သိရင် app ရဲ့ discovery endpoint (admin) ကို သုံးပါ — သိမ်းထားတဲ့
  credential နဲ့ ဆွဲပေးတယ်:

```bash
curl -s -H "Authorization: Bearer <app-token>" \
  https://<chatbot-host>/api/settings/integrations/jira/service-desks
curl -s -H "Authorization: Bearer <app-token>" \
  https://<chatbot-host>/api/settings/integrations/jira/service-desks/12/request-types
```

(သို့) Jira ကို တိုက်ရိုက်:

```bash
curl -s -u "$EMAIL:$TOKEN" https://your-domain.atlassian.net/rest/servicedeskapi/servicedesk | jq '.values[] | {id, projectKey}'
curl -s -u "$EMAIL:$TOKEN" https://your-domain.atlassian.net/rest/servicedeskapi/servicedesk/<ID>/requesttype | jq '.values[] | {id, name}'
```

- Save လုပ်တဲ့အခါ app က shape ကို စစ်တယ် — desk id က ဂဏန်း မ ဟုတ်ရင်၊ JSON မမှန်ရင်
  `400` ပြတယ် (ticket ဖန်တီးချိန်မှ မှားတာ မ ဖြစ်စေရ)
- `domain` key က `general` ကို fallback သုံးတယ်။ မ ရှိရင် app က
  `POST /rest/api/3/issue` (Task, project key) ကို ကျသွားတယ်။

### Workflow transitions

App ရဲ့ status ၄ ခု (`open | pending | resolved | closed`) ကို Jira transition **အမည်**
နဲ့ ကိုက်စေတယ် (ပထမ တွေ့တာ ယူ):

| App status | ရှာတဲ့ transition အမည်များ |
| --- | --- |
| `open` | Reopen, Re-open, To Do, Open, Backlog, Pending |
| `pending` | Start progress, Start Progress, In Progress, Pending |
| `resolved` | Mark as done, Done, Resolve Issue, Resolve |
| `closed` | Close Issue, Close, Mark as done, Done |

အမည် မ ကိုက်ရင် app က **ပြောင်းတာ မ လုပ်ဘဲ** ရနိုင်တဲ့ transition list ကို ပြန်ပေးတယ်
(`no matching transition for 'pending' (available: [...])`). Workflow ကို ဒီအမည်တွေနဲ့
ကိုက်အောင် ပြင်ပါ (သို့) app ကို ပြင်ရမယ်။

## 2.2 App ထဲမှာ ထည့်ရန်

**Settings → Integrations → Jira**

| Field | ဥပမာ |
| --- | --- |
| Base URL | `https://your-domain.atlassian.net` |
| Account Email | `svc-chatbot@your-domain.com` |
| API Token | `ATATT3xFfGF0...` (write-only) |
| Default Project Key | `ITHD` |
| Service Desk ID (JSM, optional) | `12` |
| Request Type IDs by domain (optional) | `{"server": "101", "general": "100"}` |

Save → **Test connection** (`GET /rest/api/3/myself` → `200` ဆိုရင် ချိတ်ပြီ)။

## 2.3 Ticket လုပ်ဆောင်ချက်များ

| လုပ်ဆောင်ချက် | ဘယ်လို | API |
| --- | --- | --- |
| Chat escalation → ticket | Chat မှာ escalate | JSM/issue REST |
| Ticket အသစ် ဖန်တီး | Tickets → Create support ticket | `POST /api/tickets` |
| Jira ကနေ pull | Tickets → Sync from Jira | `POST /api/tickets/jira/sync` (idempotent) |
| Status ပြောင်း | Tickets → workflow step | `PUT /api/tickets/{ref}` → Jira transitions |
| Comment | Ticket detail | `POST /api/tickets/{ref}/comments` |
| Attachment ပေး | Ticket detail | `POST /api/tickets/{ref}/attachments` |

Pull လုပ်တဲ့အခါ `jira_key` (ITHD-123) ကို key အနေနဲ့ သုံးတယ် — ထပ် run ရင်
create မ လုပ်၊ update ပဲ လုပ်တယ်။ Jira status အမည်ကို canonical ၄ ခုကို ပြန်ပုံဖော်တယ်
(`ticket_status.canonical_from_jira_status`).

## 2.4 Verify

- Tickets page မှာ Jira key တွေ ပေါ်လား (mock `ESC-xxxx` မ ရှိရ)
- Jira ထဲမှာ ticket တကယ် ရှိလား (link နှိပ်)
- Status ပြောင်းပြီး Jira UI မှာ status ပြောင်းသွားလား
- Comment/attachment က Jira မှာလည်း ပေါ်လား
- DB:
  ```sql
  SELECT jira_key, status, created_by FROM jira_tickets ORDER BY created_at DESC LIMIT 5;
  ```

## 2.5 Troubleshooting (Jira)

| လက္ခဏာ | အကြောင်း | ဖြေရှင်း |
| --- | --- | --- |
| Test `401` | token/email မှား (သို့) scoped token Basic auth မ ရ | Classic token ပြန်ဖန်တီး |
| `403` on create | Create Issues ခွင့် မ ရှိ | Project permissions |
| `400 issuetype` | project မှာ `Task` မ ရှိ | Task ဖန်တီး (သို့) JSM request type သုံး |
| `400 customfield required` | company-managed required field | JSM request type သုံး (field တွေ auto) |
| `404 project` | project key မှား / archived | Project settings မှာ စစ် |
| Ticket ဖန်တီးပြီး status မ ပြောင်း | transition အမည် မ ကိုက် | error detail ထဲက available list ကြည့် → workflow ပြင် |
| Pull `total=0` | JSM မ ရှိ၊ project key မှား၊ permission | `fetch_all_tickets` log ကြည့်၊ project key စစ် |
| `429` | rate limit | နည်းနည်းစောင့်၊ sync ကို ခဏခဏ မ run ပါ |

---

# အပိုင်း ၃ — Security & Operations

- Token တွေက **database (`system_settings`)** မှာ သိမ်း၊ API က **write-only** (mask ပဲ ပြန်)
- Token လဲလှယ်ရင်: field ထဲ token အသစ် paste → Save (အလွတ်ထားရင် ဟောင်း ဆက် သုံး)
- Integration ဖျက်ရန်: `DELETE /api/settings/integrations/<key>?confirm=<key>` — ပြန်မရ
- Least privilege: space read ကို လိုတဲ့ space ပဲ၊ Jira ကို project တစ်ခုပဲ
- Audit log: `sync`, ticket create/update, settings change တွေ မှတ်တမ်း တင်တယ်
- Backup: DB backup ထဲ token တွေ ပါလာမယ် — backup ကို credential အနေနဲ့ ကာကွယ်ပါ
- **Sync အလိုအလျောက် မ ရှိပါ** — လောလောဆယ် manual (Knowledge → Sync)၊ လိုရင် cron job ထည့်နိုင်

## လုပ်ငန်းစဉ် checklist (တစ်ခါတည်း)

**Confluence**
- [ ] service account + Classic API token
- [ ] space Can view permission
- [ ] page labels: `approved` + `chatbot-safe` (restricted/internal-only/on-call ဖျက်)
- [ ] CQL ကို Atlassian search မှာ စမ်း (0 မ ဖြစ်ရ)
- [ ] Settings → Integrations → Confluence ထည့် → Test 200
- [ ] Domains & Routing မှာ domain ရှိပြီးသား
- [ ] Knowledge → Sync → insert count > 0
- [ ] Chat မှာ မေးကြည့် → citation မှန်

**Jira**
- [ ] service account + Classic API token
- [ ] Project key + Browse/Create/Transition/Comment/Attachment permissions
- [ ] Issue type `Task` ရှိ (သို့) JSM serviceDeskId + requestTypeId
- [ ] Workflow transitions အမည် ကိုက်
- [ ] Settings → Integrations → Jira ထည့် → Test 200
- [ ] Tickets → Create support ticket → Jira မှာ ပေါ်
- [ ] Status ပြောင်း → Jira မှာ ပြောင်း
- [ ] Sync from Jira → existing ticket တွေ ပါလာ

## ဒီ version မှာ မ ပါဝင်သေးတာ

- Confluence attachment/ပုံ ဖတ်ခြင်း (text ပဲ)
- Confluence ကို article ပြန်ရေးခြင်း (ဖတ်တာ ပဲ; write path က code ထဲ ရှိပေမယ့် UI မ ဖွင့်ထား)
- Space တစ်ခုချင်း credential ခွဲခြင်း (တစ် account တည်း)
- Jira custom required field mapping (JSM request type ကနေ ဖြေရှင်းရ)
- Jira panel ထဲက service desk / request type ကို dropdown နဲ့ ရွေးတာ (အခု JSON field)
- Scheduled sync (manual ပဲ)

## “Configured ဖြစ်ပေမယ့် not connected” ဆိုတဲ့ အခြေအနေ

Confluence/Jira ကို **site တစ်ခုချင်း** (`integration_connections`) သိမ်းတယ်။ Legacy
single-site row (`system_settings.confluence|jira`) ကို ဖျက်ထားတဲ့ install တစ်ခုမှာ
အောက်ပါ သုံးနေရာက legacy row ကို ဖတ်နေရင် “not connected” လို့ မှားပြပါတယ်။

| လက္ခဏာ | အကြောင်းရင်း | ပြင်ထားတာ |
|---|---|---|
| Settings ထဲ “Finish setting up” မှာ “No document source connected” / “Jira not connected” | `/api/setup/readiness` က legacy config ပဲ စစ်တယ် | site rows ကိုပါ ရေတွက်တယ် · `199 articles · 8 domains · 1 site` |
| Tickets → “Sync from Jira” → `No tickets returned` | `fetch_all_tickets()` က connection မ bind ပဲ `_jira_cfg()` ဖတ်တယ် | site တစ်ခုချင်း bind ပြီး ပေါင်းတယ် (`updated 12`) |
| Knowledge → Sync → 409 “already running” (ထာဝရ) | deploy က run အလယ်မှာ pod ကို လဲလိုက်တော့ `kb_sync_run` marker က `running` ပဲ ကျန်တယ် | 30 မိနစ်ကျော်ရင် `stale` လို့ သတ်မှတ်ပြီး sync အသစ် ခွင့်ပြုတယ် |
| Overview ရဲ့ SERVICE STATUS မှာ “Confluence sync” / “Jira” ကို အနီ (Down) | `/api/dashboard/health` က legacy token ပဲ စစ်တယ် | site rows ကိုပါ ရေတွက်၊ healthy row မှာ “1 site” ပြထားတယ် |
| Create/Edit ticket dialog မှာ “Jira offline” ပေမယ့် ticket က Jira မှာ တကယ်ရောက်တယ် | `/api/ticket-destinations` က legacy config ဖတ်တယ် | `effective_connections("jira")` ပါ ထည့်စစ်တယ် → “Connected to Jira” / “Jira synced” |
| Test က “1 pages visible” | `/rest/api/content` ရဲ့ `size` က response row အရေအတွက် (ငါတို့ 1 ခုပဲ တောင်းတယ်) | space စာရင်း ဖတ်ပြီး “3 spaces visible · not listed: …” |

ဒါကြောင့် “connected လား” ဆိုတာကို **Test** ခလုတ် (site တစ်ခုချင်း၊ အဲဒီ site ရဲ့ token နဲ့)
နဲ့ `Finish setting up` က ပြောတယ် — catalogue က “In use” ဆိုတာနဲ့ မတူနိုင်ပါဘူး။
