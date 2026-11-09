from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin import router as admin_router
from app.api.admin_ops import router as admin_ops_router
from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.conversations import router as conversations_router
from app.api.dashboard import router as dashboard_router
from app.api.health import router as health_router
from app.api.knowledge import router as knowledge_router
from app.api.escalations import router as escalations_router
from app.api.notifications import router as notifications_router
from app.api.observability import router as observability_router
from app.api.settings import router as settings_router
from app.api.setup import router as setup_router
from app.api.tickets import router as tickets_router
from app.api.users import router as users_router
from app.config import SETTINGS
from app.observability.telemetry import setup_telemetry
from app.persistence.database import init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("it-help-chatbot")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    # The JWT signing key lives in system_settings, not in this repository: mint it on a
    # fresh database, reuse it on every later boot (app/security/boot_secrets.py).
    from app.security.boot_secrets import resolve_boot_secrets
    resolve_boot_secrets()
    setup_telemetry()
    try:
        import threading
        if SETTINGS.rerank_mode == "remote":
            logger.info("rerank_mode=remote — skipping local reranker preload")
        else:
            from app.rag.reranker import _get_model
            threading.Thread(target=_get_model, daemon=True).start()
            logger.info("reranker preload started (background)")
    except Exception as exc:
        logger.warning("reranker preload skipped: %s", exc)
    yield


# The interactive docs are a full map of the API (every path, schema and parameter).
# On an internal deployment that is free reconnaissance, so they are OFF unless the
# operator explicitly opts in with API_DOCS_ENABLED=1.
_docs = SETTINGS.api_docs_enabled
# One version number for the process: the installed distribution's, so `/openapi.json`
# and an incident log agree with the image tag instead of the hardcoded "0.2.0" that
# drifted from pyproject (0.18.4) and the image (dev-1.0.50).
try:
    from importlib.metadata import version as _dist_version

    APP_VERSION = _dist_version("it-help-chatbot-backend")
except Exception:  # not installed (bare checkout) — say so rather than invent a number
    APP_VERSION = "unknown"

app = FastAPI(
    title="IT Help Chatbot",
    version=APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if _docs else None,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

_origins = [o.strip() for o in SETTINGS.cors_origins.split(",") if o.strip()]

# Every endpoint, not just the four with a stricter @limit decorator.
from app.security.rate_limit import GlobalRateLimitMiddleware

app.add_middleware(GlobalRateLimitMiddleware)
# Added AFTER the limiter on purpose: add_middleware puts each new layer on the outside,
# so CORS ends up outermost and a 429 from the limiter still carries the headers the
# browser needs to read the error instead of reporting an opaque network failure.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(conversations_router)
app.include_router(knowledge_router)
app.include_router(admin_router)
app.include_router(admin_ops_router)
app.include_router(dashboard_router)
from app.security.api_keys import router as apikeys_router

app.include_router(apikeys_router)
app.include_router(tickets_router)
app.include_router(escalations_router)
app.include_router(notifications_router)
app.include_router(users_router)
app.include_router(settings_router)
app.include_router(setup_router)
app.include_router(observability_router)
from app.api.domain_rename import router as domain_rename_router

app.include_router(domain_rename_router)

from app.observability.metrics import metrics_endpoint


@app.get("/metrics")
def get_metrics():
    return metrics_endpoint()
