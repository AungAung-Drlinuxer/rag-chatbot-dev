"""Text chunker — v0.10.0 with section-header awareness.

Strategy:
1) Split on Markdown headings (## / ###) so each section stays semantic.
2) Long sections are cut into overlapping token windows (word approximation).
3) Every chunk is prefixed with "page title — section header" so the
   embedding (and the reranker) always see the document context, not a
   naked fragment. This materially improves retrieval on short queries.
"""
from __future__ import annotations

import re

_HEADER_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)


def _windows(words: list[str], chunk_tokens: int, overlap: float) -> list[str]:
    if len(words) <= chunk_tokens:
        return [" ".join(words)]
    step = max(1, int(chunk_tokens * (1 - overlap)))
    out = []
    for i in range(0, len(words), step):
        w = " ".join(words[i : i + chunk_tokens])
        if w:
            out.append(w)
    return out


def chunk_text(
    text: str,
    chunk_tokens: int = 800,
    overlap: float = 0.10,
    context_prefix: str = "",
) -> list[str]:
    """Split `text` into chunks; each chunk carries title+header context.

    context_prefix: usually the page title — prepended to every chunk.
    """
    text = (text or "").strip()
    if not text:
        return []

    # 1) find section headers, split body into (header, body) pairs
    sections: list[tuple[str, str]] = []
    matches = list(_HEADER_RE.finditer(text))
    if not matches:
        sections.append(("", text))
    else:
        # preamble before first header
        if matches[0].start() > 0:
            pre = text[: matches[0].start()].strip()
            if pre:
                sections.append(("", pre))
        for i, m in enumerate(matches):
            header = m.group(2).strip()
            start = m.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            body = text[start:end].strip()
            if body:
                sections.append((header, body))

    # 2) window long sections, prefixing title+header to every chunk
    chunks: list[str] = []
    for header, body in sections:
        ctx = " — ".join(x for x in (context_prefix.strip(), header) if x)
        for w in _windows(body.split(), chunk_tokens, overlap):
            chunks.append(f"{ctx}. {w}" if ctx else w)

    return chunks
