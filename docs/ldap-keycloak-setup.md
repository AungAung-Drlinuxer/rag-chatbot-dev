# LDAP / Active Directory နှင့် Keycloak SSO — preparation & setup guide

ဒီ app ရဲ့ login လမ်းကြောင်းကို အရင်သိထားဖို့ လိုတယ် (ကုဒ်ထဲက အတိုင်း):

```
1. local_user_credentials မှာ username ရှိရင်  → အဲဒီ password နဲ့ပဲ စစ်တယ် (LDAP ကို မ ရောက်ပါ)
2. မ ရှိရင် → LDAP service bind → user DN ရှာ → အဲဒီ user အနေနဲ့ ပြန် bind (password စစ်)
3. service bind ကျရင် → UPN တိုက်ရိုက် bind (username@corp.local) ကို ကျ
```

ဒါကြောင့် **admin က local password သတ်မှတ်ထားတဲ့ user က directory password နဲ့ မ ဝင်နိုင်ပါ** —
ဒါက ရည်ရွယ်ချက်ရှိတဲ့ အပြုအမူပါ (break-glass account အတွက်)၊ ဒါပေမယ့် မ သိထားရင် bug လို ထင်ရတယ်။

---

# အပိုင်း ၁ — LDAP / Active Directory

## 1.1 AD ဘက်က ပြင်ဆင်ရန်

| လုပ်ရန် | ဘယ်မှာ | မှတ်ချက် |
| --- | --- | --- |
| Service account | ADUC → OU=Service Accounts | `svc-chatbot` — interactive login ပိတ်၊ password never expires |
| ခွင့်ပြုချက် | Delegation | **read ပဲ** လို (user object attribute ဖတ်ရန်)။ Domain Admin မ ပေးပါ |
| Base DN | ADUC → View → Advanced Features → object → Attribute Editor → `distinguishedName` | ဥပမာ `DC=corp,DC=local` (လိုအပ်ရင် `OU=Users,DC=corp,DC=local` အထိ ကျဉ်း) |
| LDAPS certificate | DC ရဲ့ CA | pod က CA ကို ယုံရမယ် (system trust store) — မဟုတ်ရင် handshake ကျမယ် |
| Groups | ADUC | `it-help-admins` (admin)၊ `it-help-agents` (agent) — role က ဒီ group က လာတယ် |

နှစ်ခုလုံးကို စစ်ရန် (သင့် workstation ကနေ):

```bash
# base DN ရှာရန်
ldapsearch -x -H ldap://dc.corp.local -b "" -s base namingContexts

# service account + user ရှာနိုင်လား
ldapsearch -H ldaps://dc.corp.local -D "CN=svc-chatbot,OU=Service Accounts,DC=corp,DC=local" -W \
  -b "DC=corp,DC=local" "(sAMAccountName=aungaung)" sAMAccountName mail department memberOf

# LDAPS trust စစ်
openssl s_client -connect dc.corp.local:636 -showcerts </dev/null 2>&1 | grep -E 'Verify return code|subject='
```

`Verify return code: 0 (ok)` မ ဟုတ်ရင် pod ကို CA ထည့်ရမယ် (ConfigMap → `/etc/ssl/certs/ca-certificates.crt`
သို့မဟုတ် custom bundle + `LDAPTLS_CACERT`).

## 1.2 App ထဲမှာ ထည့်ရန်

**Settings → Integrations → LDAP / Active Directory**

| Field | ဥပမာ | မှတ်ချက် |
| --- | --- | --- |
| LDAP Server Host | `ldaps://dc.corp.local` သို့ `10.10.10.10` | scheme မပါရင် port ကို ကြည့်ပြီး app က ဆုံးဖြတ်တယ် (`636` → ldaps၊ ကျန် → ldap) |
| Port | `636` | 636 = LDAPS (ထောက်ခံ)၊ 389 = plain / StartTLS |
| Bind DN | `CN=svc-chatbot,OU=Service Accounts,DC=corp,DC=local` | search အတွက် service account |
| Bind Password | — | **write-only** — သိမ်းပြီး ပြန်မ ပြပါ |
| Base DN | `DC=corp,DC=local` | user ရှာတဲ့ root |
| User Filter | `(sAMAccountName={username})` | AD အတွက် ဒါက default။ OpenLDAP ဆိုရင် `(uid={username})`။ **`{username}` မပါရင် Save မရ** (400) — ရှုပ်ထွေးတဲ့ filter ဖြစ်နိုင်၊ ဥပမာ `(&(sAMAccountName={username})(userPrincipalName=*@corp.local))` |

