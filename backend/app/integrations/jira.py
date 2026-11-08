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
from urllib.parse import quote

from app.config import SETTINGS

_CREATE_PATH = "/secure/CreateIssueDetails!init.jspa"

# v1.6.4 — DB-first config overlay (system_settings["jira"] written by the
# Settings → Integrations UI), env SETTINGS as fallback. Without this the UI
# shows "configured" while escalate() still saw empty env vars and silently
# skipped Jira (tickets saved local-only with jira_key=NULL).
import time as _time

_JIRA_CFG_CACHE: dict | None = None
_JIRA_CFG_AT: float = 0.0
_JIRA_CFG_TTL = 30.0


def reload_jira_cfg() -> None:
    global _JIRA_CFG_CACHE, _JIRA_CFG_AT
    _JIRA_CFG_CACHE, _JIRA_CFG_AT = None, 0.0


def _jira_cfg() -> dict:
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
    except Exception:  # DB not ready — env fallback keeps dev working
        pass
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


def escalate(summary: str, description: str, reporter=None,
             project=None, assignee=None, domain=None) -> dict:
    """Create a Jira ticket via JSM API (preferred) or issue REST (fallback)."""
    cfg = _jira_cfg()
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
            return {"link": link, "mode": "jsm", "jira_key": key, "reporter": reporter}
        if cfg["email"] and cfg["api_token"]:
            key, link = _create_via_issue_rest(summary, description, reporter, project, assignee)
            return {"link": link, "mode": "rest", "jira_key": key, "reporter": reporter}
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


def _mock_key():
    import random
    return f"ESC-{random.randint(1000, 9999)}"


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
from app.integrations.ticket_status import (  # noqa: E402
    JIRA_TRANSITIONS_BY_CANONICAL as STATUS_TRANSITIONS,
    canonical_from_jira_status as _canonical_from_jira_status,
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

    names = STATUS_TRANSITIONS.get((status or "").lower(), [])
    auth = _auth_header()

    try:
        import httpx

        with httpx.Client(timeout=20,
                          headers={"Authorization": auth, "Accept": "application/json"}) as client:
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
