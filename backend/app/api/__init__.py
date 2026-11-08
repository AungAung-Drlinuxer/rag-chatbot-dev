"""HTTP/API layer — route handlers, request/response models (Matrix: API).

Currently re-exports the FastAPI app factory pieces from app.main; routers are
being extracted per domain (chat/auth/tickets/users/knowledge/health) in
follow-up PRs. Route handlers must not contain business logic — delegate to
orchestration/persistence.
"""
