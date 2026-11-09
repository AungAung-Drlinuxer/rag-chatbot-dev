"""v0.21.92 — SMTP alert notifier.

Loads the admin-configured SMTP settings (system_settings.key='smtp') and
sends transactional alert emails. Every send is best-effort: failures are
logged, never raised into the request path.

Alert types (toggled in Settings → Mail, stored in the same smtp JSON blob):
  - approval_request      → to admins, when HITL escalation needs a decision
  - ticket_created        → to the requester, when a Jira ticket is opened
  - ticket_status_change  → to the requester, when Jira status moves
"""
import json
import logging
import smtplib
import ssl as _ssl
import threading
from email.mime.text import MIMEText

log = logging.getLogger("notifier")

_ALERT_KEYS = ("approval_request", "ticket_created", "ticket_status_change")


def smtp_config() -> dict:
    from sqlalchemy import text as _t

    from app.persistence.database import SessionLocal
    try:
        with SessionLocal() as s:
            row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
        cfg = row[0] if row else {}
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        return cfg or {}
    except Exception as exc:
        log.warning("smtp config load failed: %s", exc)
        return {}


def _admin_usernames() -> list[str]:
    """Addresses of the administrators, read from the database.

    No fallback recipient: inventing one would mail an unrelated person (or a person who
    does not exist on a fresh install) whenever the user table is empty or unreadable.
    """
    from sqlalchemy import text as _t

    from app.persistence.database import SessionLocal
    try:
        with SessionLocal() as s:
            rows = s.execute(_t(
                "SELECT username, email FROM users WHERE role_override = 'admin'"
            )).all()
        return [r[1] or r[0] for r in rows if (r[1] or r[0])]
    except Exception:
        return []


def _send(cfg: dict, to_addr: str, subject: str, body: str) -> bool:
    host = cfg.get("host")
    if not host or not to_addr:
        return False
    port = int(cfg.get("port") or 587)
    username = cfg.get("username")
    password = cfg.get("password")
    from_addr = cfg.get("from_address") or username
    msg = MIMEText(body, "plain", "utf-8")
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = subject
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=12,
                                  context=_ssl.create_default_context()) as srv:
                if username and password:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to_addr], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=12) as srv:
                srv.ehlo()
                if cfg.get("use_tls", True):
                    srv.starttls(context=_ssl.create_default_context())
                    srv.ehlo()
                if username and password:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to_addr], msg.as_string())
        log.info("alert mail sent: %s -> %s", subject, to_addr)
        return True
    except Exception as exc:
        log.warning("alert mail failed (%s -> %s): %s", subject, to_addr, exc)
        return False


def send_alert(alert_type: str, subject: str, body: str,
               to_addr: str | None = None, to_admins: bool = False) -> None:
    """Fire-and-forget: spawn a thread so the request never blocks on SMTP."""
    if alert_type not in _ALERT_KEYS:
        return
    def _run():
        cfg = smtp_config()
        if not cfg.get("enabled", True):
            return
        if not cfg.get("alerts", {}).get(alert_type, True):
            return
        targets: list[str] = []
        if to_addr:
            targets.append(to_addr)
        if to_admins:
            targets.extend(_admin_usernames())
        for t in dict.fromkeys(targets):  # dedupe, keep order
            _send(cfg, t, subject, body)
    threading.Thread(target=_run, daemon=True).start()


def user_email(username: str | None) -> str | None:
    """Resolve a user's email address (v1.6.40: case-insensitive).

    The lookup used to be an exact `username = :u` match. Usernames routinely
    differ in case between the identity source and the users row (LDAP
    sAMAccountName is usually lower-case), so `user_email("aungaung")` returned
    None for a row stored as "AungAung" and the "ticket created" mail was skipped
    while every in-app signal still fired. Matching case-insensitively removes a
    silent, hard-to-notice failure from the escalation path.
    """
    if not username:
        return None
    from sqlalchemy import text as _t

    from app.persistence.database import SessionLocal
    try:
        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT email FROM users WHERE lower(username) = lower(:u) LIMIT 1"),
                {"u": username},
            ).first()
        return row[0] if row and row[0] else None
    except Exception:
        return None


def notify_ticket_created(username: str | None, jira_key: str | None,
                          subject: str) -> None:
    """Alert the requester (and admins) that their ticket was opened."""
    if not username or not jira_key:
        return
    send_alert(
        "ticket_created",
        f"[iTH] Ticket {jira_key} created",
        f"Your request was escalated to Jira.\n\n"
        f"Ticket: {jira_key}\nSubject: {subject}\n"
        f"Status: Open — the IT team will follow up.\n",
        to_addr=user_email(username),
    )


def notify_ticket_status(username: str | None, jira_key: str,
                         old: str, new: str) -> None:
    if not username or not jira_key or old == new:
        return
    send_alert(
        "ticket_status_change",
        f"[iTH] Ticket {jira_key} → {new.upper()}",
        f"Ticket {jira_key} status changed: {old} → {new}\n",
        to_addr=user_email(username),
    )
