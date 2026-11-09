"""Validate a ticket draft against the live Jira configuration.

The point is to fail in the form — before the user clicks "Confirm & Create" — instead of
returning a 400 from Jira after they have typed everything. Jira is the authority: project
keys, issue types, priorities and required custom fields all come from its metadata.

Metadata is cached for 60 seconds: the form asks for it on open, the submit path asks
again, and Jira's createmeta is a slow call.
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger("escalation.jira")

_TTL = 60.0
_cache: dict[str, tuple[float, dict]] = {}

FALLBACK_PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"]


def _cached(key: str, producer) -> dict:
    now = time.time()
    hit = _cache.get(key)
    if hit and (now - hit[0]) < _TTL:
        return hit[1]
    value = producer()
    _cache[key] = (now, value)
    return value


def reload() -> None:
    _cache.clear()


def configured() -> bool:
    from app.integrations.jira import _jira_cfg

    cfg = _jira_cfg()
    return bool(cfg["base_url"] and cfg["email"] and cfg["api_token"])


def priorities() -> list[str]:
    if not configured():
        return list(FALLBACK_PRIORITIES)

    def fetch() -> dict:
        from app.integrations.jira import jira_get

        data = jira_get("/rest/api/3/priority")
        names = [p.get("name") for p in data or [] if isinstance(p, dict) and p.get("name")]
        return {"priorities": names}

    try:
        return _cached("priorities", fetch).get("priorities") or list(FALLBACK_PRIORITIES)
    except Exception as exc:  # noqa: BLE001
        logger.info("priority lookup failed (%s): %s", type(exc).__name__, exc)
        return list(FALLBACK_PRIORITIES)


def create_meta(project: str) -> dict:
    """{issue_types: [{id,name,subtask}], required_fields: [{key,name}]} for a project."""
    project = (project or "").strip()
    if not project:
        raise ValueError("project is required")

    def fetch() -> dict:
        from app.integrations.jira import jira_get

        data = jira_get("/rest/api/3/issue/createmeta",
                        {"projectKeys": project, "expand": "projects.issuetypes.fields"})
        projects = (data or {}).get("projects") or []
        if not projects:
            raise RuntimeError(f"Jira does not expose project '{project}' to this account")
        entry = projects[0]
        issue_types = [
            {"id": str(t.get("id")), "name": t.get("name"), "subtask": bool(t.get("subtask"))}
            for t in entry.get("issuetypes") or []
        ]
        required = []
        for it in entry.get("issuetypes") or []:
            fields = it.get("fields") or {}
            names = []
            for key, spec in fields.items():
                if not isinstance(spec, dict) or not spec.get("required"):
                    continue
                if spec.get("hasDefaultValue"):
                    continue
                names.append({"key": key, "name": spec.get("name") or key})
            if names:
                required.append({"issue_type": it.get("name"), "fields": names})
        return {"issue_types": issue_types, "required_fields": required}

    return _cached(f"meta:{project}", fetch)


def validate(fields: dict) -> list[str]:
    """Errors as human sentences; empty list means "postable"."""
    errors: list[str] = []
    summary = str(fields.get("summary") or "").strip()
    description = str(fields.get("description") or "").strip()
    project = str(fields.get("project") or "").strip()

    if not summary:
        errors.append("Summary is required.")
    elif len(summary) > 255:
        errors.append("Summary must be 255 characters or fewer.")
    if not description:
        errors.append("Description is required.")
    if not project:
        errors.append("Project is required.")
    if not str(fields.get("issue_type") or "").strip():
        errors.append("Issue type is required.")

    if not configured():
        errors.append("Jira is not configured — add the base URL, email and API token in "
                      "Settings → Integrations before creating tickets.")
        return errors

    allowed_priority = [p.lower() for p in priorities()]
    priority = str(fields.get("priority") or "").strip()
    if priority and priority.lower() not in allowed_priority:
        errors.append(f"Priority '{priority}' is not one of: {', '.join(priorities())}.")

    if project:
        try:
            meta = create_meta(project)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Could not read Jira metadata for {project}: {exc}")
            return errors

        wanted = str(fields.get("issue_type") or "").strip().lower()
        names = {t["name"].lower() for t in meta["issue_types"] if not t.get("subtask")}
        if wanted and names and wanted not in names:
            errors.append(
                f"Issue type '{fields.get('issue_type')}' is not available in {project}. "
                f"Choose one of: {', '.join(sorted(names))}.")

        supplied = {str(k): v for k, v in (fields.get("custom_fields") or {}).items()}
        for group in meta.get("required_fields") or []:
            if str(group.get("issue_type") or "").lower() != wanted:
                continue
            for field in group.get("fields") or []:
                # Jira lists project/summary/description/issuetype as "required" too; they
                # are the top-level fields validated above, not custom inputs.
                if not str(field.get("key", "")).startswith("customfield_"):
                    continue
                if not str(supplied.get(field["key"]) or "").strip():
                    errors.append(f"'{field['name']}' is required by Jira for this issue type.")

    return errors
