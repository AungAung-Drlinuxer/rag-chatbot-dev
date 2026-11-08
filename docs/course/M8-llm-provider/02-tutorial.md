## 🔧 Tutorial 8.1 — Failover Testing

```bash
# 1. Normal (primary works)
# chatbot ထဲ "how do I restart nginx?" → OpenRouter answer

# 2. Kill OpenRouter key (env var change)
kubectl -n rag-chatbot set env deploy/backend OPENAI_API_KEY=invalid-key
kubectl -n rag-chatbot rollout restart deploy/backend

# 3. Same question → llama3.2:1b fallback answer (မတူတဲ့ quality ဖြစ်မယ်)

# 4. Restore
kubectl -n rag-chatbot set env deploy/backend OPENAI_API_KEY=<real-key>
```

