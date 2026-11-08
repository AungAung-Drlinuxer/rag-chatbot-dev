"""App audit log — best-effort writes to `audit_log` (Phase 8). Never breaks the request."""
from __future__ import annotations

import logging

logger = logging.getLogger("audit")


def audit(action: str, username: str | None = None, domain: str | None = None,
          confidence: float | None = None, decision: str | None = None,
          detail: str | None = None) -> None:
    try:
        from app.persistence.database import SessionLocal
        from app.persistence.models import AuditLog

        with SessionLocal() as s:
            s.add(AuditLog(action=action, username=username, domain=domain,
                           confidence=confidence, decision=decision, detail=detail))
            s.commit()
    except Exception as exc:
        logger.warning(f"audit skipped ({type(exc).__name__}): {exc}")
