"""Phase 8 — offline gold-set eval + confidence-gate calibration.

Runs a small gold set through the real pipeline (retrieve + gate) and reports:
domain accuracy, retrieval hit-rate, and a calibration table (precision/recall/F1 at
several thresholds) so the 0.75 gate can be tuned with evidence rather than guesswork.

Run:  uv run python scripts/eval_goldset.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.orchestration.orchestrator import run_rag

# (query, expected_domain, expected_top1_title_fragment_or_None_for_offtopic)
GOLD = [
    ("Database connection is timing out", "database", "Database Connection Timeout"),
    ("how do I reset my ad password", "security", "Reset AD Password"),
    ("VPN keeps disconnecting", "network", "VPN"),
    ("the machine is frozen on startup", "system", "Frozen"),
    ("my AD password expired and I am locked out", "security", "Password Expired"),
    ("server disk usage is above 90%", "system", "Disk Full"),
    ("how do I bake a chocolate cake", "general", None),  # off-topic → expect low confidence
]


def _label(item: dict) -> int:
    """1 = should answer (in-domain w/ a real guide); 0 = should gate/hold."""
    return 0 if item["expected_frag"] is None else 1


def main() -> None:
    rows = []
    for q, dom, frag in GOLD:
        res = run_rag(q)
        top1 = res.sources[0]["title"] if res.sources else None
        rows.append({
            "query": q,
            "domain": res.domain,
            "confidence": round(res.confidence, 4),
            "decision": res.decision,
            "top1": top1,
            "expected_domain": dom,
            "expected_frag": frag,
            "domain_ok": res.domain == dom,
            "top1_ok": bool(frag) and frag.lower() in (top1 or "").lower(),
        })

    n = len(rows)
    domain_acc = sum(r["domain_ok"] for r in rows) / n
    top1_ok = [r for r in rows if r["expected_frag"]]
    top1_acc = sum(r["top1_ok"] for r in top1_ok) / len(top1_ok) if top1_ok else 0.0

    # Gate calibration — treat confidence >= thresh as "answer" (label 1).
    calib = []
    for th in (0.5, 0.6, 0.7, 0.75, 0.8):
        tp = sum(1 for r in rows if _label(r) == 1 and r["confidence"] >= th)
        fp = sum(1 for r in rows if _label(r) == 0 and r["confidence"] >= th)
        fn = sum(1 for r in rows if _label(r) == 1 and r["confidence"] < th)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        calib.append({"threshold": th, "precision": round(precision, 3),
                      "recall": round(recall, 3), "f1": round(f1, 3)})

    report = {
        "n": n,
        "domain_accuracy": round(domain_acc, 3),
        "top1_hit_rate": round(top1_acc, 3),
        "rows": rows,
        "calibration": calib,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
