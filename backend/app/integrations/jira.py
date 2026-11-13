"""Jira escalation — Phase 6 + JSM customer-request (G3 delta).

Design:
- creds set  -> real JSM /rest/servicedeskapi/request (service account as reporter,
  authenticated username passed in custom field Chatbot User)
- base URL, no token (dev)  -> mock create (fake key, reporter = user)
- no base URL  -> pre-filled create link only (Phase 1)

Routing: per-domain via jira_request_types JSON ({"server":"101","network":"102"}).
"""
from __future__ import annotations

import base64
import json
import logging
from urllib.parse import quote

from app.config import SETTINGS

_CREATE_PATH = "/secure/CreateIssueDetails!init.jspa"

# v1.6.4 — DB-first config overlay (system_settings["jira"] written by the
# Settings → Integrations UI), env SETTINGS as fallback. Without this the UI
# shows "configured" while escalate() still saw empty env vars and silently
# skipped Jira (tickets saved local-only with jira_key=NULL).
import time as _time
from contextvars import ContextVar
from contextlib import contextmanager

logger = logging.getLogger(__name__)

_JIRA_CFG_CACHE: dict | None = None
_JIRA_CFG_AT: float = 0.0
_JIRA_CFG_TTL = 30.0


def reload_jira_cfg() -> None:
    global _JIRA_CFG_CACHE, _JIRA_CFG_AT
    _JIRA_CFG_CACHE, _JIRA_CFG_AT = None, 0.0


# The site a request is acting on. A ContextVar keeps every helper (`_auth_header`,
# `_create_via_jsm`, `assign_issue`, …) unchanged while letting one call target HQ Jira and
# the next target the local one — without leaking between concurrent requests.
_ACTIVE_CONN: ContextVar[dict | None] = ContextVar("jira_active_conn", default=None)


@contextmanager
def use_connection(conn: dict | None):
    """Bind a connection for the duration of a block (no-op for None)."""
    if not conn:
        yield
        return
    token = _ACTIVE_CONN.set(conn)
    try:
        yield
    finally:
        _ACTIVE_CONN.reset(token)


def _conn_cfg(conn: dict) -> dict:
    return {
        "base_url": str(conn.get("base_url") or ""),
        "email": str(conn.get("email") or ""),
        "api_token": str(conn.get("api_token") or ""),
        "project": str(conn.get("project_key") or ""),
        "service_desk_id": str(conn.get("service_desk_id") or SETTINGS.jira_service_desk_id or ""),
        "request_types": conn.get("request_types") or SETTINGS.jira_request_types,
    }


def _jira_cfg() -> dict:
    conn = _ACTIVE_CONN.get()
    if conn:
        return _conn_cfg(conn)
    global _JIRA_CFG_CACHE, _JIRA_CFG_AT
    now = _time.time()
    if _JIRA_CFG_CACHE is not None and (now - _JIRA_CFG_AT) < _JIRA_CFG_TTL:
        return _JIRA_CFG_CACHE
    out = {
        "base_url": SETTINGS.jira_base_url,
        "email": SETTINGS.jira_email,
        "api_token": SETTINGS.jira_token,
        "project": SETTINGS.jira_project,
        "service_desk_id": SETTINGS.jira_service_desk_id,
        "request_types": SETTINGS.jira_request_types,
    }
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal
        with SessionLocal() as s:
            row = s.execute(_t(
                "SELECT value FROM system_settings WHERE key = 'jira'")).first()
        val = row[0] if row else {}
        import json as _json
        if isinstance(val, str):
            val = _json.loads(val)
        val = val or {}
        # A saved row is the complete configuration. Borrowing individual fields from the
        # environment is how a stored token got sent with the wrong account's email and every
        # call came back 403 — see the same note in integrations/confluence.py.
        if val:
            out = {
                "base_url": str(val.get("base_url") or ""),
                "email": str(val.get("email") or ""),
                "api_token": str(val.get("api_token") or ""),
                "project": str(val.get("project_key") or val.get("project") or ""),
                "service_desk_id": str(val.get("service_desk_id") or ""),
                "request_types": (
                    val["request_types"] if isinstance(val.get("request_types"), str)
                    else _json.dumps(val.get("request_types") or "")
                ) if val.get("request_types") else "",
            }
    except Exception as exc:
        logger.debug("%s suppressed: %s", type(exc).__name__, exc)
    _JIRA_CFG_CACHE, _JIRA_CFG_AT = out, now
    return out


def build_create_link(summary: str, description: str) -> str:
    base = _jira_cfg()["base_url"].rstrip("/")
    q = f"?summary={quote(summary)}&description={quote(description)}"
    return f"{base}{_CREATE_PATH}{q}"