Save → **Test connection**: app က service bind ကို ဖွင့်ပြီး ပြန်ပိတ်တယ် (search မ လုပ်)။
`200` ဆိုရင် credential + network ရပြီ။

> **ဘာပြောင်းသွားလဲ (backend `dev-1.0.7`)**: အရင် login က env (`LDAP_URL`, `LDAP_BIND_DN`, …)
> ပဲ ဖတ်တယ် — UI မှာ ထည့်ထားတာ login မှာ မ ပါခဲ့ပါ။ အခု DB ကို ဦးစားပေးဖတ်တယ် (host+port ကို
> `ldaps://host:636` အနေနဲ့ ပေါင်းပေးတယ်)၊ env က fallback။ Group→role ဖတ်တဲ့ လမ်းကြောင်းလည်း
> အတူတူ။ Save လုပ်တာနဲ့ cache ရှင်းတယ်၊ restart မလို။

## 1.3 ပထမ login နှင့် အတည်ပြုခြင်း (registration gate)

Directory user ကို app က **အလိုအလျောက် မ ထည့်ပါ** — ပထမ AD bind အောင်မြင်ရင် `users` မှာ
`Pending` stub တစ်ခု ဆောက်ပြီး login ကို ပိတ်ထားတယ်။

1. User က username/password နဲ့ login ကြိုး → `403 Registration pending — your AD account was verified,
   but an administrator must approve it on the Users page…`
2. Admin က **Users** page မှာ အဲဒီ user ကို တွေ့ → approve (status `Active`)
3. User ပြန် login → ဝင်နိုင်

ဒါက open directory တစ်ခုလုံး အလိုအလျောက် app user ဖြစ်တာကို တားတယ်။

Role သတ်မှတ်ချက် (ဦးစားပေး အစဉ်):
1. `users.role_override` (admin က Users page မှာ သတ်မှတ်)
2. AD group: `it-help-admins` → **admin**, `it-help-agents` → **agent**
3. ကျန် → **user**

Group အမည် ပြောင်းချင်ရင် env `RBAC_ADMIN_GROUPS` / `RBAC_AGENT_GROUPS` (comma separated)။

## 1.4 Verify

- Login အောင်မြင် → header မှာ user ပေါ်၊ `GET /api/auth/me` → 200
- `POST /api/auth/login` (200) → token ရ
- DB စစ်ချက်:
  ```sql
  SELECT username, ldap_dn, department, status, role_override, last_seen
  FROM users WHERE ldap_dn IS NOT NULL ORDER BY last_seen DESC LIMIT 5;
  ```
- Admin group ထဲက user က admin pages မြင်လား (Settings, Users)
- Audit log မှာ login event

## 1.5 Troubleshooting (LDAP)

| လက္ခဏာ | အကြောင်း | ဖြေရှင်း |
| --- | --- | --- |
| `401 Invalid credentials` တစ်ချက်ချင်း | bind password မှား / base DN မှား / filter မ ကိုက် / LDAPS trust မ ရ | Test connection ကို အရင်စစ်၊ `ldapsearch` နဲ့ တိုက်စစ် |
| log: `LDAP user X not found` | base_dn က user ရှိတဲ့ OU ကို မ ဖုံးလွှမ်း | base_dn ကို ကျဉ်း/ချဲ့၊ filter စစ် |
| log: `LDAP user bind failed (52e-style)` | user password မှား / account locked / password expired | AD မှာ စစ် |
| log: `service bind failed; trying UPN user bind` | service account DN/password မှား | bind DN ကို DN format အတိအကျ ထည့် (email မ ဟုတ်) |
| `strong(er) authentication required` | DC က plain LDAP bind ကို ပိတ်ထား | `ldaps://…:636` (သို့) StartTLS သုံး |
| LDAPS handshake error / `certificate verify failed` | pod က CA ကို မ ယုံ | CA bundle ထည့် (test မှာသာ `LDAPTLS_REQCERT=never`) |
| Login အောင်ပေမယ့် role မ မှန် | `memberOf` က direct group ပဲ ပြတယ် (nested group မ ပါ) | user ကို group ထဲ တိုက်ရိုက် ထည့် (သို့) `role_override` သုံး |
| Directory password နဲ့ မ ဝင်နိုင် | အဲဒီ user မှာ local credential ရှိနေတယ် | Users → password reset ဖျက် (သို့) local row ကို ဖျက် |
| `403 … disabled by an administrator` | status `Disabled` | Users → enable |
| `403 Registration pending` | ပထမ login၊ approve မ လုပ်ရသေး | Users → approve |

