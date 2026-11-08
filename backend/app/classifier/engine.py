"""Domain classifier — Stage 1 fast keyword rules (<1ms); Stage 2 metadata fallback.

Returns (domain, confidence). Keyword hits → high confidence. No hit → "general" with
low confidence; the pipeline then overrides the domain with the top retrieved doc's
stored domain (Stage 2 approximate ML/zero-shot fallback) when Stage 1 < 0.7.

v0.22.x — Dynamically loads active domains & keywords from PostgreSQL (classifier_domains),
cached in-memory for sub-millisecond classification. Falls back to static defaults if DB unreachable.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

logger = logging.getLogger("classifier")

LOCKDOWN = "general"
STAGE1_CONFIDENCE = 0.7  # below this, pipeline triggers Stage 2

SECURITY_TERMS = [
    "suspicious", "unauthorized", "breach", "intrusion", "phishing", "malware",
    "brute force", "credential", "certificate", "tls", "ssl", "apparmor",
    "access denied", "permission", "login", "log in", "authentication failure",
]

DEFAULT_KEYWORD_RULES: dict[str, list[str]] = {
    "database": ["database", "postgres", "oracle", "sql", "ora-", "timeout",
                 "connection refused", "disk full", "backup", "slow query",
                 "deadlock", "replication", "pool exhaust", "vacuum", "wal"],
    "network": ["network", "internet", "dns", "wifi", "firewall", "vpn",
                "no internet", "speed", "connectivity", "ip", "interface",
                "eth0", "gateway", "proxy", "ntp", "chrony", "latency",
                "route", "traceroute", "ping"],
    "security": ["security", "password", "unauthorized", "access denied",
                 "permission", "account", "2fa", "mfa", "lockout", "phishing",
                 "suspicious", "breach", "certificate", "tls", "ssl",
                 "apparmor", "credential", "brute force"],
    "server": ["server", "service", "cpu", "memory", "ram", "crash", "restart", "reboot", "process", "resource", "kill", "oom", "out of memory", "systemd", "journalctl", "disk usage", "filesystem", "lvm", "kubernetes", "k8s", "kubectl", "pod", "pvc", "helm", "imagepullbackoff", "crashloopbackoff", "statefulset", "deployment", "rollout", "daemonset", "nfs", "storage", "mount", "disk io", "iops", "partition", "application", "app crash", "outlook", "teams", "zoom", "office", "excel", "word", "browser", "chrome", "edge", "print", "printer", "license", "install", "update failed", "software"],
    "kubernetes": ["kubernetes", "k8s", "kubectl", "pod", "node notready", "pvc", "pv",
                   "helm", "crashloopbackoff", "imagepullbackoff", "oomkilled", "deployment",
                   "ingress", "namespace", "rke2", "container"],
    "storage": ["storage", "nfs", "mount", "filesystem", "disk space", "smb", "share",
                "ceph", "volume", "partition", "lvm", "raid"],
}

# In-memory cache for ultra-fast classification
_cache_lock = threading.Lock()
_cached_rules: dict[str, list[str]] = dict(DEFAULT_KEYWORD_RULES)
_last_loaded: float = 0.0
_CACHE_TTL = 300.0  # background check every 5 mins, or forced reload on admin update


def get_active_keyword_rules(force_reload: bool = False) -> dict[str, list[str]]:
    """Return in-memory keyword rules, lazily loading from DB if expired or requested."""
    global _cached_rules, _last_loaded
    now = time.time()
    if not force_reload and _last_loaded > 0 and (now - _last_loaded) < _CACHE_TTL:
        return _cached_rules

    with _cache_lock:
        if not force_reload and _last_loaded > 0 and (now - _last_loaded) < _CACHE_TTL:
            return _cached_rules
        try:
            from sqlalchemy import text
            from app.persistence.database import SessionLocal
            with SessionLocal() as s:
                rows = s.execute(text(
                    "SELECT domain_key, keywords FROM classifier_domains WHERE is_active = true"
                )).fetchall()
                if rows:
                    rules: dict[str, list[str]] = {}
                    for d_key, kws in rows:
                        if isinstance(kws, list):
                            rules[d_key] = [str(k).lower().strip() for k in kws if k]
                    if rules:
                        _cached_rules = rules
                        _last_loaded = now
                        logger.info("Classifier rules reloaded from DB: %d active domains", len(rules))
                        return _cached_rules
        except Exception as e:
            logger.warning("Classifier cache reload from DB skipped (%s), using existing cache", e)

        if not _cached_rules:
            _cached_rules = dict(DEFAULT_KEYWORD_RULES)
        _last_loaded = now
        return _cached_rules


def reload_rules_cache() -> int:
    """Force an immediate reload from DB and return the number of active domains."""
    rules = get_active_keyword_rules(force_reload=True)
    return len(rules)


def classify_domain(query: str) -> tuple[str, float]:
    """Keyword-rule classifier. Returns (domain, confidence in 0..1)."""
    text = (query or "").lower()
    rules = get_active_keyword_rules()
    best_domain, best_hits = LOCKDOWN, 0

    for domain, kws in rules.items():
        hits = sum(1 for kw in kws if kw in text)
        if domain == "security":
            hits *= 2  # prioritize security signals over generic terms
        if domain in ("kubernetes", "storage", "application"):
            hits *= 1.5  # specific domains beat generic system terms
        if hits > best_hits:
            best_domain, best_hits = domain, hits

    if best_hits == 0:
        return LOCKDOWN, 0.3
    # Scale confidence: 1 hit ~= 0.75, more hits approach 1.0
    confidence = min(0.75 + 0.1 * (best_hits - 1), 0.98)
    return best_domain, round(confidence, 3)
