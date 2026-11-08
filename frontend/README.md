# IT Help Chatbot — Desktop (Tauri + React/Vite/Tailwind)

Modern, clean enterprise presentation client for the IT Help Chatbot platform.

---

## 🎨 Features & Architecture

- **Clean Enterprise Design:** Option 3 Sidebar with top navigation, collapsible conversation history, unified scrollbars, and single-border sleek input composer.
- **Theme Engine:** Full Light / Dark mode persistence loaded directly from database user preferences. Theme is preserved across logouts and page refreshes without relying on localStorage.
- **Human-In-The-Loop Approval:** Dedicated centered modal popup for admin escalation approval requests with backdrop blur, question quotation, and direct Approve/Reject actions.
- **Knowledge Base & Domain Hub:** Split-screen layout integrating KB Articles Table with Domain Classifier keywords, Jira project keys, and custom icons.
- **Streaming Chat:** Real-time token streaming via Server-Sent Events (SSE) with inline citations and document source inspection.

---

## 🛠️ Verification & Build Commands

```bash
# Typecheck & Unit Tests
npx tsc --noEmit
npm test

# Production Build
npm run build

# Docker Container Build
docker build -t harbor.drlinuxer.com/rag-chatbot/frontend:latest .
```
