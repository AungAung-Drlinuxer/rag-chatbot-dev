"""Domain profiles fill themselves — but never over an admin's edit."""
from __future__ import annotations

import inspect

from workers import celery_app as beat
from workers import sync_tasks


def test_the_nightly_backfill_is_scheduled():
    assert "backfill-domain-profiles" in beat.celery_app.conf.beat_schedule
    entry = beat.celery_app.conf.beat_schedule["backfill-domain-profiles"]
    assert entry["task"] == "workers.sync_tasks.backfill_domain_profiles"


def test_the_backfill_only_fills_blanks():
    source = inspect.getsource(sync_tasks.backfill_domain_profiles)
    # The UPDATE is guarded per column: an existing description/keyword list is skipped.
    assert "if not (row[\"description\"] or \"\").strip()" in source
    assert "if not list(row[\"keywords\"] or [])" in source


def test_creating_a_domain_drafts_a_profile_when_it_is_blank():
    from app.api import admin

    source = inspect.getsource(admin.create_domain)
    assert "suggest_profile(" in source
    assert "auto_profile" in source
    # Never overwrites what the caller supplied.
    assert 'if not cleaned_keywords and suggested.get("keywords")' in source
