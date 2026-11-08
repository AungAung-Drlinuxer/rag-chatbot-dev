## 🔧 Tutorial 5.1 — Chunker ကိုယ်တိုင် စမ်း

```python
# python -m app.knowledge.chunker  (or pytest)
from app.knowledge.chunker import chunk_text

doc = """# VPN Guide
## Prerequisites
Install Cisco AnyConnect
## Step 1 — Connect
Open the app
## Step 2 — Authenticate
Use LDAP credentials"""

chunks = chunk_text(doc, chunk_tokens=800, overlap=0.10)
print(chunks)
# Output: ['VPN Guide — Prerequisites. Install Cisco AnyConnect',
#          'VPN Guide — Step 1 — Connect. Open Cisco AnyConnect...']
```

## 🔧 Tutorial 5.2 — Manual Article Ingest

```bash
# API နဲ့ KB article တင်
curl -X POST http://127.0.0.1:8000/api/knowledge/articles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Password Reset Guide",
    "domain": "helpdesk",
    "body": "# Password Reset\n## Self-Service\n1. Visit portal.com\n2. Click forgot password\n3. Check email"
  }'

# စစ်ဆေး — chunked ဖြစ်ပြီလား
kubectl -n rag-chatbot exec deploy/backend -- python -c "
from app.persistence.database import engine
from sqlalchemy import text
with engine.connect() as c:
    r = c.execute(text(\"SELECT COUNT(*) FROM langchain_pg_embedding\"))
    print('total chunks:', r.scalar())
"
```

