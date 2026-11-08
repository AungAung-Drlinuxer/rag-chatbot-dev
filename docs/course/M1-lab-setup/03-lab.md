## 🧪 Lab 1.1 — Local-only KB Ingestion

Confluence မလိုဘဲ ကိုယ်ပိုင် KB နဲ့ စမ်းနိုင်သည်-

```bash
# backend root ထဲ `kb_files/` folder ဖန်တီး
mkdir kb_files
cat > kb_files/vpn-guide.md <<'EOF'
# VPN Reconnection Guide
## Prerequisites
- Cisco AnyConnect installed
- Valid VPN credentials
## Steps
1. Open Cisco AnyConnect
2. Enter VPN server: vpn.company.com
3. Authenticate with LDAP credentials
4. If MFA required, approve via authenticator app
EOF

# Sync trigger (manual via API)
curl -X POST http://127.0.0.1:8000/api/knowledge/sync -H "Authorization: Bearer $TOKEN"

# စစ်ဆေး — chunks များ pgvector ထဲ ရောက်ပြီလား
docker exec -it backend-postgres-1 psql -U postgres -d assistant \
  -c "SELECT COUNT(*), MIN(content), LENGTH(content) FROM langchain_pg_embedding;"
```

