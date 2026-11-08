"""Kubernetes question matrix — audit EVERY form (kubectl syntax + natural language).

Runs each question through the real path the chat uses, and reports, per question:
  intent  - did the router decide this is an infrastructure question?
  route   - deterministic (code-picked tool) | agent (model-picked) | none
  chars   - answer size
  shape   - table | text | RAW-JSON (bad) | empty (bad)
  head    - first line of the answer

A question is a FAIL when the router declined it, or the answer is empty, or the answer
is raw JSON that was never summarised.
"""
import json
import sys

sys.path.insert(0, "/app")
from app.mcp.infra_agent import (  # noqa: E402
    answer_infra, build_tools, detect_infra_intent,
)

# (question, expectation-note)
MATRIX: list[tuple[str, str]] = [
    # --- A. kubectl command syntax -------------------------------------------------
    ("kubectl get nodes", "node table"),
    ("Kubectl get nodes", "node table (capital K)"),
    ("kubectl get no", "short name"),
    ("kubectl get pods", "pod table"),
    ("kubectl get pods -A", "all namespaces"),
    ("kubectl get pods -n rag-chatbot", "namespace scoped"),
    ("kubectl get po -n rag-chatbot", "short name + ns"),
    ("kubectl get deployments -n rag-chatbot", "deployment table"),
    ("kubectl get deploy -A", "short + all ns"),
    ("kubectl get svc -n rag-chatbot", "services"),
    ("kubectl get ns", "namespaces"),
    ("kubectl get pvc -n rag-chatbot", "PVCs"),
    ("kubectl get statefulsets -n rag-chatbot", "statefulsets"),
    ("kubectl get events -n rag-chatbot", "events"),
    ("kubectl get nodes -o wide", "with -o wide"),

    # --- B. nodes, natural language ------------------------------------------------
    ("nodes status", "node status"),
    ("show me the nodes", "informal"),
    ("are the nodes healthy?", "health question"),
    ("are all nodes ready?", "readiness question"),
    ("how many nodes do we have?", "count"),
    ("list all nodes", "list"),
    ("which nodes are not ready?", "negative readiness"),
    ("what version is kubernetes running?", "version"),
    ("what is the node capacity?", "capacity"),
    ("how much cpu is requested on the nodes?", "requests"),
    ("show node roles", "roles"),
    ("do any nodes have taints?", "taints"),

    # --- C. workloads, natural language --------------------------------------------
    ("are there any unhealthy pods?", "health check"),
    ("which pods are crashing?", "crashloop"),
    ("are there any pods stuck in pending?", "pending"),
    ("which deployments are not ready?", "deployment health"),
    ("what is running in the rag-chatbot namespace?", "namespace inventory"),
    ("how many pods are in rag-chatbot?", "pod count"),
    ("are there any pods with restarts?", "restarts"),
    ("is everything healthy?", "overall health"),
    ("which workloads have problems?", "problems"),

    # --- D. cluster ------------------------------------------------------------------
    ("list the clusters", "cluster list"),
    ("what clusters do you manage?", "cluster inventory"),
    ("what is the cluster status?", "cluster status"),

    # --- E. resources -----------------------------------------------------------------
    ("how much memory is being used?", "memory usage"),
    ("show me cpu usage", "cpu usage"),
    ("what is using the most memory?", "top consumers"),
    ("where is my storage going?", "storage"),

    # --- F. events / diagnostics ------------------------------------------------------
    ("show me recent cluster events", "events"),
    ("are there any warnings in the cluster?", "warnings"),
    ("what went wrong recently?", "diagnosis"),
    ("why is the backend pod restarting?", "root cause"),

    # --- G. meta ----------------------------------------------------------------------
    ("what can you check in kubernetes?", "capabilities"),

    # --- H. must NOT be routed to the cluster ------------------------------------------
    ("what is a kubernetes pod?", "concept -> KB"),
    ("how do I create a deployment in kubernetes?", "how-to -> KB"),
    ("how do I reset my VPN password?", "unrelated -> KB"),
]


def shape(a: str) -> str:
    s = a.strip()
    if not s:
        return "empty"
    if s.startswith("[") or s.startswith("{"):
        return "RAW-JSON"
    if s.count("|") >= 4 and "---" in s:
        return "table"
    return "text"


def main() -> None:
    tools = build_tools()
    print("curated tools:", len(tools))
    fails, passes = [], []
    for q, note in MATRIX:
        intent = detect_infra_intent(q)
        text, kind, calls = answer_infra(q)[:3]
        sh = shape(text)
        expect_kb = "-> KB" in note
        ok = (not intent) if expect_kb else (bool(text) and sh != "RAW-JSON")
        rec = {
            "q": q, "note": note, "intent": intent, "route": kind,
            "chars": len(text), "shape": sh, "tools": [c["name"] for c in calls],
            "head": text.strip().split("\n")[0][:90] if text else "",
        }
        (passes if ok else fails).append(rec)
        flag = "PASS" if ok else "FAIL"
        print(f"{flag}  [{sh:8}] i={str(intent):5} {note:28} :: {q}")
        if not ok:
            print(f"        -> route={kind} chars={len(text)} head={rec['head']!r}")

    print()
    print("=" * 78)
    print(f"PASS {len(passes)}   FAIL {len(fails)}   (of {len(MATRIX)})")
    print("=" * 78)
    if fails:
        print("\nFAILURES:")
        for r in fails:
            print(f"  - {r['q']!r} ({r['note']})  intent={r['intent']} route={r['route']} "
                  f"shape={r['shape']} chars={r['chars']}")
    with open("/tmp/k8s_matrix.json", "w") as fh:
        json.dump({"pass": passes, "fail": fails}, fh, indent=1)


main()
