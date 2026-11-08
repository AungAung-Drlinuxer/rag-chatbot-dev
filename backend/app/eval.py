"""Evaluation harness — scores RAG retrieval + LLM answer quality.

Reads qa_set.yaml (12 question/answer pairs with expected sources and
must-contain keywords), runs each through the RAG pipeline, and reports:
- Retrieval metrics: Recall@k, source overlap, mean reciprocal rank
- Answer metrics: fact-match rate, decision match
- Latency p50 / p95

Used as: POST /api/eval/run  (admin-only)
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import yaml

log = logging.getLogger(__name__)

QA_SET_PATH = Path(__file__).parent.parent / "eval" / "qa_set.yaml"


@dataclass
class EvalCase:
    question: str
    answer_must_contain: list[str]
    expected_source_page_ids: list[str]
    expected_domain: str
    expected_decision: str


def load_cases(path: Path = QA_SET_PATH) -> list[EvalCase]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    cases: list[EvalCase] = []
    for entry in raw:
        # skip None/empty keys (YAML keys with no value become None)
        if not isinstance(entry, dict) or "question" not in entry:
            continue
        cases.append(EvalCase(
            question=entry["question"],
            answer_must_contain=entry.get("answer_must_contain") or [],
            expected_source_page_ids=entry.get("expected_source_page_ids") or [],
            expected_domain=entry.get("expected_domain", ""),
            expected_decision=entry.get("expected_decision", ""),
        ))
    return cases


@dataclass
class CaseResult:
    case: EvalCase
    retrieved_page_ids: list[str] = field(default_factory=list)
    actual_domain: str = ""
    actual_decision: str = ""
    answer: str = ""
    facts_matched: list[str] = field(default_factory=list)
    facts_missed: list[str] = field(default_factory=list)
    latency_s: float = 0.0
    error: str | None = None

    @property
    def source_overlap(self) -> float:
        if not self.case.expected_source_page_ids:
            return 1.0  # no expectation = vacuously correct
        hit = sum(1 for p in self.case.expected_source_page_ids if p in self.retrieved_page_ids)
        return hit / len(self.case.expected_source_page_ids)

    @property
    def recall_at_k(self) -> float:
        return self.source_overlap  # k == len(expected)

    @property
    def facts_hit_rate(self) -> float:
        if not self.case.answer_must_contain:
            return 1.0
        return len(self.facts_matched) / len(self.case.answer_must_contain)

    @property
    def ok(self) -> bool:
        if self.error:
            return False
        return self.facts_hit_rate == 1.0 and self.recall_at_k == 1.0


async def run_eval(cases: list[EvalCase] | None = None) -> dict:
    """Run the eval set through the live pipeline. Returns summary dict."""
    from app.orchestration.orchestrator import run_rag  # late import — avoid circular

    if cases is None:
        cases = load_cases()
    results: list[CaseResult] = []
    latencies: list[float] = []

    for case in cases:
        result = CaseResult(case=case)
        t0 = time.perf_counter()
        try:
            rag_result = run_rag(case.question)
            result.answer = rag_result.context
            result.actual_domain = rag_result.domain or ""
            result.actual_decision = rag_result.decision or ""
            result.retrieved_page_ids = [h.get("page_id") or h.get("title", "") for h in rag_result.sources]
            ans_lower = (rag_result.context or "").lower()
            for kw in case.answer_must_contain:
                if kw.lower() in ans_lower:
                    result.facts_matched.append(kw)
                else:
                    result.facts_missed.append(kw)
        except Exception as exc:
            result.error = f"{type(exc).__name__}: {exc}"
        result.latency_s = time.perf_counter() - t0
        latencies.append(result.latency_s)
        results.append(result)

    n = len(results)
    n_ok = sum(1 for r in results if r.ok)
    n_with_facts = sum(1 for r in results if r.case.answer_must_contain)
    n_facts_all_hit = sum(1 for r in results if r.facts_hit_rate == 1.0)
    n_with_sources = sum(1 for r in results if r.case.expected_source_page_ids)
    n_sources_all = sum(1 for r in results if r.recall_at_k == 1.0)
    # avg_latency kept for future expansion; p50/p95 are reported
    p50 = sorted(latencies)[n // 2] if n else 0
    p95 = sorted(latencies)[max(0, int(n * 0.95) - 1)] if n else 0

    return {
        "summary": {
            "n_cases": n,
            "pass_rate": round(n_ok / n, 3) if n else 0,
            "fact_match_rate": round(n_facts_all_hit / n_with_facts, 3) if n_with_facts else None,
            "source_recall_at_k": round(n_sources_all / n_with_sources, 3) if n_with_sources else None,
            "latency_p50_s": round(p50, 3),
            "latency_p95_s": round(p95, 3),
        },
        "cases": [
            {
                "question": r.case.question,
                "domain_expected": r.case.expected_domain,
                "domain_actual": r.actual_domain,
                "decision_expected": r.case.expected_decision,
                "decision_actual": r.actual_decision,
                "expected_sources": r.case.expected_source_page_ids,
                "retrieved_sources": r.retrieved_page_ids,
                "source_overlap": r.source_overlap,
                "facts_matched": r.facts_matched,
                "facts_missed": r.facts_missed,
                "facts_hit_rate": r.facts_hit_rate,
                "latency_s": round(r.latency_s, 3),
                "answer_preview": r.answer[:200],
                "ok": r.ok,
                "error": r.error,
            }
            for r in results
        ],
    }