def _get_request_type(domain):
    raw = _jira_cfg()["request_types"]
    if not raw:
        return None
    try:
        table = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(table, dict):
        return None
    return table.get((domain or "").lower()) or table.get("general")


def domain_project(domain: str | None) -> str:
    """The Jira project a category escalates to, or "" when it has none configured.

    `classifier_domains.jira_project` is the per-domain route the Domains page shows; without
    it every domain silently used the global project while the board claimed "No Jira route".
    """
    key = (domain or "").strip().lower()
    if not key:
        return ""
    try:
        from sqlalchemy import text

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            return (s.execute(text(
                "SELECT jira_project FROM classifier_domains "
                "WHERE lower(domain_key) = :k AND is_active = true"), {"k": key}).scalar() or "")
    except Exception:
        return ""


def domain_connection_id(provider: str, domain: str | None) -> int | None:
    """Which site this domain's tickets belong to (NULL = the default one)."""
    key = (domain or "").strip().lower()
    if not key:
        return None
    col = "jira_connection_id" if provider == "jira" else "confluence_connection_id"
    try:
        from sqlalchemy import text

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            return s.execute(text(
                f"SELECT {col} FROM classifier_domains "
                "WHERE lower(domain_key) = :k AND is_active = true"
            ), {"k": key}).scalar()
    except Exception:
        return None


def connection_for(domain: str | None) -> dict | None:
    """The Jira connection a domain escalates through, else the first active one."""
    from app.integrations.connections import effective_connections, get_connection

    cid = domain_connection_id("jira", domain)
    if cid:
        conn = get_connection(int(cid))
        if conn:
            return conn
    conns = effective_connections("jira")
    return conns[0] if conns else None


def escalate(summary: str, description: str, reporter=None,
             project=None, assignee=None, domain=None) -> dict:
    """Create a ticket on the domain's Jira site (falls back to the default site)."""
    return _escalate_with(connection_for(domain), summary, description,
                          reporter=reporter, project=project, assignee=assignee, domain=domain)


def _escalate_with(conn, summary: str, description: str, reporter=None,
                   project=None, assignee=None, domain=None) -> dict:
    """Create a Jira ticket via JSM API (preferred) or issue REST (fallback)."""
    with use_connection(conn):
        return _escalate_locked(conn, summary, description, reporter, project, assignee, domain)


def _escalate_locked(conn, summary: str, description: str, reporter=None,
                     project=None, assignee=None, domain=None) -> dict:
    cfg = _jira_cfg()
    project = project or domain_project(domain) or (conn.get("project_key") if conn else "") or None
    if not cfg["base_url"]:
        return {"link": build_create_link(summary, description), "mode": "link",
                "jira_key": None, "reporter": reporter}

    service_desk_id = cfg["service_desk_id"]
    rt_id = _get_request_type(domain)

    try:
        if service_desk_id and rt_id and cfg["email"] and cfg["api_token"]:
            key, link = _create_via_jsm(
                service_desk_id, rt_id, summary, description, reporter, assignee, domain
            )
            assigned = assign_issue(key, assignee) if assignee else None
            return {"link": link, "mode": "jsm", "jira_key": key, "reporter": reporter,
                    "assignee": assigned}
        if cfg["email"] and cfg["api_token"]:
            key, link = _create_via_issue_rest(summary, description, reporter, project, assignee)
            assigned = assign_issue(key, assignee) if assignee else None
            return {"link": link, "mode": "rest", "jira_key": key, "reporter": reporter,
                    "assignee": assigned}
        # v1.6.4 — mock keys removed by policy: a ticket must exist in REAL Jira.
        # Without credentials we fail loudly (tickets API -> 502) instead of
        # inventing ESC-xxxx keys that never exist upstream.
        return {"link": build_create_link(summary, description), "mode": "link",
                "jira_key": None, "reporter": reporter,
                "error": "Jira credentials missing (email + api token) in Settings → Integrations"}
    except Exception as exc:
        return {"link": build_create_link(summary, description), "mode": "link",
                "jira_key": None, "reporter": reporter,
                "error": f"{type(exc).__name__}: {exc}"}


