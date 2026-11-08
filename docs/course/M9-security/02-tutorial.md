## 🔧 Tutorial 9.1 — RBAC Test

```bash
# user role နဲ့ login
TOKEN=$(curl -X POST /api/auth/login -d '{"username":"testuser","password":"..."}' | jq -r .access_token)

# admin-only endpoint ကို user token နဲ့ ခေါ်
curl http://127.0.0.1:8000/api/users -H "Authorization: Bearer $TOKEN"
# Expected: 403 Forbidden

# admin token နဲ့
curl -H "Authorization: Bearer $ADMIN_TOKEN" /api/users
# Expected: 200 OK
```

## 🔧 Tutorial 9.2 — Rate Limit Test

```bash
# 6 requests in rapid succession
for i in $(seq 1 6); do
  curl -X POST http://127.0.0.1:8000/api/chat/stream \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"message":"test"}' -o /dev/null -w "%{http_code}\n"
done
# Expected: 1-5 = 200, 6th = 429
```