---

# အပိုင်း ၂ — Keycloak SSO (လက်ရှိ အခြေအနေ)

## 2.1 အလုပ်လုပ်ပုံ (အခု အခြေအနေ)

| အလုပ် | လက်ရှိ |
| --- | --- |
| Settings → Integrations → Keycloak (issuer, realm, client_id, client_secret, redirect_uri) | ✅ DB မှာ၊ secret write-only |
| Test connection — OIDC discovery | ✅ |
| **OIDC login (authorization code + PKCE)** | ✅ **အလုပ်လုပ်တယ်** |
| Login page "Sign in with SSO" button | ✅ realm configure ထားမှ ပေါ် |
| User provisioning | ✅ ပထမ login က `Pending` → admin approve (LDAP နဲ့ အတူတူ) |
| Role mapping | ✅ `groups` / `realm_access.roles` → `it-help-admins` = admin, `it-help-agents` = agent |

လမ်းကြောင်း:

```
Login → [Sign in with SSO] → GET /api/auth/sso/login
      → Keycloak authorize (state + nonce + PKCE S256)
      → GET /api/auth/sso/callback?code&state
          · state တစ်ခါပဲ သုံးနိုင် (10 မိနစ်)
          · code → token endpoint (client_secret + PKCE verifier)
          · id_token ကို realm JWKS နဲ့ verify (signature, iss, aud, exp, nonce)
          · user provision (Pending/Disabled/ok)
      → redirect https://<host>/#/sso?code=<one-time>
      → POST /api/auth/sso/exchange {code}  (60 စက္ကန့်၊ တစ်ခါပဲ)
      → app access/refresh token
```

Token တွေ browser URL ထဲ မ ပါပါ — one-time code ပဲ ပါတယ်။

## 2.2 Keycloak ဘက်က ပြင်ဆင်ရန်

1. **Realm**: `ith-chatbot` (Issuer = `https://<keycloak-host>/realms/ith-chatbot`)
2. **Client**: `it-help-chatbot`, **Confidential**, Standard flow ✅, Direct access ❌
   - **Valid redirect URI**: `https://<chatbot-host>/api/auth/sso/callback` ← အတိအကျ
   - Web origins: `https://<chatbot-host>`
   - PKCE: "Enforce PKCE" ဖွင့်ထားနိုင် (app က S256 ပို့တယ်)
3. **Groups**: `it-help-admins`, `it-help-agents`
4. **Mapper**: group membership → `groups` claim (Token mapper → "Group list", full group path OFF)
5. **User federation** (optional): Keycloak → LDAP → သင့် AD
6. App ထဲ **Settings → Integrations → Keycloak** ဖြည့် → Save → **Test connection** `200`

| Field | ဥပမာ | မှတ်ချက် |
| --- | --- | --- |
| Issuer / Base URL | `https://keycloak.example.com` | `/realms/...` ပါလည်း ရ (app က ဖြတ်တယ်) |
| Realm | `ith-chatbot` | |
| Client ID | `it-help-chatbot` | |
| Client Secret | (write-only) | confidential client ရဲ့ secret |
| Redirect URI | `https://<chatbot-host>/api/auth/sso/callback` | Keycloak မှာ ဒီအတိုင်း မှတ်ရမယ် |

## 2.3 အပြုအမူနှင့် ကန့်သတ်ချက်