def _auth_header():
    """Basic auth needs the account email; a token on its own authenticates as nobody."""
    cfg = _jira_cfg()
    if not cfg.get("email"):
        raise ValueError(
            "Jira is half configured: an API token is saved but no account email. Atlassian "
            "requires both, from the same account. Open Settings → Integrations → Jira and add "
            "the account email."
        )
    if not cfg.get("api_token"):
        raise ValueError("Jira is half configured: no API token saved.")
    raw = f"{cfg['email']}:{cfg['api_token']}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _create_via_jsm(service_desk_id, request_type_id, summary, description,
                    reporter, assignee, domain):
    """POST /rest/servicedeskapi/request — JSM customer-request creation."""
    import httpx
    cfg = _jira_cfg()
    payload = {
        "serviceDeskId": service_desk_id,
        "requestTypeId": request_type_id,
        "requestFieldValues": {
            "summary": summary,
            "description": description,
        },
    }
    if reporter:
        payload["requestFieldValues"]["customfield_10001"] = reporter
    if domain:
        payload["requestFieldValues"]["customfield_10002"] = domain
    headers = {"Authorization": _auth_header(), "Accept": "application/json",
               "Content-Type": "application/json"}
    with httpx.Client(timeout=30) as client:
        r = client.post(f"{cfg['base_url'].rstrip('/')}/rest/servicedeskapi/request",
                        json=payload, headers=headers)
        r.raise_for_status()
        body = r.json()
    issue_key = body.get("issueKey") or body.get("key") or ""
    link = f"{cfg['base_url'].rstrip('/')}/browse/{issue_key}" if issue_key else ""
    return issue_key, link


def _adf_paragraphs(text: str) -> dict:
    """Plain text -> Atlassian Document Format. One paragraph per blank-line block, with
    hard breaks inside a block, so a markdown-ish draft keeps its shape in Jira."""
    blocks = [b.strip() for b in (text or "").split("\n\n") if b.strip()]
    content = []
    for block in blocks:
        nodes = []
        for i, line in enumerate(block.split("\n")):
            if i:
                nodes.append({"type": "hardBreak"})
            nodes.append({"type": "text", "text": line})
        content.append({"type": "paragraph", "content": nodes})
    return {"type": "doc", "version": 1,
            "content": content or [{"type": "paragraph", "content": []}]}


