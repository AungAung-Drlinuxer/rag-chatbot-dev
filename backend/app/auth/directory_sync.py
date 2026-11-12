"""Reconcile the local user table against the directory.

The app builds `/api/users` from two sources: the `users` table (everyone who ever signed in,
plus anyone an admin touched) and a live LDAP search. That means a person deleted from AD
keeps a row here forever — nothing ever compared the two lists.

This module is that comparison. It is deliberately conservative, because a bad sync can
deactivate an entire organisation:

  * it reads the directory twice — enabled accounts and disabled ones — so "disabled in AD"
    is not mistaken for "deleted in AD";
  * it does nothing at all when the search fails, returns nothing, or hits the size limit
    (that is a directory problem, not a staff exodus);
  * it refuses to remove a large share of the linked accounts in one run (three or more,
    and more than `MAX_REMOVAL_RATIO`) unless the caller passes `force`;
  * an account must be missing twice in a row before it is marked removed, so one flaky
    search does not cut somebody off;
  * only rows linked to the directory (`ldap_dn` set) are ever touched — local accounts and
    the break-glass admin are out of scope.

States: `active` → `suspended` (disabled in AD) or `removed` (gone from AD). A row that
reappears in AD is restored and keeps its role override, group memberships and history.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

logger = logging.getLogger("directory")

# Two misses before removal: a directory that answers with a partial page for one run must
# not be read as "everybody was deleted".
MISSES_BEFORE_REMOVAL = 2
MAX_REMOVAL_RATIO = 0.2
SIZE_LIMIT = 500
AUTO_INTERVAL = 600.0  # seconds between opportunistic runs from the user list

_last_auto_run: float = 0.0

_ACTIVE_FILTER = (
    "(&(objectClass=user)(objectCategory=person)"
    "(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
)
_DISABLED_FILTER = (
    "(&(objectClass=user)(objectCategory=person)"
    "(userAccountControl:1.2.840.113556.1.4.803:=2))"
)
_ATTRS = ["sAMAccountName", "distinguishedName", "mail", "department"]


def _search(filter_clause: str, *, limit: int = SIZE_LIMIT) -> dict[str, dict] | None:
    """Return {sAMAccountName: {...}} or None when the directory cannot answer.

    None is the "unknown" signal — the caller must not treat it as an empty directory.
    """
    from ldap3 import ALL, Connection, Server

    from app.auth.ldap_auth import ldap_cfg

    cfg = ldap_cfg()
    url, base, bind_dn, bind_pw = (
        cfg.get("url"), cfg.get("base_dn"), cfg.get("bind_dn"), cfg.get("bind_password"),
    )
    if not (url and base):
        return None
    try:
        server = Server(url, get_info=ALL, connect_timeout=8)
        conn = Connection(server, user=bind_dn, password=bind_pw,
                          auto_bind=True, receive_timeout=25)
        conn.search(base, filter_clause, attributes=_ATTRS, size_limit=limit)
        # ldap3 returns False for "no entries", which is a legitimate empty result — the
        # disabled-account search is empty on a healthy directory. Trust the result code,
        # not the return value.
        result = conn.result or {}
        if str(result.get("description") or "").lower() not in ("success", ""):
            logger.warning("directory search refused: %s", result.get("description"))
            return None
        rows: dict[str, dict] = {}
        for e in conn.entries:
            name = str(e.sAMAccountName) if e.sAMAccountName else None
            if not name:
                continue
            rows[name] = {
                "dn": str(e.distinguishedName) if e.distinguishedName else None,
                "email": str(e.mail) if e.mail else None,
                "department": str(e.department) if e.department else None,
            }
        conn.unbind()
        return rows
    except Exception as exc:
        logger.warning("directory search failed: %s: %s", type(exc).__name__, exc)
        return None


def fetch_directory() -> dict:
    """{active: {...}, disabled: {...}, complete: bool, reason: str|None}."""
    active = _search(_ACTIVE_FILTER)
    if active is None:
        return {"active": {}, "disabled": {}, "complete": False,
                "reason": "directory unreachable or search failed"}
    disabled = _search(_DISABLED_FILTER)
    if disabled is None:
        return {"active": {}, "disabled": {}, "complete": False,
                "reason": "disabled-account search failed"}
    complete = len(active) < SIZE_LIMIT
    reason = None if complete else f"directory returned the {SIZE_LIMIT}-account limit — partial page"
    return {"active": active, "disabled": disabled, "complete": complete, "reason": reason}


def plan(rows: list[dict], active_names: set[str], disabled_names: set[str],
         force: bool = False) -> dict:
    """Decide what a sync should do, without touching the database.

    Pure on purpose: the destructive half of provisioning deserves tests that do not need a
    Postgres, and an admin can be shown the plan before it is applied.

    `active_names` / `disabled_names` must be lower-cased; AD's sAMAccountName is not
    case-sensitive and a case mismatch once made every account look deleted.
    """
    def find(name: str) -> dict | None:
        return next((r for r in rows if str(r["username"]).lower() == name.lower()), None)

    restore: list[str] = []
    suspend: list[str] = []
    remove: list[str] = []
    missing: list[str] = []

    for name in active_names:
        row = find(name)
        if row is not None and (row.get("state") or "active").lower() != "active":
            restore.append(row["username"])

    for name in disabled_names:
        row = find(name)
        if row is not None and row.get("ldap_dn"):
            if (row.get("state") or "active").lower() != "suspended":
                suspend.append(row["username"])

    linked = [r for r in rows if r.get("ldap_dn")]
    candidates = [
        r["username"] for r in linked
        if (r.get("state") or "active").lower() != "removed"
        and str(r["username"]).lower() not in active_names
        and str(r["username"]).lower() not in disabled_names
    ]
    ratio = len(candidates) / max(1, len(linked))
    # The guard is for a directory that answered badly, not for a small team where one
    # person leaving is 50% of the linked accounts. Hence the absolute floor as well.
    blocked = len(candidates) >= 3 and not force and ratio > MAX_REMOVAL_RATIO

    if not blocked:
        for name in candidates:
            row = find(name)
            misses = int((row or {}).get("missing_scans") or 0) + 1
            (remove if misses >= MISSES_BEFORE_REMOVAL else missing).append(name)

    return {
        "restore": restore, "suspend": suspend, "remove": remove, "missing": missing,
        "blocked": blocked, "candidates": len(candidates), "linked": len(linked),
        "reason": (
            f"{len(candidates)} of {max(1, len(linked))} linked accounts vanished at once — "
            "refusing to remove them without force"
        ) if blocked else None,
    }


def reconcile(force: bool = False, actor: str = "system") -> dict:
    """Compare the directory with the `users` table and apply the differences."""
    from sqlalchemy import text

    from app.persistence.database import SessionLocal

    snap = fetch_directory()
    summary = {
        "ran": False, "reason": snap["reason"], "directory_active": len(snap["active"]),
        "directory_disabled": len(snap["disabled"]), "linked": 0, "restored": 0,
        "suspended": 0, "removed": 0, "missing_once": 0, "skipped_removal": 0,
    }
    if not snap["complete"]:
        summary["reason"] = summary["reason"] or "incomplete directory snapshot"
        return summary

    active_names = {n.lower() for n in snap["active"]}
    disabled_names = {n.lower() for n in snap["disabled"]}

    with SessionLocal() as s:
        rows = [dict(r) for r in s.execute(text(
            "SELECT username, ldap_dn, COALESCE(state, 'active') AS state, missing_scans "
            "FROM users"
        )).mappings().all()]
        decision = plan(rows, active_names, disabled_names, force=force)
        summary["linked"] = decision["linked"]
        summary["skipped_removal"] = decision["candidates"] if decision["blocked"] else 0
        if decision["reason"]:
            summary["reason"] = decision["reason"]

        # Link everyone the directory knows, even if they never signed in here.
        for name, info in snap["active"].items():
            s.execute(text(
                "UPDATE users SET ldap_dn = COALESCE(:dn, ldap_dn), directory_seen_at = NOW(), "
                "missing_scans = 0 WHERE lower(username) = lower(:u)"
            ), {"dn": info.get("dn"), "u": name})

        for name in decision["restore"]:
            s.execute(text(
                "UPDATE users SET state = 'active', status = 'Active', removed_at = NULL, "
                "disabled_at = NULL, missing_scans = 0 WHERE username = :u"
            ), {"u": name})
            summary["restored"] += 1

        for name in decision["suspend"]:
            s.execute(text(
                "UPDATE users SET state = 'suspended', status = 'Disabled', "
                "disabled_at = COALESCE(disabled_at, NOW()), missing_scans = 0 "
                "WHERE username = :u"
            ), {"u": name})
            summary["suspended"] += 1

        for name in decision["missing"]:
            s.execute(text(
                "UPDATE users SET state = 'suspended', status = 'Disabled', "
                "missing_scans = COALESCE(missing_scans, 0) + 1, "
                "disabled_at = COALESCE(disabled_at, NOW()) WHERE username = :u"
            ), {"u": name})
            summary["missing_once"] += 1

        for name in decision["remove"]:
            s.execute(text(
                "UPDATE users SET state = 'removed', status = 'Disabled', "
                "removed_at = COALESCE(removed_at, NOW()), missing_scans = "
                "COALESCE(missing_scans, 0) + 1, disabled_at = COALESCE(disabled_at, NOW()) "
                "WHERE username = :u"
            ), {"u": name})
            summary["removed"] += 1
        s.commit()

    summary["linked"] = len([r for r in rows if r["ldap_dn"]]) + sum(
        1 for r in rows if not r["ldap_dn"] and r["username"].lower() in active_names)
    summary["ran"] = True
    try:
        from app.observability.audit import audit

        audit(
            "directory.sync", actor,
            detail=(f"active={summary['directory_active']} disabled={summary['directory_disabled']} "
                    f"suspended={summary['suspended']} removed={summary['removed']} "
                    f"restored={summary['restored']} missing_once={summary['missing_once']}"),
        )
    except Exception as exc:  # audit must never break provisioning
        logger.debug("%s suppressed: %s", type(exc).__name__, exc)
    return summary


def maybe_auto_sync() -> dict | None:
    """Run at most once every ten minutes when the user list is opened."""
    global _last_auto_run
    now = time.time()
    if now - _last_auto_run < AUTO_INTERVAL:
        return None
    _last_auto_run = now
    try:
        from app.auth.ldap_auth import ldap_cfg

        cfg = ldap_cfg()
        if not (cfg.get("url") and cfg.get("base_dn")):
            return None
        return reconcile(actor="system:auto")
    except Exception as exc:
        logger.warning("automatic directory sync failed: %s", exc)
        return None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)