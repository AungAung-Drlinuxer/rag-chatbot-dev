# LDAP / Active Directory and Keycloak SSO — preparation & setup guide

You need to know this app's login path up front (as implemented in the code):

```
1. If the username exists in local_user_credentials  → only that password is checked (LDAP is never reached)
2. If not  → LDAP service bind → look up the user DN → bind again as that user (verify password)
3. If the service bind fails → fall back to a direct UPN bind (username@corp.local)
```

So **a user for whom an admin has set a local password cannot sign in with the directory password** —
this is intentional behaviour (for break-glass accounts), but it looks like a bug if you don't know about it.

---

# Part 1 — LDAP / Active Directory

## 1.1 Prepare the AD side

| Task | Where | Note |
| --- | --- | --- |
| Service account | ADUC → OU=Service Accounts | `svc-chatbot` — interactive login disabled, password never expires |
| Permissions | Delegation | **read only** is enough (to read user object attributes). Do not grant Domain Admin |
| Base DN | ADUC → View → Advanced Features → object → Attribute Editor → `distinguishedName` | e.g. `DC=corp,DC=local` (narrow it down to `OU=Users,DC=corp,DC=local` if needed) |
| LDAPS certificate | The DC's CA | The pod must trust the CA (system trust store) — otherwise the handshake fails |
| Groups | ADUC | `it-help-admins` (admin), `it-help-agents` (agent) — the role comes from these groups |

To verify both (from your workstation):

```bash
# find the base DN
ldapsearch -x -H ldap://dc.corp.local -b "" -s base namingContexts

# can the service account find a user?
ldapsearch -H ldaps://dc.corp.local -D "CN=svc-chatbot,OU=Service Accounts,DC=corp,DC=local" -W \
  -b "DC=corp,DC=local" "(sAMAccountName=aungaung)" sAMAccountName mail department memberOf

# check LDAPS trust
openssl s_client -connect dc.corp.local:636 -showcerts </dev/null 2>&1 | grep -E 'Verify return code|subject='
```

If `Verify return code: 0 (ok)` is not reported, add the CA to the pod (ConfigMap → `/etc/ssl/certs/ca-certificates.crt`
or a custom bundle + `LDAPTLS_CACERT`).

## 1.2 Enter it in the app

**Settings → Integrations → LDAP / Active Directory**

| Field | Example | Note |
| --- | --- | --- |
| LDAP Server Host | `ldaps://dc.corp.local` or `10.10.10.10` | Without a scheme, the app decides from the port (`636` → ldaps, anything else → ldap) |
| Port | `636` | 636 = LDAPS (recommended), 389 = plain / StartTLS |
| Bind DN | `CN=svc-chatbot,OU=Service Accounts,DC=corp,DC=local` | service account used for searches |
| Bind Password | — | **write-only** — stored and never shown again |
| Base DN | `DC=corp,DC=local` | the root under which users are searched |
| User Filter | `(sAMAccountName={username})` | this is the default for AD. For OpenLDAP use `(uid={username})`. **Save fails (400) if `{username}` is missing** — the filter may be more complex, e.g. `(&(sAMAccountName={username})(userPrincipalName=*@corp.local))` |

Save → **Test connection**: the app opens a service bind and closes it again (no search is performed).
A `200` means credentials and network are working.

> **What changed (backend `dev-1.0.7`)**: login used to read only the env (`LDAP_URL`, `LDAP_BIND_DN`, …)
> — anything configured in the UI was not used at login. It now reads the DB first (combining host+port
> into `ldaps://host:636`), with env as the fallback. The group→role path is the same.
> Saving clears the cache; no restart needed.

## 1.3 First login and approval (registration gate)

The app **does not add directory users automatically** — when the first AD bind succeeds it creates a
`Pending` stub in `users` and keeps login disabled.

1. The user tries to log in with username/password → `403 Registration pending — your AD account was verified,
   but an administrator must approve it on the Users page…`