def create_issue(*, summary: str, description: str, project: str | None = None,
                 issue_type: str = "Task", priority: str | None = None,
                 custom_fields: dict | None = None, labels: list[str] | None = None,
                 reporter: str | None = None) -> dict:
    """Create with an explicit issue type, priority and custom fields.

    `escalate()` predates the reviewed-draft flow and always posts a "Task" with no
    priority; this is the path that honours what the user approved in the form.
    Returns {"jira_key", "link", "mode": "rest"} or {"jira_key": None, "error": ...}.
    """
    import httpx
    cfg = _jira_cfg()
    if not (cfg["base_url"] and cfg["email"] and cfg["api_token"]):
        return {"jira_key": None, "link": build_create_link(summary, description),
                "mode": "link",
                "error": "Jira credentials missing (email + API token) in Settings → Integrations"}

    fields: dict = {
        "project": {"key": project or cfg["project"]},
        "summary": summary,
        "description": _adf_paragraphs(description),
        "issuetype": {"name": issue_type or "Task"},
    }
    if priority:
        fields["priority"] = {"name": priority}
    if labels:
        fields["labels"] = labels
    for key, value in (custom_fields or {}).items():
        if value in (None, "", [], {}):
            continue
        fields[key] = value

    headers = {"Authorization": _auth_header(), "Accept": "application/json",
               "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=30) as client:
            r = client.post(f"{cfg['base_url'].rstrip('/')}/rest/api/3/issue",
                            json={"fields": fields}, headers=headers)
            if r.status_code >= 400:
                detail = ""
                try:
                    errs = (r.json() or {}).get("errors") or {}
                    detail = "; ".join(f"{k}: {v}" for k, v in errs.items()) or r.text[:300]
                except Exception:  # noqa: BLE001
                    detail = r.text[:300]
                return {"jira_key": None, "link": "", "mode": "rest",
                        "error": f"Jira rejected the ticket ({r.status_code}): {detail}"}
            body = r.json()
    except Exception as exc:  # noqa: BLE001
        return {"jira_key": None, "link": "", "mode": "rest",
                "error": f"{type(exc).__name__}: {exc}"}

    key = body.get("key", "")
    return {"jira_key": key or None,
            "link": f"{cfg['base_url'].rstrip('/')}/browse/{key}" if key else "",
            "mode": "rest", "reporter": reporter}


def _create_via_issue_rest(summary, description, reporter, project, assignee):
    """Standard POST /rest/api/3/issue fallback (no JSM service-desk)."""
    import httpx
    cfg = _jira_cfg()
    fields = {
        "project": {"key": project or cfg["project"]},
        "summary": summary,
        "description": {"type": "doc", "version": 1,
                        "content": [{"type": "paragraph",
                                     "content": [{"type": "text", "text": description}]}]},
        "issuetype": {"name": "Task"},
    }
    headers = {"Authorization": _auth_header(), "Accept": "application/json",
               "Content-Type": "application/json"}
    with httpx.Client(timeout=30) as client:
        r = client.post(f"{cfg['base_url'].rstrip('/')}/rest/api/3/issue",
                        json={"fields": fields}, headers=headers)
        r.raise_for_status()
        body = r.json()
    issue_key = body.get("key", "")
    return issue_key, f"{cfg['base_url'].rstrip('/')}/browse/{issue_key}"


# ---------------------------------------------------------------------------
# v0.20.5 — status transitions (chatbot -> Jira)
# ---------------------------------------------------------------------------

# chatbot status word -> acceptable Jira transition names (first match wins)
# v1.6.9 — canonical status model shared with OpenProject (ticket_status.py)
from app.integrations.ticket_status import (
    JIRA_TRANSITIONS_BY_CANONICAL as STATUS_TRANSITIONS,
)
from app.integrations.ticket_status import (
    canonical_from_jira_status as _canonical_from_jira_status,
)
from app.integrations.ticket_status import (
    is_terminal,
)


# ---------------------------------------------------------------------------
# v1.6.8 — Jira -> platform ticket sync (pull)
# ---------------------------------------------------------------------------
def fetch_all_tickets(max_results: int = 200) -> list[dict]:
    """Pull tickets from Jira so the Tickets board mirrors upstream.

    Strategy:
      1. JSM: GET /rest/servicedeskapi/request?limit=... (customer requests)
      2. Issue REST: GET /rest/api/3/search?jql=project=<key> ORDER BY created DESC
    Returns normalized dicts like openproject.fetch_work_packages():
      {ticket_id ('jira-<KEY>'), title, body, status, priority, assignee,
       source_url, created_at, source='jira'}
    """
    import httpx

    cfg = _jira_cfg()
    base = (cfg["base_url"] or "").rstrip("/")
    if not (base and cfg["email"] and cfg["api_token"]):
        return []

    headers = {"Authorization": _auth_header(), "Accept": "application/json"}
    out: list[dict] = []

    # 1) JSM customer requests (service desk portal)
    try:
        with httpx.Client(timeout=30, headers=headers) as client:
            r = client.get(f"{base}/rest/servicedeskapi/request",
                           params={"limit": min(max_results, 100)})
            if r.status_code == 200:
                for req_ in r.json().get("values", []):
                    key = req_.get("issueKey") or req_.get("key") or ""
                    if not key:
                        continue
                    fields = req_.get("requestFieldValues") or {}
                    status_name = ((req_.get("currentStatus") or {}).get("status")) or ""
                    links = (req_.get("_links") or {})
                    out.append({
                        "ticket_id": f"jira-{key}",
                        "jira_key": key,
                        "title": fields.get("summary") or f"{key} request",
                        "body": fields.get("description") or "",
                        "status": (status_name or "open").lower(),
                        "priority": "medium",
                        "assignee": "",
                        "source_url": links.get("agent") or f"{base}/browse/{key}",
                        "created_at": req_.get("createdDate", {}).get("iso8601")
                                      if isinstance(req_.get("createdDate"), dict) else None,
                        "source": "jira",
                    })
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("JSM request pull failed: %s", exc)

    # 2) Issue REST search (covers non-JSM issues in the project)
    try:
        jql = f"project = {cfg['project']} ORDER BY created DESC"
        with httpx.Client(timeout=30, headers=headers) as client:
            r = client.get(f"{base}/rest/api/3/search/jql",
                           params={"jql": jql, "maxResults": min(max_results, 100),
                                   "fields": "summary,description,status,priority,assignee,created"},
                           )
            if r.status_code == 200:
                for issue in r.json().get("issues", []):
                    key = issue.get("key", "")
                    f = issue.get("fields", {})
                    status_name = ((f.get("status") or {}).get("name")) or "open"
                    prio = ((f.get("priority") or {}).get("name")) or "medium"
                    assignee = ((f.get("assignee") or {}) or {}).get("displayName") or ""
                    out.append({
                        "ticket_id": f"jira-{key}",
                        "jira_key": key,
                        "title": f.get("summary") or f"{key} issue",
                        "body": (f.get("description") or "") if isinstance(f.get("description"), str) else "",
                        "status": status_name.lower(),
                        "priority": (prio or "medium").lower(),
                        "assignee": assignee,
                        "source_url": f"{base}/browse/{key}",
                        "created_at": f.get("created"),
                        "source": "jira",
                    })
            else:
                import logging
                logging.getLogger(__name__).warning(
                    "jira issue search HTTP %s: %s", r.status_code, r.text[:120])
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("jira issue search failed: %s", exc)

    # dedupe by ticket_id (JSM + REST can overlap on the same key)
    seen, dedup = set(), []
    for t in out:
        if t["ticket_id"] in seen:
            continue
        seen.add(t["ticket_id"])
        dedup.append(t)
    return dedup[:max_results]


def transition_issue(issue_key: str, status: str) -> dict:
    """Move a Jira issue to a new status. Returns {ok, detail}."""
    cfg = _jira_cfg()
    if not (cfg["base_url"] and cfg["email"] and cfg["api_token"]):
        return {"ok": False, "detail": "Jira not configured"}

    target = (status or "").lower()
    names = STATUS_TRANSITIONS.get(target, [])
    auth = _auth_header()

    try:
        import httpx

        with httpx.Client(timeout=20,
                          headers={"Authorization": auth, "Accept": "application/json"}) as client:
            # 0) Already where we want to be? A Jira project has ONE terminal status here
            # (Done), so "closed" on a Done issue has no transition to find — the correct
            # answer is "already done", not "no matching transition".
            live = fetch_issue_status(issue_key)
            if live.get("ok"):
                live_canon = _canonical_from_jira_status(live.get("status") or "")
                if live_canon == target or (
                    is_terminal(live_canon) and is_terminal(target)
                ):
                    return {"ok": True,
                            "detail": f"already '{live.get('status')}' in Jira"}

            # 1) list available transitions
            r = client.get(f"{cfg['base_url'].rstrip('/')}/rest/api/3/issue/{issue_key}/transitions")
            r.raise_for_status()
            available = {t["name"].lower(): t["id"] for t in r.json().get("transitions", [])}

            # 2) first matching transition name
            tid = next((available[n.lower()] for n in names if n.lower() in available), None)
            if tid is None:
                return {"ok": False,
                        "detail": f"no matching transition for '{status}' "
                                  f"(available: {list(available.keys())})"}

            # 3) perform the transition
            r2 = client.post(
                f"{cfg['base_url'].rstrip('/')}/rest/api/3/issue/{issue_key}/transitions",
                json={"transition": {"id": tid}},
            )
            r2.raise_for_status()
            return {"ok": True, "detail": f"transitioned via '{tid}'"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}


def fetch_issue_status(issue_key: str) -> dict:
    """Read the live status of a Jira issue. Returns {ok, status, assignee}."""
    cfg = _jira_cfg()
    if not (cfg["base_url"] and cfg["email"] and cfg["api_token"]):
        return {"ok": False, "detail": "Jira not configured"}
    try:
        import httpx

        with httpx.Client(timeout=15,
                          headers={"Authorization": _auth_header(), "Accept": "application/json"}) as client:
            r = client.get(
                f"{cfg['base_url'].rstrip('/')}/rest/api/3/issue/{issue_key}",
                params={"fields": "status,assignee"},
            )
            if r.status_code == 404:
                # The ONLY answer that means "this ticket no longer exists in Jira". Callers
                # that mirror Jira (reconciliation) must not treat a timeout as a deletion.
                return {"ok": False, "missing": True, "detail": "issue not found (404)"}
            r.raise_for_status()
            f = r.json().get("fields", {})
            return {
                "ok": True,
                "status": (f.get("status") or {}).get("name", "").lower(),
                "assignee": ((f.get("assignee") or {}).get("name")
                             or (f.get("assignee") or {}).get("accountId") or None),
            }
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}

