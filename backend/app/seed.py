"""Seed script — Confluence puller → chunk → embed → pgvector (LangChain PGVector).

Run from `backend/`:  uv run python -m app.seed
"""
from __future__ import annotations

import logging

from app.knowledge.chunker import chunk_text
from app.config import SETTINGS
from app.integrations.confluence import fetch_space
from app.rag.retrieval import add_texts

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seed")


def main() -> int:
    texts: list[str] = []
    metadatas: list[dict[str, str]] = []
    seen: set[str] = set()  # dedupe articles by page_id across spaces (dev fallback returns full set per space)
    for space in [s.strip() for s in SETTINGS.confluence_space_keys.split(",") if s.strip()]:
        articles = fetch_space(space)
        logger.info("space=%s articles=%d", space, len(articles))
        for art in articles:
            if art["page_id"] in seen:
                continue
            seen.add(art["page_id"])
            chunks = chunk_text(art["body"], chunk_tokens=SETTINGS.chunk_tokens,
                                overlap=SETTINGS.chunk_overlap)
            for i, chunk in enumerate(chunks):
                texts.append(f"{art['title']}. {chunk}")
                metadatas.append({
                    "page_id": art["page_id"],
                    "page_title": art["title"],
                    "domain": art["domain"],
                    "source_url": art["source_url"],
                    "chunk_index": str(i),
                })
    if not texts:
        logger.warning("no chunks produced — check Confluence creds / sample docs")
        return 1

    # Batch embed+insert into pgvector
    for i in range(0, len(texts), SETTINGS.embed_batch_size):
        batch_texts = texts[i : i + SETTINGS.embed_batch_size]
        batch_meta = metadatas[i : i + SETTINGS.embed_batch_size]
        ids = add_texts(batch_texts, metadatas=batch_meta)
        logger.info("inserted batch %d..%d (%d) ids=%d", i, i + len(batch_texts),
                    len(batch_texts), len(ids))

    logger.info("DONE — embedded %d chunks", len(texts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
