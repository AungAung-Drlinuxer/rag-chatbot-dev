"""In-memory BM25 Okapi index manager (Option A) — pure CPU, sub-millisecond lexical scoring.

Features:
- Pure CPU, zero GPU requirement (negligible memory: <15MB for typical KB sizes).
- Thread-safe lazy loading from PostgreSQL (langchain_pg_embedding).
- Invalidation / auto-reload on article ingestion / edit / sync.
- Advanced tokenization: lowercasing, punctuation stripping, word tokens, alphanumeric IDs.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

from rank_bm25 import BM25Okapi
from sqlalchemy import text as sqltext

from app.persistence.database import engine

logger = logging.getLogger("bm25_index")

_TOKEN_REGEX = re.compile(r"[a-zA-Z0-9_\-\.]+")


def tokenize(text: str) -> list[str]:
    """Tokenize query or document into lowercase tokens for BM25 matching."""
    if not text:
        return []
    return [t.lower() for t in _TOKEN_REGEX.findall(text) if len(t) > 1]


class BM25IndexManager:
    """Thread-safe singleton managing the in-memory BM25Okapi corpus."""

    _instance: BM25IndexManager | None = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self.bm25: BM25Okapi | None = None
        self.corpus_docs: list[dict[str, Any]] = []
        self.last_built_at: float = 0.0
        self._build_lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> BM25IndexManager:
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def invalidate(self) -> None:
        """Mark index as needing rebuild on next query."""
        with self._build_lock:
            self.bm25 = None
            self.corpus_docs = []
            self.last_built_at = 0.0
            logger.info("BM25 index invalidated")

    def ensure_index(self, force: bool = False) -> bool:
        """Load chunks from DB and construct BM25Okapi instance."""
        if not force and self.bm25 is not None:
            return True

        with self._build_lock:
            if not force and self.bm25 is not None:
                return True

            t0 = time.time()
            try:
                with engine.begin() as conn:
                    rows = conn.execute(
                        sqltext("SELECT document, cmetadata FROM langchain_pg_embedding")
                    ).fetchall()

                if not rows:
                    logger.warning("BM25 build: no documents found in langchain_pg_embedding")
                    self.bm25 = None
                    self.corpus_docs = []
                    return False

                corpus_tokens: list[list[str]] = []
                docs: list[dict[str, Any]] = []

                for doc_text, cmetadata in rows:
                    meta = cmetadata or {}
                    corpus_tokens.append(tokenize(doc_text or ""))
                    docs.append(
                        {
                            "page_id": meta.get("page_id") or meta.get("id"),
                            "title": meta.get("page_title") or meta.get("title") or "Untitled",
                            "content": doc_text or "",
                            "domain": meta.get("domain"),
                            "source_url": meta.get("source_url"),
                        }
                    )

                self.bm25 = BM25Okapi(corpus_tokens)
                self.corpus_docs = docs
                self.last_built_at = time.time()
                elapsed_ms = (self.last_built_at - t0) * 1000
                logger.info(
                    "BM25 index built with %d documents in %.1f ms",
                    len(docs),
                    elapsed_ms,
                )
                return True
            except Exception as exc:
                logger.error("Failed to build BM25 index: %s", exc)
                return False

    def search(
        self,
        query: str,
        k: int = 20,
        filter_clause: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Search in-memory corpus using BM25 ranking algorithm.

        Returns list of matched dicts compatible with RAG retrieval pipeline.
        """
        if not self.ensure_index():
            return []

        tokens = tokenize(query)
        if not tokens or not self.bm25:
            return []

        scores = self.bm25.get_scores(tokens)

        # Pair scores with docs
        scored_items: list[tuple[float, dict[str, Any]]] = []
        for score, doc in zip(scores, self.corpus_docs):
            if score <= 0.0:
                continue
            if filter_clause and any(doc.get(kk) != vv for kk, vv in filter_clause.items()):
                continue
            scored_items.append((float(score), doc))

        # Sort descending by score
        scored_items.sort(key=lambda x: x[0], reverse=True)
        top_items = scored_items[:k]

        results: list[dict[str, Any]] = []
        for rank, (score, doc) in enumerate(top_items):
            res = dict(doc)
            res.update(
                {
                    "bm25_score": round(score, 4),
                    "distance": 0.5,  # placeholder before cross-encoder rerank
                    "confidence": 0.5,
                    "kw_rank": rank,
                }
            )
            results.append(res)

        return results
