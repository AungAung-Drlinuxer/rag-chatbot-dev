"""The component list the ticket form offers.

A component is a project-level taxonomy. Jira accepts a name that already exists and rejects
the field otherwise, and the create path is best-effort (`apply_issue_fields` drops what Jira
refuses and keeps the ticket), so a typo does not fail loudly — the component simply is not
there. These tests pin the two halves that make the picker trustworthy:

  * `jira_fields.components()` reads the project's own list and degrades to `[]`,
  * `/api/escalations/fields` carries it to the form.
"""
from __future__ import annotations

from app.api import escalations
from app.escalation import jira_fields


def test_components_reads_the_project_list(monkeypatch):
    jira_fields.reload()
    monkeypatch.setattr(jira_fields, "configured", lambda: True)

    captured = {}

    def fake_get(path, params=None):
        captured["path"] = path
        return [
            {"id": "10", "name": "Kubernetes"},
            {"id": "11", "name": "Active Directory"},
            {"id": "12"},  # no name -> ignored, not a blank entry
        ]

    from app.integrations import jira as jira_mod

    monkeypatch.setattr(jira_mod, "jira_get", fake_get)

    out = jira_fields.components("ITHD")
    assert captured["path"] == "/rest/api/3/project/ITHD/components"
    assert out == [
        {"id": "11", "name": "Active Directory"},
        {"id": "10", "name": "Kubernetes"},
    ]
    jira_fields.reload()


def test_components_is_empty_when_jira_is_not_configured(monkeypatch):
    jira_fields.reload()
    monkeypatch.setattr(jira_fields, "configured", lambda: False)
    assert jira_fields.components("ITHD") == []
    jira_fields.reload()


def test_components_failure_does_not_break_the_form(monkeypatch):
    jira_fields.reload()
    monkeypatch.setattr(jira_fields, "configured", lambda: True)

    from app.integrations import jira as jira_mod

    def boom(path, params=None):
        raise RuntimeError("jira down")

    monkeypatch.setattr(jira_mod, "jira_get", boom)
    assert jira_fields.components("ITHD") == []
    jira_fields.reload()


def test_fields_endpoint_carries_the_components(monkeypatch):
    """The answer the form reads; it must not need a second round trip."""
    monkeypatch.setattr(jira_fields, "configured", lambda: True)
    monkeypatch.setattr(jira_fields, "create_meta", lambda project: {"issue_types": [], "required_fields": []})
    monkeypatch.setattr(jira_fields, "components", lambda project: [{"id": "1", "name": "MCP"}])
    monkeypatch.setattr(escalations, "_defaults", lambda: ("ITHD", "Task", [], True))

    body = escalations.fields(project="ITHD", user="admin")
    assert body["components"] == [{"id": "1", "name": "MCP"}]
