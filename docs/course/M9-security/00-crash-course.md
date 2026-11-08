# M9 — Security Crash Course (အပြည့်အစုံ)

> `M9-security/00-crash-course.md`

## L1 — Security Layers Stack

```
Request ─► JWT verify ─► RBAC check ─► API key (optional)
       ─► Guardrails ─► Rate limit ─► Audit log ─► Pipeline
```

## L2 — JWT Pattern

```python
import jwt

def issue_token(username, role):
    return jwt.encode({"sub": username, "role": role,
                       "exp": int(time.time()) + 1800}, SECRET, "HS256")

def verify_token(token):
    return jwt.decode(token, SECRET, ["HS256"])
```

## L3 — RBAC

```python
CAPABILITIES = {
    "admin":     ["*"],
    "agent":     ["tickets.*", "sync.run", "chat.use"],
    "knowledge": ["kb.*", "chat.use"],
    "user":      ["chat.use", "tickets.read_own"],
}
```

## L4 — API Key (show-once)

```python
raw = f"ith_{secrets.token_hex(24)}"
db.save(hash=sha256(raw))       # hash-only
return raw                       # ONE time only
```

## L5 — Rate Limit (fail-open)

```python
@limit("chat")   # 5 req/min
def chat_stream(...):
    ...
# Redis down → allow + warn (availability > strictness)
```

## ✅ Self-Check M9

1. JWT signature က ဘာကာကွယ်လဲ?
2. 401 vs 403 — ဥပမာ နှစ်ခုစီ။
3. API key raw text မသိမ်းရတဲ့ အကြောင်းရင်း။
4. Fail-open vs fail-closed — ဘယ်ဟာ ဘာလို့ ကောင်းလဲ?

---