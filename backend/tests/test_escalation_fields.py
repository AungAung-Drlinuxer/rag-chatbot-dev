"""Jira field validation: the form must fail before Jira does, and only for real gaps."""
from __future__ import annotations

from app.escalation import jira_fields


def _meta(required: list[dict]) -> dict:
    return {
        "issue_types": [{"id": "1", "name": "Task", "subtask": False},
                        {"id": "2", "name": "Sub-task", "subtask": True}],
        "required_fields": [{"issue_type": "Task", "fields": required}],
    }


def test_top_level_fields_are_not_treated_as_custom(monkeypatch) -> None:
    # Jira's createmeta marks project/summary/description as required; they are validated
    # separately and must not be demanded again from `custom_fields`.
    monkeypatch.setattr(jira_fields, "configured", lambda: True)
    monkeypatch.setattr(jira_fields, "priorities", lambda: ["High", "Low"])
    monkeypatch.setattr(jira_fields, "create_meta", lambda project: _meta([
        {"key": "project", "name": "Project"},
        {"key": "summary", "name": "Summary"},
        {"key": "description", "name": "Description"},
    ]))

    errors = jira_fields.validate({
        "summary": "VPN drops", "description": "every 10 minutes",
        "project": "ITHD", "issue_type": "Task", "priority": "High",
        "custom_fields": {},
    })
    assert errors == []


def test_a_required_custom_field_is_reported(monkeypatch) -> None:
    monkeypatch.setattr(jira_fields, "configured", lambda: True)
    monkeypatch.setattr(jira_fields, "priorities", lambda: ["High", "Low"])
    monkeypatch.setattr(jira_fields, "create_meta", lambda project: _meta([
        {"key": "customfield_10042", "name": "Cost centre"},
    ]))

    errors = jira_fields.validate({
        "summary": "VPN drops", "description": "every 10 minutes",
        "project": "ITHD", "issue_type": "Task", "priority": "High",
        "custom_fields": {},
    })
    assert any("Cost centre" in e for e in errors)

    ok = jira_fields.validate({
        "summary": "VPN drops", "description": "every 10 minutes",
        "project": "ITHD", "issue_type": "Task", "priority": "High",
        "custom_fields": {"customfield_10042": "CC-12"},
    })
    assert ok == []


def test_unknown_priority_and_issue_type_are_rejected(monkeypatch) -> None:
    monkeypatch.setattr(jira_fields, "configured", lambda: True)
    monkeypatch.setattr(jira_fields, "priorities", lambda: ["High", "Low"])
    monkeypatch.setattr(jira_fields, "create_meta", lambda project: _meta([]))

    errors = jira_fields.validate({
        "summary": "x", "description": "y", "project": "ITHD",
        "issue_type": "Epic", "priority": "Urgent", "custom_fields": {},
    })
    assert any("Urgent" in e for e in errors)
    assert any("Epic" in e for e in errors)


def test_missing_credentials_are_a_validation_error(monkeypatch) -> None:
    monkeypatch.setattr(jira_fields, "configured", lambda: False)
    errors = jira_fields.validate({
        "summary": "x", "description": "y", "project": "ITHD",
        "issue_type": "Task", "priority": "", "custom_fields": {},
    })
    assert any("Jira is not configured" in e for e in errors)
