# M9 — Security Layer

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### Security ၆ ခုတိုက်တိုက်ဆိုင်ဆိုင် အလုပ်လုပ်သည်

```
User Request ─► ① JWT Verify ─► ② RBAC Check ─► ③ API Key (optional)
             ─► ④ Guardrails ─► ⑤ Rate Limit ─► ⑥ Audit Log ─► Pipeline
```

### JWT Auth (LDAP + Local fallback)

```python
# auth/ldap_auth.py — pattern
def authenticate(username, password):
    try:
        # LDAP bind attempt
        conn = ldap3.Connection(server, user=f"cn={username},...", password=password)
        if conn.bind():
            return {"source": "ldap", "username": username}
    except Exception:
        pass
    # fallback to local credentials
    if check_local_user(username, password):
        return {"source": "local", "username": username}
    return None

# JWT issue (HS256, 30 min)
token = jwt.encode({"sub": username, "role": role, "exp": now + 1800}, SECRET, "HS256")
```

### RBAC (Role-Based Access Control)

```python
# roles: admin > agent > knowledge > user
# capability matrix in DB `rbac_matrix`
CAPABILITIES = {
    "admin":     ["tickets.read", "tickets.write", "users.manage", "settings.manage", "sync.run"],
    "agent":     ["tickets.read", "tickets.write", "sync.run"],
    "knowledge": ["kb.read", "kb.write"],
    "user":      ["chat.use", "tickets.read_own"],
}
```

### API Key Lifecycle (show-once)

```
Create → raw key `ith_aBcD...` (show ONE time only in UI)
       → SHA-256 hash → DB save
       → Use → verify hash match
       → Revoke → flag + purge after 30 days
```

**⚠️ Key rule:** hash-only storage (SHA-256) — DB leak ဖြစ်ရင်လည်း key တွေ recover လုပ်လို့ မရဘူး။

### Guardrails (M6 Stage 1 ပါဝင်)

```python
# injection regex patterns (21 total)
# toxic abuse refusal (professional IT tone)
# overflow > 4000 chars → blocked
```

### Rate Limit (Redis-backed)

```python
@limit("chat")  # 5 req/min per user
def chat_stream(...):
    # Redis INCR subject:key with 60s TTL window
    # > 5 → HTTP 429
```

**Fail-open** — Redis unreachable → allow request + warning log (availability > throttling)

### Audit Log (append-only)

```
audit_log table:
- user, action, resource, timestamp, ip, details (JSONB)
- Source-of-truth for security counts (Prometheus gauge reads from DB)
```

