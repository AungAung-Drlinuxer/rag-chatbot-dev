"""The name this installation calls itself, for anything it sends out of the app.

No product name is baked into the code. An administrator can name the workspace in
Settings → Branding (system_settings.key='branding', field 'appName'); until then the
neutral default is used. Mail subjects and the SMTP test body read from here so a
deployment never mails people as somebody else's product.

Mirrors the SPA's `displayAppName()` — same default, same trim rule.
"""

from __future__ import annotations

DEFAULT_APP_NAME = "IT Help"


def app_name() -> str:
    """The administrator's brand name, or the neutral default.

    Never raises: branding is cosmetic, and a database hiccup must not stop an email
    or a request. A missing branding row simply means "not named yet".
    """
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT value FROM system_settings WHERE key = 'branding'")
            ).first()
        raw = row[0] if row else None
        if isinstance(raw, str):
            import json

            try:
                raw = json.loads(raw)
            except Exception:
                raw = None
        if isinstance(raw, dict):
            name = str(raw.get("appName") or "").strip()
            if name:
                return name[:48]
    except Exception:
        pass
    return DEFAULT_APP_NAME


def mail_prefix() -> str:
    """The `[Name]` marker at the start of an outbound subject."""
    return f"[{app_name()}]"