2. The admin finds that user on the **Users** page → approve (status `Active`)
3. The user logs in again → access granted

This prevents an entire open directory from automatically becoming app users.

Role resolution (in priority order):
1. `users.role_override` (set by an admin on the Users page)
2. AD group: `it-help-admins` → **admin**, `it-help-agents` → **agent**
3. otherwise → **user**

To change the group names, use the env vars `RBAC_ADMIN_GROUPS` / `RBAC_AGENT_GROUPS` (comma separated).

## 1.4 Verify

- Login succeeds → the user appears in the header, `GET /api/auth/me` → 200
- `POST /api/auth/login` (200) → token returned
- DB check:
  ```sql
  SELECT username, ldap_dn, department, status, role_override, last_seen
  FROM users WHERE ldap_dn IS NOT NULL ORDER BY last_seen DESC LIMIT 5;
  ```
- A user in the admin group sees the admin pages (Settings, Users)
- A login event in the audit log

## 1.5 Troubleshooting (LDAP)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 Invalid credentials` immediately | wrong bind password / wrong base DN / filter mismatch / no LDAPS trust | run Test connection first, cross-check with `ldapsearch` |
| log: `LDAP user X not found` | base_dn does not cover the OU that holds the user | narrow/broaden base_dn, check the filter |
| log: `LDAP user bind failed (52e-style)` | wrong user password / account locked / password expired | check in AD |
| log: `service bind failed; trying UPN user bind` | wrong service account DN/password | enter the bind DN in exact DN format (not an email) |
| `strong(er) authentication required` | the DC has plain LDAP bind disabled | use `ldaps://…:636` (or) StartTLS |
| LDAPS handshake error / `certificate verify failed` | the pod does not trust the CA | add the CA bundle (`LDAPTLS_REQCERT=never` for testing only) |
| Login succeeds but the role is wrong | `memberOf` shows only direct groups (nested groups are not included) | add the user directly to the group (or) use `role_override` |
| Cannot sign in with the directory password | that user still has a local credential | Users → delete the local password (or) delete the local row |
| `403 … disabled by an administrator` | status `Disabled` | Users → enable |
| `403 Registration pending` | first login, not approved yet | Users → approve |

---

# Part 2 — Keycloak SSO (current state)

## 2.1 How it works (current state)

| Feature | Current |
| --- | --- |
| Settings → Integrations → Keycloak (issuer, realm, client_id, client_secret, redirect_uri) | ✅ in the DB, secret write-only |
| Test connection — OIDC discovery | ✅ |
| **OIDC login (authorization code + PKCE)** | ✅ **working** |
| Login page "Sign in with SSO" button | ✅ shown only once the realm is configured |
| User provisioning | ✅ first login is `Pending` → admin approve (same as LDAP) |
| Role mapping | ✅ `groups` / `realm_access.roles` → `it-help-admins` = admin, `it-help-agents` = agent |

Flow:

```
Login → [Sign in with SSO] → GET /api/auth/sso/login
      → Keycloak authorize (state + nonce + PKCE S256)
      → GET /api/auth/sso/callback?code&state
          · state can be used only once (10 minutes)
          · code → token endpoint (client_secret + PKCE verifier)
          · verify id_token against the realm JWKS (signature, iss, aud, exp, nonce)
          · user provision (Pending/Disabled/ok)
      → redirect https://<host>/#/sso?code=<one-time>
      → POST /api/auth/sso/exchange {code}  (60 seconds, one time only)
      → app access/refresh token
```

Tokens never appear in the browser URL — only a one-time code does.

## 2.2 Prepare the Keycloak side

1. **Realm**: `ith-chatbot` (Issuer = `https://<keycloak-host>/realms/ith-chatbot`)
2. **Client**: `it-help-chatbot`, **Confidential**, Standard flow ✅, Direct access ❌
   - **Valid redirect URI**: `https://<chatbot-host>/api/auth/sso/callback` ← exactly this
   - Web origins: `https://<chatbot-host>`
   - PKCE: "Enforce PKCE" can be enabled (the app sends S256)
