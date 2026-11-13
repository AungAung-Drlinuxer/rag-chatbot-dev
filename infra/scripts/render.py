#!/usr/bin/env python3
"""Render infra/k8s-dev/*.yaml for a specific cluster.

The manifests in `infra/k8s-dev/` are the ones this project actually runs on, so they
are readable: names, hostnames and tags appear literally. Portability is handled here
instead of scattering `${VAR}` through every file (which makes `kubectl apply -f
infra/k8s-dev` unusable and hides the real values from readers).

    infra/env            # your values (copy from infra/env.example)
    python3 infra/scripts/render.py      # -> infra/.rendered/*.yaml

With no `infra/env`, every default equals the current dev cluster, so the output is
byte-identical to the source files.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "infra" / "k8s-dev"
OUT = ROOT / "infra" / ".rendered"

DEFAULTS = {
    "NAMESPACE": "rag-chatbot-dev",
    "REGISTRY": "harbor.drlinuxer.com/rag-chatbot-dev",
    "FRONTEND_TAG": "dev-1.11.50",
    "BACKEND_TAG": "dev-1.0.81",
    "OLLAMA_TAG": "0.5.7-models",
    "RERANK_TAG": "1.0.2",
    "DOMAIN": "dev-chat.drlinuxer.com",
    "TLS_SECRET": "drlinuxer-tls",
    "INGRESS_CLASS": "nginx",
    "STORAGE_CLASS": "truenas-iscsi",
    "POSTGRES_SIZE": "5Gi",
    "BACKUP_ENABLED": "1",
    "S3_ENDPOINT": "https://s3.drlinuxer.com",
    "S3_BUCKET": "rag-chatbot-dev-postgres",
    "MONITORING_ENABLED": "1",
    # 0 serves plain HTTP (a cluster with no cert-manager / no TLS secret yet).
    "TLS_ENABLED": "1",
    "PROM_REMOTE_WRITE": "http://10.10.10.18:9090/api/v1/write",
}

# Files that can be switched off per environment.
OPTIONAL = {
    "21-backup.yaml": "BACKUP_ENABLED",
    "45-monitoring.yaml": "MONITORING_ENABLED",
}


def load_env() -> dict[str, str]:
    env = dict(DEFAULTS)
    path = ROOT / "infra" / "env"
    if not path.exists():
        print("render: infra/env not found — using the dev defaults", file=sys.stderr)
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def render(text: str, env: dict[str, str]) -> str:
    text = text.replace("harbor.drlinuxer.com/rag-chatbot-dev", env["REGISTRY"])

    tags = {
        "frontend": env["FRONTEND_TAG"],
        "backend": env["BACKEND_TAG"],
        "ollama": env["OLLAMA_TAG"],
        "rerank-svc": env["RERANK_TAG"],
    }

    def retag(line: str) -> str:
        """Only `image:` lines carry a tag — `http://ollama:11434` must stay a URL."""
        m = re.match(r"(\s*(?:-\s*)?image:\s*)(\S+?)(?::([A-Za-z0-9._-]+))?\s*$", line)
        if not m:
            return line
        indent, repo, _old = m.groups()
        name = repo.rsplit("/", 1)[-1]
        if name not in tags:
            return line
        return f"{indent}{repo.split(':')[0]}:{tags[name]}"

    text = "\n".join(retag(line) for line in text.split("\n"))


    text = text.replace("namespace: rag-chatbot-dev", f"namespace: {env['NAMESPACE']}")
    # The app reads its own namespace back for the live-status tool.
    text = text.replace("RAGCHAT_NAMESPACE: rag-chatbot-dev", f"RAGCHAT_NAMESPACE: {env['NAMESPACE']}")
    text = text.replace("dev-chat.drlinuxer.com", env["DOMAIN"])
    text = text.replace("drlinuxer-tls", env["TLS_SECRET"])

    # A fresh cluster usually has no certificate yet. Dropping the whole `tls:` block is
    # better than pointing at a secret that does not exist: the Ingress then answers on
    # http:// and the install can be verified before DNS/TLS is wired up.
    if env.get("TLS_ENABLED", "1") == "0":
        text = re.sub(r"(?m)^  tls:\n(?:  - [^\n]*\n|[ \t]{4,}[^\n]*\n)+", "", text)
    text = text.replace("ingressClassName: nginx", f"ingressClassName: {env['INGRESS_CLASS']}")

    if env["STORAGE_CLASS"]:
        text = text.replace("storageClassName: truenas-iscsi",
                            f"storageClassName: {env['STORAGE_CLASS']}")
    else:
        text = re.sub(r"\n\s*storageClassName: truenas-iscsi", "", text)

    # Backups off means the ObjectStore CR is not applied. The Cluster must not reference
    # the barman plugin in that case: its pre-reconcile hook blocks the whole reconciliation
    # loop until the ObjectStore exists, so Postgres never starts and the install hangs.
    if str(env.get("BACKUP_ENABLED", "1")) == "0":
        text = re.sub(r"(?m)^[ \t]*plugins:\n(?:[ \t]{4,}[^\n]*\n)+", "", text)
        text = re.sub(r"(?m)^[ \t]*archive_mode: \"on\"\n", "", text)
        text = re.sub(r"(?m)^[ \t]*archive_timeout: [^\n]*\n", "", text)

    # Pinned ClusterIPs are cluster-specific: a fresh cluster would reject them (that
    # address may belong to another service) and `apply` fails. Headless services
    # (`clusterIP: None`) are kept — that value means "no address", not an address.
    text = re.sub(r"(?m)^[ \t]*clusterIP: (?!None)[^\n]*\n", "", text)
    text = re.sub(r"(?m)^[ \t]*clusterIPs:\n(?:[ \t]+-[^\n]*\n)+", "", text)

    text = text.replace("size: 5Gi", f"size: {env['POSTGRES_SIZE']}")
    text = text.replace("endpointURL: https://s3.drlinuxer.com", f"endpointURL: {env['S3_ENDPOINT']}")
    text = text.replace("rag-chatbot-dev-postgres", env["S3_BUCKET"])
    text = text.replace("http://10.10.10.18:9090/api/v1/write", env["PROM_REMOTE_WRITE"])
    return text


def main() -> int:
    env = load_env()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.yaml"):
        old.unlink()

    written = []
    for src in sorted(SRC.glob("*.yaml")):
        flag = OPTIONAL.get(src.name)
        if flag and str(env.get(flag, "1")) == "0":
            print(f"skip   {src.name}  ({flag}=0)")
            continue
        (OUT / src.name).write_text(render(src.read_text(), env))
        written.append(src.name)

    print(f"rendered {len(written)} manifests -> {OUT.relative_to(ROOT)}")
    print(f"  namespace={env['NAMESPACE']} domain={env['DOMAIN']} registry={env['REGISTRY']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
