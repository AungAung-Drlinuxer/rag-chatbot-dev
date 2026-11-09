"""Secrets that must exist before the first request, stored in the database.

WHY THIS EXISTS
---------------
The repository used to carry two kinds of secret-shaped value that made a fresh install
unsafe and a second install awkward:

* `jwt_secret` defaulted to `"change-me-in-prod"`, so any deployment that forgot to set
  it signed tokens with a value that is published in this file.
* `DEV_PASSWORD` defaulted to a literal password next to a dev-user backdoor in the login
  path, which is a permanent way into any install that left the default alone.

Both are gone. The signing key is now generated once per installation, written to
`system_settings` (key `security`) and read back on every boot, so:

* nothing sensitive lives in the repo, the image, or a local file;
* reinstalling the app against the same database keeps the same key, so sessions and
  refresh tokens survive a rollout;
* a brand-new database mints its own key without an operator having to invent one.

An explicit `JWT_SECRET` in the environment still wins, for installations that rotate
keys through their own secret manager.
"""
from __future__ import annotations

import json
import logging
import secrets as _secrets

from sqlalchemy import text

from app.config import SETTINGS

log = logging.getLogger("the-secrets")

KEY = "security"


def _as_dict(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def resolve_boot_secrets() -> None:
    """Fill SETTINGS.jwt_secret from the database, minting one on first boot.

    Best-effort: a database outage must not stop the process from starting (the app
    already degrades in that state), so failures are logged and the key stays empty
    until a later boot can read it. No fallback value is ever invented here.
    """
    if SETTINGS.jwt_secret:
        return
    try:
        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                text("SELECT value FROM system_settings WHERE key = :k"), {"k": KEY}
            ).first()
            cfg = _as_dict(row[0]) if row else {}
            secret = cfg.get("jwt_secret")
            if secret:
                SETTINGS.jwt_secret = secret
                return
            secret = _secrets.token_urlsafe(48)
            cfg = {**cfg, "jwt_secret": secret}
            s.execute(
                text(
                    "INSERT INTO system_settings (key, value, updated_at) "
                    "VALUES (:k, :v, NOW()) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
                ),
                {"k": KEY, "v": json.dumps(cfg)},
            )
            s.commit()
        SETTINGS.jwt_secret = secret
        log.info("minted a JWT signing key and stored it in system_settings.%s", KEY)
    except Exception as exc:
        log.warning("could not resolve the JWT signing key from the database: %s", exc)