3. **Groups**: `it-help-admins`, `it-help-agents`
4. **Mapper**: group membership → `groups` claim (Token mapper → "Group list", full group path OFF)
5. **User federation** (optional): Keycloak → LDAP → your AD
6. In the app, fill in **Settings → Integrations → Keycloak** → Save → **Test connection** `200`

| Field | Example | Note |
| --- | --- | --- |
| Issuer / Base URL | `https://keycloak.example.com` | `/realms/...` may also be included (the app strips it) |
| Realm | `ith-chatbot` | |
| Client ID | `it-help-chatbot` | |
| Client Secret | (write-only) | the confidential client's secret |
| Redirect URI | `https://<chatbot-host>/api/auth/sso/callback` | must be registered exactly like this in Keycloak |

## 2.3 Behaviour and limitations

- **First login** → `Pending` on the Users page → access only after an admin approves (so an entire open realm
  does not automatically get a seat)
- **Disabled** user → `403` (clear message on the login page)
- **Role**: if an admin has set `role_override` that wins, otherwise it comes from the SSO group
- **state / one-time code** live in process memory (10 minutes / 60 seconds) — correct for a single backend
  replica. With more replicas you need sticky sessions (or) a shared store
- To enable it you need `issuer` + `realm` + `client_id` + `redirect_uri` (without `client_secret`
  it acts as a public client using PKCE only)
- It can also be supplied via env without the UI: `KEYCLOAK_ISSUER`, `KEYCLOAK_REALM`,
  `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_REDIRECT_URI`
- The login page shows the SSO button only when `GET /api/auth/sso/enabled` answers — if it is not configured,
  only the password form is present

## 2.4 Troubleshooting (Keycloak — current behaviour)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Test `404` | wrong realm name / issuer already includes `/realms/<realm>` | enter only the host as Issuer, Realm separately |
| Test `401/403` | discovery is not public | do not uncheck "Require SSL" under Realm → General, check the client policy |
| Panel is filled in but login does not change | the SSO flow does not exist yet | section 2.3 checklist — implementation required |

---

# Security and process

- All passwords/secrets live in the **DB (`system_settings`)**, the API is **write-only** (returns a mask only);
  never put them in the repo/manifest
- Give the LDAP service account **read-only** access, do not grant Domain Admin
- Prefer LDAPS (636) — DCs commonly have plain 389 disabled
- Use a local password only for break-glass accounts; do not set one on directory users
- To rotate a password/secret: paste the new value into the field → Save (empty keeps the old one)
- To remove an integration: `DELETE /api/settings/integrations/<key>?confirm=<key>`
- Tokens/secrets are included in DB backups — protect the backup as a credential

## Checklist

**LDAP**
- [ ] service account (read-only, never expires)
- [ ] base DN + filter exercised with `ldapsearch` and one user found
- [ ] LDAPS trust (cert verify 0)
- [ ] `it-help-admins` / `it-help-agents` groups exist
- [ ] Settings → Integrations → LDAP filled in → Test 200
- [ ] first login → Pending → approve in Users → login again OK
- [ ] an admin group user sees the admin page

**Keycloak SSO**
- [ ] realm + **confidential** client + Valid Redirect URI `https://<host>/api/auth/sso/callback`
- [ ] PKCE (S256) enabled (optional but recommended)
- [ ] groups + `groups` claim mapper (full group path OFF)
- [ ] LDAP user federation (optional)
- [ ] Settings → Integrations → Keycloak filled in → Save → Test 200
- [ ] "Sign in with SSO" appears on the login page
- [ ] login via SSO → `Pending` → approve → login again OK
- [ ] an admin group user sees the admin page
