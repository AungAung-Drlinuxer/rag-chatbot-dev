"""Pydantic request/response models (design doc §6 supporting routes)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginRequest(StrictModel):
    username: str
    password: str


class ChatRequest(StrictModel):
    message: str
    session_id: str | None = None
    context: list[dict] = []  # chat history turns [{role, content}]
    username: str | None = None
    top_k: int | None = None  # override SETTINGS.retrieval_top_k for this call
    # v1.6.22 — per-request LLM provider selection: "auto" (default, OpenRouter
    # with Ollama failover), "cloud" (force primary only), or "local"
    # (force on-prem Ollama). None/"auto" preserves the standard failover chain.
    llm_provider: str | None = None

class EscalateRequest(StrictModel):
    session_id: str | None = None
    message: str = ""
    domain: str | None = None
    confidence: float | None = None
    transcript: list[dict] = []


class RefreshRequest(StrictModel):
    refresh_token: str


class ArticleDraftRequest(StrictModel):
    topic: str
    domain: str = "general"


class FeedbackRequest(StrictModel):
    message_id: str | None = None
    rating: int  # 1 helpful, -1 not helpful
    comment: str | None = None


class ArticleSearchRequest(StrictModel):
    query: str
    domain: str | None = None
    top_k: int = 5


class ArticleRequest(StrictModel):
    """Create / edit a KB article (Phase 7 admin)."""
    page_id: str
    title: str
    body: str
    domain: str = "general"
    source_url: str | None = None


# --- Domain Management Schemas ---
from typing import Any
from pydantic import BaseModel, Field

class DomainCreateRequest(BaseModel):
    domain_key: str = Field(..., min_length=2, max_length=64, description="Unique domain key e.g. 'hr'")
    display_name: str = Field(..., min_length=2, max_length=128, description="Display title e.g. 'Human Resources'")
    description: str | None = Field(None, description="Scope or summary of domain")
    keywords: list[str] = Field(default_factory=list, description="Keywords/phrases for classifier matching")
    jira_project: str | None = Field(None, max_length=32)
    jira_assignee: str | None = Field(None, max_length=64)
    icon: str | None = Field("BookOpen", max_length=32)
    color: str | None = Field("blue", max_length=32)
    custom_icon: str | None = None
    is_active: bool = True

class DomainUpdateRequest(BaseModel):
    display_name: str | None = None
    description: str | None = None
    keywords: list[str] | None = None
    jira_project: str | None = None
    jira_assignee: str | None = None
    icon: str | None = None
    color: str | None = None
    custom_icon: str | None = None
    is_active: bool | None = None


# --------------------------------------------------------------------------- #
# RESPONSE models (audit 2026-11-01)
#
# Every route previously declared `-> dict`, so the wire contract lived only in
# the handler body: a renamed key shipped silently and the SPA found out at
# runtime. These models make the contract explicit and give /docs a real schema.
#
# They use `extra="allow"` on purpose. FastAPI FILTERS the response through the
# model, so a strict model that misses a field would silently delete that field
# from the payload — turning a documentation improvement into an outage. With
# extra="allow" the typed fields are documented and anything the handler adds
# still reaches the client.
# --------------------------------------------------------------------------- #

class LooseModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class HealthResponse(LooseModel):
    status: str
    env: str | None = None
    conf_threshold: float | None = None


class BrandingResponse(LooseModel):
    """PUBLIC — the login page renders before any token exists."""
    logo: str | None = None
    appName: str | None = None
    updated_at: str | None = None


class EscalationItem(LooseModel):
    id: int | None = None
    jira_key: str | None = None
    domain: str | None = None
    status: str | None = None
    created_at: str | None = None
    link: str | None = None
    session_id: str | None = None


class EscalationsResponse(LooseModel):
    escalations: list[EscalationItem] = []


class FeedbackResponse(LooseModel):
    status: str
    saved: bool
    rating: int


class EvalCase(LooseModel):
    question: str
    domain: str | None = None
    must_contain: list[str] = []
    expected_sources: list[str] = []


class EvalCasesResponse(LooseModel):
    n_cases: int
    cases: list[EvalCase] = []