- **ပထမ login** → Users page မှာ `Pending` → admin approve လုပ်မှ ဝင်နိုင် (open realm တစ်ခုလုံး
  အလိုအလျောက် seat မ ရစေရ)
- **Disabled** user → `403` (login page မှာ ရှင်းလင်းတဲ့ message)
- **Role**: admin က `role_override` သတ်မှတ်ထားရင် အဲဒါက အနိုင်ရ၊ မရှိရင် SSO group က လာ
- **state / one-time code** က process memory ထဲ (10 မိနစ် / 60 စက္ကန့်) — backend replica
  တစ်ခုအတွက် မှန်တယ်။ Replica များလာရင် sticky session (သို့) shared store လိုမယ်
- Enable လုပ်ရန် `issuer` + `realm` + `client_id` + `redirect_uri` လိုတယ် (`client_secret`
  မ ပါရင် public client အနေနဲ့ PKCE ပဲ သုံးမယ်)
- UI မ ပြဘဲ env နဲ့ လည်း ပေးနိုင်: `KEYCLOAK_ISSUER`, `KEYCLOAK_REALM`,
  `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_REDIRECT_URI`
- Login page က SSO button ကို `GET /api/auth/sso/enabled` ဖြေမှပဲ ပြတယ် — configure မ လုပ်ရင်
  password form ပဲ ရှိတယ်

## 2.4 Troubleshooting (Keycloak — လက်ရှိ အတိုင်း)

| လက္ခဏာ | အကြောင်း | ဖြေရှင်း |
| --- | --- | --- |
| Test `404` | realm အမည် မှား / issuer မှာ `/realms/<realm>` ပါနေတယ် | Issuer ကို host ပဲ ထည့်၊ Realm ကို သီးသန့် |
| Test `401/403` | discovery ကို public မ ဖွင့်ထား | Realm → General → uncheck "Require SSL" မ လုပ်ပါနဲ့၊ client policy စစ် |
| Panel ဖြည့်ထားပေမယ့် login မ ပြောင်း | SSO flow က မ ရှိသေး | အပိုင်း 2.3 checklist — implementation လို |

---

# Security နှင့် လုပ်ငန်းစဉ်

- Password/secret အားလုံး **DB (`system_settings`)** မှာ၊ API က **write-only** (mask ပဲ ပြန်)၊
  repo/manifest မှာ မ ထည့်ပါ
- LDAP service account ကို **read-only** ပေးပါ၊ Domain Admin မ ပေးပါ
- LDAPS (636) ကို ထောက်ခံပါ — plain 389 ကို DC က ပိတ်ထားလေ့ရှိ
- Local password ကို break-glass account အတွက်ပဲ သုံး; directory user တွေမှာ မ ထားပါ
- Password/secret လဲလှယ်ရင်: field ထဲ အသစ် paste → Save (အလွတ် = ဟောင်း ဆက်)
- Integration ဖျက်ရန်: `DELETE /api/settings/integrations/<key>?confirm=<key>`
- Token/secret တွေ DB backup ထဲ ပါတယ် — backup ကို credential အနေနဲ့ ကာကွယ်ပါ

## Checklist

**LDAP**
- [ ] service account (read-only, never expires)
- [ ] base DN + filter ကို `ldapsearch` နဲ့ စမ်းပြီး တစ်ယောက် ရှာတွေ့
- [ ] LDAPS trust (cert verify 0)
- [ ] `it-help-admins` / `it-help-agents` group ရှိ
- [ ] Settings → Integrations → LDAP ဖြည့် → Test 200
- [ ] ပထမ login → Pending → Users မှာ approve → ပြန် login OK
- [ ] admin group user က admin page မြင်

**Keycloak SSO**
- [ ] realm + **confidential** client + Valid Redirect URI `https://<host>/api/auth/sso/callback`
- [ ] PKCE (S256) ဖွင့်ထား (optional but recommended)
- [ ] groups + `groups` claim mapper (full group path OFF)
- [ ] LDAP user federation (optional)
- [ ] Settings → Integrations → Keycloak ဖြည့် → Save → Test 200
- [ ] Login page မှာ "Sign in with SSO" ပေါ်လာ
- [ ] SSO နဲ့ login → `Pending` → approve → ပြန် login OK
- [ ] admin group user က admin page မြင်