def jira_get(path: str, params: dict | None = None) -> dict:
    """GET a Jira REST path with the stored credentials (used by discovery endpoints)."""
    import httpx

    cfg = _jira_cfg()
    if not (cfg["base_url"] and cfg["email"] and cfg["api_token"]):
        raise RuntimeError("Jira credentials missing (email + API token) in Settings → Integrations")
    with httpx.Client(timeout=20, headers={"Authorization": _auth_header(),
                                          "Accept": "application/json"}) as client:
        r = client.get(cfg["base_url"].rstrip("/") + path, params=params or {})
        r.raise_for_status()
        return r.json()


def service_desks() -> list[dict]:
    """JSM service desks visible to the configured account: [{id, projectKey, name}]."""
    body = jira_get("/rest/servicedeskapi/servicedesk", {"limit": 50})
    out = []
    for d in (body.get("values") or []):
        out.append({"id": str(d.get("id") or ""), "projectKey": d.get("projectKey") or "",
                    "name": d.get("projectName") or d.get("projectKey") or ""})
    return out


def request_types(desk_id: str) -> list[dict]:
    """Request types for one service desk: [{id, name, group}]."""
    body = jira_get(f"/rest/servicedeskapi/servicedesk/{desk_id}/requesttype", {"limit": 50})
    return [{"id": str(t.get("id") or ""), "name": t.get("name") or ""}
            for t in (body.get("values") or [])]


