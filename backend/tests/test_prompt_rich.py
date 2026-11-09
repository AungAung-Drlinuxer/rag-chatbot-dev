"""Answers must arrive as rich Markdown, not as a wall of plain sentences.

The renderer has always supported headings, tables, fenced code and emoji — but the model
was only told about tables and citations, so ordinary answers came back as prose and the
chat bubble looked flat. These assertions fail if the presentation rules are dropped.
"""
from app.llm.client import _LOCAL_SYSTEM_PROMPT, _SYSTEM_PROMPT


def test_prompt_asks_for_markdown_structure():
    p = _SYSTEM_PROMPT
    assert "Markdown" in p
    assert "headings" in p and "bullets" in p
    assert "```bash" in p  # fenced code with a language tag
    assert "inline code" in p


def test_prompt_asks_for_meaningful_emoji():
    p = _SYSTEM_PROMPT
    assert "emoji" in p
    for glyph in ("✅", "⚠️", "🔧"):
        assert glyph in p
    # Decoration is discouraged: one marker per line, never inside code.
    assert "never inside a code block" in p


def test_prompt_forbids_raw_html_and_whole_answer_fences():
    p = _SYSTEM_PROMPT
    assert "never output raw HTML" in p
    assert "Do not wrap the whole answer in a code fence" in p


def test_local_prompt_also_asks_for_rich_markdown():
    p = _LOCAL_SYSTEM_PROMPT
    assert "Markdown" in p and "emoji" in p and "fenced code" in p
