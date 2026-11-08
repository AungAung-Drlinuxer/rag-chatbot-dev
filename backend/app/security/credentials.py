"""Write-only handling for integration credentials (v1.6.35).

WHY THIS EXISTS
---------------
`GET /api/settings/integrations/{key}` used to filter only keys ending in
`_token` / `_password`. That leaked every other credential shape in plaintext:

    llm       -> api_key        (the provider API key!)
    keycloak  -> client_secret
    ldap      -> bind_dn, host, base_dn
    confluence-> base_url, email, space_keys

An admin (or anyone who could reach the endpoint with an admin token) could read
secrets straight back out of the API.

POLICY — every stored integration field is WRITE-ONLY
-----------------------------------------------------
* A value is **never** returned in a response, for any field, by any role.
  Responses carry only `fields_set` / `secret_fields` flags plus a mask token, so
  the UI can show "configured" without being able to recover the value.
* A field omitted from a PUT keeps its stored value (so saving one field never
  wipes the others).
* A field explicitly set to `CLEAR` is deleted.
* The mask token itself is never writable — a client cannot round-trip the mask
  back over the real value (a real hazard once a UI loads masked values into a
  form, which is exactly what this UI used to do).

This means an operator cannot read back `base_url` / `host` etc. after saving.
That is the requested posture; the Test button validates the live connection
server-side, which is the safe way to confirm a configuration is correct.
"""
from __future__ import annotations

# The mask a client sees instead of a value. Any value equal to this is refused.
MASK = "••••••••"

# Setting a field to this deletes it.
CLEAR = "__CLEAR__"

# Secret-ish field names — reported separately so the UI can label them
# "secret" rather than "configured". Not used to decide *whether* to redact
# (everything is redacted); only for display.
_SECRET_SUFFIXES = ("_token", "_password", "_secret", "_key")
_SECRET_EXACT = {
    "api_token",
    "api_key",
    "apikey",
    "token",
    "password",
    "secret",
    "client_secret",
    "bind_password",
    "smtp_password",
    "access_token",
    "refresh_token",
}
# Names that merely *contain* "key" but are not secrets (display hint only).
_NOT_SECRET = {"space_keys", "project_key", "key", "keys"}

# Endpoints / identities the operator asked to keep write-only as well. These are
# not secrets in the cryptographic sense, but they disclose the internal estate
# (which Atlassian tenant, which LDAP host, which realm) and were being echoed
# back verbatim.
_SENSITIVE_ENDPOINTS = {
    "base_url", "url", "host", "hostname", "email", "account_email",
    "username", "bind_dn", "base_dn", "user_filter", "search_base",
    "issuer", "realm", "client_id", "redirect_uri",
    "wiki", "spaces", "space_keys", "project_id", "project_key",
    "from_address", "from_addr", "from", "to_address", "to_addr",
    "source_ids", "list_ids", "doc_ids", "workspace_ids",
    "sentinels", "master_name",
    # LDAP directory shape — leaks the AD domain / group naming
    "upn_suffix", "admin_groups", "allowed_groups", "group_filter", "domain_name",
}

# Operational knobs that stay readable. Masking a port or a "use TLS" flag adds no
# security and makes the form unusable; masking the active model would break the
# "dashboard reflects the DB-selected model" requirement.
_PLAIN_FIELDS = {
    "port", "use_tls", "use_ssl", "enabled", "starttls",
    "model", "provider", "domain", "embedding_model", "embedding_dim",
    "mode", "cnpg_cluster", "wiki_enabled", "include_comments",
    "min_chars", "max_tasks", "max_pages", "top_k", "alerts",
}


def is_sensitive(name: str) -> bool:
    """True when a field's VALUE must never be returned to a client.

    Sensitive = credentials + endpoints/identities. Operational knobs pass
    through unchanged so the Settings form stays usable.
    """
    n = (name or "").strip().lower()
    if n in _PLAIN_FIELDS:
        return False
    return is_secret(n) or n in _SENSITIVE_ENDPOINTS


def is_secret(name: str) -> bool:
    """True when the field holds a credential (display hint only)."""
    n = (name or "").strip().lower()
    if n in _NOT_SECRET:
        return False
    return n in _SECRET_EXACT or n.endswith(_SECRET_SUFFIXES)


def is_mask(value: object) -> bool:
    """True when a client echoed the mask back instead of a real value."""
    return isinstance(value, str) and value.strip() == MASK


def is_clear(value: object) -> bool:
    """True when the client asked to delete the field."""
    return isinstance(value, str) and value.strip() == CLEAR


# Matches the userinfo segment of a URL: scheme://user:SECRET@host
_URL_SECRET_RE = None


def mask_url_secret(url: str | None) -> str:
    """Mask the embedded password of a connection URL.

    `redis://app:PASSWORD@host:6379/0` -> `redis://app:***@host:6379/0`

    Needed because connection URLs are routinely returned by status endpoints:
    `/api/integrations/status` was echoing `SETTINGS.redis_url` verbatim, which
    exposed the live Redis password in plaintext to any authenticated caller.
    """
    global _URL_SECRET_RE
    if not url:
        return url or ""
    if _URL_SECRET_RE is None:
        import re

        _URL_SECRET_RE = re.compile(r"://([^:/@]+):([^@/]+)@")
    return _URL_SECRET_RE.sub(r"://\1:***@", str(url))


def redact_config(cfg: dict | None) -> dict:
    """Return a response-safe view of a stored config.

    Sensitive keys (credentials + endpoints) come back as the mask token — the raw
    value never leaves the process. Operational knobs (port, TLS flag, model,
    thresholds) are passed through so the Settings form remains usable.
    """
    out: dict[str, object] = {}
    for key, value in (cfg or {}).items():
        name = str(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        out[name] = MASK if is_sensitive(name) else value
    return out


def fields_set(cfg: dict | None) -> list[str]:
    """Names of fields holding a non-empty value, sorted for stable output."""
    return sorted(
        str(k)
        for k, v in (cfg or {}).items()
        if not (v is None or (isinstance(v, str) and not v.strip()))
    )


def secret_fields_set(cfg: dict | None) -> list[str]:
    """Subset of `fields_set` that holds credentials."""
    return [k for k in fields_set(cfg) if is_secret(k)]


# Keys that only ever belong in a RESPONSE. An older client round-tripped
# `token_set` back into the payload, which then showed up as a stored field.
_RESPONSE_ONLY = {"token_set", "fields_set", "mask", "configured", "secret_fields", "updated_at"}


def apply_update(current: dict | None, incoming: dict | None) -> dict:
    """Merge an incoming PUT payload into the stored config.

    Rules, in order:
      1. the mask token is refused (never overwrite a real value with the mask)
      2. `CLEAR` deletes the field
      3. an empty/absent value KEEPS the stored one (saving one field must not
         wipe the others — this was the pre-existing, correct behaviour)
      4. otherwise the new value overwrites
    """
    merged = dict(current or {})
    # never persist a response-only key
    for key in list(merged):
        if str(key) in _RESPONSE_ONLY:
            merged.pop(key, None)

    for key, value in (incoming or {}).items():
        name = str(key)

        if name in _RESPONSE_ONLY:
            continue

        if is_mask(value):
            # A client sent the mask back. Ignore it — writing it would destroy
            # the real credential.
            continue

        if is_clear(value):
            merged.pop(name, None)
            continue

        if value is None or (isinstance(value, str) and not value.strip()):
            # keep whatever is stored
            continue

        merged[name] = value

    return merged