# ---------------------------------------------------------------- assignment

_USER_CACHE: dict[tuple[str, str], tuple[float, dict | None]] = {}
_USER_TTL = 600.0


def resolve_jira_user(identifier: str, issue_key: str = "") -> dict | None:
    """Map an app username/email/display name onto a Jira account.

    Returns the Jira user dict (with `accountId`) or None. Cached for ten minutes because the
    assignee dropdown asks about every candidate each time it opens, and Jira's user search is
    the slowest call in that path.
    """
    import time

    cfg = _jira_cfg()
    ident = (identifier or "").strip()
    if not ident or not (cfg.get("base_url") and cfg.get("api_token") and cfg.get("email")):
        return None
    cache_key = (ident.lower(), issue_key or "")
    hit = _USER_CACHE.get(cache_key)
    if hit and time.time() - hit[0] < _USER_TTL:
        return hit[1]

    base = cfg["base_url"].rstrip("/")
    headers = {"Authorization": _auth_header(), "Accept": "application/json"}
    found: dict | None = None
    try:
        import httpx

        with httpx.Client(timeout=15, headers=headers) as client:
            candidates: list[dict] = []
            if issue_key:
                r = client.get(f"{base}/rest/api/3/user/assignable/search",
                               params={"issueKey": issue_key, "query": ident, "maxResults": 50})
                if r.status_code == 200:
                    candidates = r.json() or []
            if not candidates:
                r = client.get(f"{base}/rest/api/3/user/search",
                               params={"query": ident, "maxResults": 50})
                if r.status_code == 200:
                    candidates = r.json() or []
            exact = next(
                (c for c in candidates
                 if ident.lower() in {
                     (c.get("accountId") or "").lower(),
                     (c.get("emailAddress") or "").lower(),
                     (c.get("displayName") or "").lower(),
                     (c.get("name") or "").lower(),
                 }),
                None,
            )
            # Jira's search is fuzzy: an app username ("AungAung") can match a single account
            # whose display name is "Aung Lay". Accept a lone candidate, but never guess between
            # several — assigning the wrong person is worse than reporting no match.
            match = exact or (candidates[0] if len(candidates) == 1 else None)
            if match and match.get("accountId"):
                found = match
    except Exception:
        found = None

    _USER_CACHE[cache_key] = (time.time(), found)
    return found


def unassign_issue(issue_key: str) -> dict:
    """Clear the assignee in Jira (Jira models that as accountId: null)."""
    cfg = _jira_cfg()
    base = cfg["base_url"].rstrip("/")
    headers = {"Authorization": _auth_header(), "Accept": "application/json"}
    try:
        import httpx

        with httpx.Client(timeout=20, headers=headers) as client:
            put = client.put(f"{base}/rest/api/3/issue/{issue_key}/assignee",
                             json={"accountId": None})
            if put.status_code in (200, 201, 204):
                return {"ok": True, "display_name": None}
            return {"ok": False, "detail": f"HTTP {put.status_code}: {put.text[:200]}"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}


