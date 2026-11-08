"""OpenBao secret resolver (PoC-grade).

When OPENBAO_URL is set, the backend authenticates against OpenBao using the
running pod's Kubernetes ServiceAccount token, reads
`secret/data/it-help-chatbot/backend` (KV-v2) with a short-lived OpenBao
token (2h TTL), and returns the decrypted key/value pairs as a plain dict.

If OpenBao is unreachable, misconfigured, the role does not allow access, or
any other error happens, the resolver returns None and the caller falls back
to environment variables (k8s Secret mounted as env vars).

This module is intentionally minimal — the production-grade agent-side
caching / token refresh is a follow-up; for now we read once at startup
and the token lives for the process lifetime.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("secrets.openbao")

DEFAULT_URL = "http://openbao.openbao.svc.cluster.local:8200"
DEFAULT_PATH = "secret/data/it-help-chatbot/backend"
DEFAULT_ROLE = "it-help-chatbot"
DEFAULT_TOKEN_TTL = "2h"
HTTP_TIMEOUT_S = 5.0


def _read_sa_token() -> str | None:
    """Read the pod's projected ServiceAccount token."""
    for path in (
        "/var/run/secrets/kubernetes.io/serviceaccount/token",
    ):
        try:
            with open(path, encoding="utf-8") as f:
                return f.read().strip()
        except FileNotFoundError:
            continue
        except Exception as exc:  # noqa: BLE001
            logger.debug("openbao: cannot read SA token at %s: %s", path, exc)
    return None


def _login(url: str, role: str, sa_token: str) -> str | None:
    import httpx

    try:
        resp = httpx.post(
            f"{url}/v1/auth/kubernetes/login",
            json={"jwt": sa_token, "role": role},
            timeout=HTTP_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("openbao: k8s auth login failed: %s", exc)
        return None

    if resp.status_code != 200:
        logger.warning(
            "openbao: k8s auth login denied (status=%d body=%s)",
            resp.status_code,
            resp.text[:200],
        )
        return None

    try:
        return resp.json()["auth"]["client_token"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("openbao: cannot parse login response: %s", exc)
        return None


def _read_kv(url: str, openbao_token: str, path: str) -> dict[str, Any] | None:
    import httpx

    try:
        resp = httpx.get(
            f"{url}/v1/{path}",
            headers={"X-Vault-Token": openbao_token},
            timeout=HTTP_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("openbao: KV read failed: %s", exc)
        return None

    if resp.status_code != 200:
        logger.warning(
            "openbao: KV read denied (status=%d body=%s)",
            resp.status_code,
            resp.text[:200],
        )
        return None

    try:
        return resp.json()["data"]["data"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("openbao: cannot parse KV response: %s", exc)
        return None


def load() -> dict[str, str] | None:
    """Return OpenBao secrets as a flat {KEY: value} dict, or None on any failure.

    The result is meant to be passed straight into pydantic Settings as
    initial values (so any field whose key matches an env-var name will
    be overridden). Caller is responsible for falling back to env vars
    when this returns None.
    """
    url = os.environ.get("OPENBAO_URL", DEFAULT_URL).rstrip("/")
    path = os.environ.get("OPENBAO_KV_PATH", DEFAULT_PATH)
    role = os.environ.get("OPENBAO_K8S_ROLE", DEFAULT_ROLE)

    sa_token = _read_sa_token()
    if not sa_token:
        logger.info("openbao: no SA token in pod; skipping OpenBao lookup")
        return None

    ob_token = _login(url, role, sa_token)
    if not ob_token:
        return None

    data = _read_kv(url, ob_token, path)
    if not data:
        return None

    # Normalize to str for pydantic consumption
    flat = {k: ("" if v is None else str(v)) for k, v in data.items()}
    logger.info(
        "openbao: loaded %d secrets from %s (role=%s)",
        len(flat),
        path,
        role,
    )
    return flat


if __name__ == "__main__":  # quick CLI smoke test
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    print(json.dumps(load(), indent=2))
