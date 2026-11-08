## 🧪 Lab Exercise M0

```bash
# Exercise 0.1 — Cluster inventory (notepad ထဲ မှတ်ပါ)
# တစ်ခုချင်း pod ရဲ့ image version + memory request ကို ကြည့်ပါ
kubectl -n rag-chatbot get pods -o custom-columns=\
  NAME:.metadata.name,\
  IMAGE:.spec.containers[*].image,\
  MEM:.spec.containers[*].resources.requests.memory

# Exercise 0.2 — Backend ထဲက Python module tree ကြည့်
kubectl -n rag-chatbot exec deploy/backend -- \
  python -c "import os; [print(f) for f in __import__('os').listdir('app')]"

# Exercise 0.3 — Course guide §0.1 directory map နဲ့ တိုက်ဆိုင်စစ်ပါ။
# ဘယ် folder က integration ကို ကိုင်တွယ်လဲ၊ ဘယ် folder က persistence လဲ ခွဲပြပါ။
```