def assign_issue(issue_key: str, identifier: str) -> dict:
    """Assign an issue to a person.

    Jira takes an `accountId`; this app stores usernames and emails. Resolution is delegated to
    `resolve_jira_user`, and a miss is reported — never swallowed, because a ticket that looks
    owned in this app but is unassigned in Jira is worse than one that is visibly unassigned.
    """
    ident = (identifier or "").strip()
    if not ident:
        return {"ok": False, "detail": "nothing to assign"}
    match = resolve_jira_user(ident, issue_key)
    if not match:
        return {"ok": False, "detail": f"no Jira user matches '{ident}'"}
    cfg = _jira_cfg()
    base = cfg["base_url"].rstrip("/")
    headers = {"Authorization": _auth_header(), "Accept": "application/json"}
    try:
        import httpx

        with httpx.Client(timeout=20, headers=headers) as client:
            put = client.put(f"{base}/rest/api/3/issue/{issue_key}/assignee",
                             json={"accountId": match["accountId"]})
            if put.status_code in (200, 201, 204):
                return {"ok": True, "account_id": match["accountId"],
                        "display_name": match.get("displayName")}
            return {"ok": False, "detail": f"HTTP {put.status_code}: {put.text[:200]}"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------- comments & attachments

def _issue_url(path: str) -> str:
    cfg = _jira_cfg()
    return cfg["base_url"].rstrip("/") + path


def internal_roles() -> list[str]:
    """Project roles an internal note may be restricted to, most specific first.

    The first entry is the support-team role; if the API account does not hold it (Jira
    refuses to restrict a comment to a role the author is not in), the administrator role is
    used instead — still invisible to customers.
    """
    import os

    first = (os.getenv("JIRA_INTERNAL_ROLE") or "Service Desk Team").strip()
    roles = [first, "Administrators"]
    return [r for i, r in enumerate(roles) if r and r not in roles[:i]]


def add_comment(issue_key: str, body: str, internal: bool = False) -> dict:
    """Post a comment to the Jira issue. Jira Cloud v3 wants an ADF document, not a string.

    `internal` restricts the comment to agents. On a Jira Service Management project that is
    the native "internal note" (`public: false`); on a business/software project the same idea
    is a visibility restriction. Posting an internal note as a plain comment would show the
    support team's notes to the customer, so the flag is threaded all the way from the UI.
    """
    cfg = _jira_cfg()
    if not (cfg.get("base_url") and cfg.get("api_token")):
        return {"ok": False, "detail": "Jira is not configured"}
    text = (body or "").strip()
    if not text:
        return {"ok": False, "detail": "empty comment"}
    adf = {
        "type": "doc",
        "version": 1,
        "content": [{
            "type": "paragraph",
            "content": [{"type": "text", "text": text[:30000]}],
        }],
    }
    try:
        import httpx

        with httpx.Client(timeout=20, headers={
            "Authorization": _auth_header(),
            "Accept": "application/json",
            "Content-Type": "application/json",
        }) as client:
            if internal:
                # JSM has a dedicated endpoint whose `public` flag is the internal-note switch.
                sd = client.post(
                    _issue_url(f"/rest/servicedeskapi/request/{issue_key}/comment"),
                    json={"body": text[:30000], "public": False},
                )
                if sd.status_code in (200, 201):
                    return {"ok": True, "id": (sd.json() or {}).get("id"),
                            "internal": True, "via": "servicedeskapi"}
                logger.info("JSM internal comment failed for %s: HTTP %s %s",
                            issue_key, sd.status_code, sd.text[:160])
            else:
                r = client.post(_issue_url(f"/rest/api/3/issue/{issue_key}/comment"), json={"body": adf})
                if r.status_code in (200, 201):
                    return {"ok": True, "id": (r.json() or {}).get("id"),
                            "internal": False, "via": "rest/api/3"}
                return {"ok": False, "detail": f"HTTP {r.status_code}: {r.text[:200]}"}

            # Fallback: a role-restricted comment. `properties: [{"key": "sdPublic"}]` is
            # rejected by the platform API ("not a valid JSON"), and the JSM endpoint only
            # answers for issues that came through a portal, so role visibility is the one
            # mechanism that works for every issue — customers hold the "Service Desk
            # Customers" role and therefore never see a comment restricted to agents.
            last = None
            for role in internal_roles():
                r = client.post(
                    _issue_url(f"/rest/api/3/issue/{issue_key}/comment"),
                    json={**{"body": adf}, "visibility": {"type": "role", "value": role}},
                )
                if r.status_code in (200, 201):
                    return {"ok": True, "id": (r.json() or {}).get("id"),
                            "internal": True, "via": f"role:{role}"}
                last = f"HTTP {r.status_code}: {r.text[:180]}"
                # Only a role the author does not hold is worth skipping past; any other
                # refusal means the project will not take a restricted comment at all.
                if "not a member of the project role" not in r.text:
                    break
            return {"ok": False, "detail": last or "internal comment refused"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}


def upload_attachment(issue_key: str, filename: str, content: bytes, mime: str) -> dict:
    """Attach a file to the Jira issue.

    `X-Atlassian-Token: no-check` is mandatory for multipart uploads (Jira's XSRF guard);
    without it the API answers 403 and the file silently never leaves this app.
    """
    cfg = _jira_cfg()
    if not (cfg.get("base_url") and cfg.get("api_token")):
        return {"ok": False, "detail": "Jira is not configured"}
    if not content:
        return {"ok": False, "detail": "empty file"}
    try:
        import httpx

        with httpx.Client(timeout=60, headers={
            "Authorization": _auth_header(),
            "Accept": "application/json",
            "X-Atlassian-Token": "no-check",
        }) as client:
            r = client.post(
                _issue_url(f"/rest/api/3/issue/{issue_key}/attachments"),
                files={"file": (filename, content, mime or "application/octet-stream")},
            )
            if r.status_code in (200, 201):
                data = r.json() or []
                return {"ok": True, "id": (data[0] or {}).get("id") if data else None,
                        "filename": (data[0] or {}).get("filename") if data else filename}
            return {"ok": False, "detail": f"HTTP {r.status_code}: {r.text[:200]}"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}

def _adf(text: str) -> dict:
    """Jira Cloud v3 takes rich text, and a plain string is rejected with 400."""
    blocks = [ln for ln in (text or "").splitlines()]
    return {"type": "doc", "version": 1, "content": [
        {"type": "paragraph", "content": ([{"type": "text", "text": ln}] if ln else [])}
        for ln in blocks
    ] or [{"type": "paragraph", "content": []}]}


PRIORITY_NAMES = {"low": "Low", "medium": "Medium", "high": "High", "urgent": "Highest"}


def update_issue_fields(issue_key: str, *, summary: str | None = None,
                        description: str | None = None, priority: str | None = None,
                        due_date: str | None = None) -> dict:
    """Write the editable fields of an issue. Returns {ok, detail?}.

    The board used to edit only its own row, so a ticket whose summary said one thing here and
    another in Jira was normal. Fields travel together in one PUT because Jira applies them
    atomically — a half-applied edit is exactly the drift this endpoint removes.
    """
    cfg = _jira_cfg()
    if not cfg.get("base_url"):
        return {"ok": False, "detail": "Jira is not configured"}
    fields: dict = {}
    if summary is not None:
        fields["summary"] = summary[:255]
    if description is not None:
        fields["description"] = _adf(description)
    if priority:
        fields["priority"] = {"name": PRIORITY_NAMES.get(priority.lower(), priority.title())}
    if due_date is not None:
        fields["duedate"] = due_date or None
    if not fields:
        return {"ok": True, "skipped": True}

    import httpx

    try:
        with httpx.Client(timeout=30) as c:
            r = c.put(f"{cfg['base_url']}/rest/api/3/issue/{issue_key}",
                      headers={"Authorization": _auth_header(),
                               "Accept": "application/json",
                               "Content-Type": "application/json"},
                      json={"fields": fields})
        if r.status_code >= 400:
            detail = ""
            try:
                detail = r.json().get("errorMessages") and "; ".join(r.json()["errorMessages"]) or ""
                errs = r.json().get("errors") or {}
                if errs:
                    detail = (detail + " " + "; ".join(f"{k}: {v}" for k, v in errs.items())).strip()
            except Exception:
                detail = (r.text or "")[:200]
            return {"ok": False, "detail": detail or f"HTTP {r.status_code}"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True}


def delete_attachment(attachment_id: str) -> dict:
    """Remove an attachment from Jira. Deleting only the local row left an orphan in the issue."""
    cfg = _jira_cfg()
    if not cfg.get("base_url") or not attachment_id:
        return {"ok": False, "detail": "no attachment to delete"}
    import httpx

    try:
        with httpx.Client(timeout=30) as c:
            r = c.delete(f"{cfg['base_url']}/rest/api/3/attachment/{attachment_id}",
                         headers={"Authorization": _auth_header(), "Accept": "application/json"})
        if r.status_code in (200, 204, 404):
            return {"ok": True, "already_gone": r.status_code == 404}
        return {"ok": False, "detail": (r.text or "")[:200] or f"HTTP {r.status_code}"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


def list_attachment_ids(issue_key: str, filename: str | None = None) -> dict:
    """Look up an issue's attachments (optionally by filename). Returns {ok, ids, deleted}.

    Rows uploaded before `ticket_attachments.jira_attachment_id` existed cannot say which Jira
    attachment they are, so the delete path matches on the filename the user sees.
    """
    cfg = _jira_cfg()
    if not cfg.get("base_url"):
        return {"ok": False, "ids": [], "deleted": 0, "detail": "Jira is not configured"}
    import httpx

    try:
        with httpx.Client(timeout=30) as c:
            r = c.get(f"{cfg['base_url']}/rest/api/3/issue/{issue_key}",
                      headers={"Authorization": _auth_header(), "Accept": "application/json"},
                      params={"fields": "attachment"})
        if r.status_code >= 400:
            return {"ok": False, "ids": [], "deleted": 0, "detail": f"HTTP {r.status_code}"}
        items = (r.json().get("fields") or {}).get("attachment") or []
        matches = [i for i in items if filename is None or i.get("filename") == filename]
        deleted = 0
        for item in matches:
            if delete_attachment(str(item.get("id"))).get("ok"):
                deleted += 1
        return {"ok": True, "ids": [i.get("id") for i in matches], "deleted": deleted}
    except Exception as exc:
        return {"ok": False, "ids": [], "deleted": 0, "detail": str(exc)}
