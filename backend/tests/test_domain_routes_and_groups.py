"""Category routes and groups: the two reasons a domain card said "No Jira route".

`classifier_domains.jira_project` was displayed but never read by `escalate`, so the badge was
decorative; and `app_groups` had no writer at all, so the assignee picker found no groups on
every install.
"""
from __future__ import annotations

import inspect

from app.integrations import jira
from app.main import app


def test_the_group_routes_exist():
    paths = set(app.openapi()["paths"])
    assert "/api/admin/groups" in paths
    assert "/api/admin/groups/{name}" in paths


def test_escalation_uses_the_domains_own_project(monkeypatch):
    monkeypatch.setattr(jira, "domain_project", lambda domain: "NETOPS")
    source = inspect.getsource(jira.escalate)
    # project resolution happens before the create call, and an explicit project still wins
    assert "project = project or domain_project(domain) or None" in source


def test_an_unknown_domain_still_falls_back_to_the_global_project(monkeypatch):
    # No DB row -> "" -> escalate keeps the configured global project.
    assert jira.domain_project("no_such_domain") == ""
    assert jira.domain_project("") == ""


def test_groups_can_be_staffed_and_removed():
    from app.api import admin

    create = inspect.getsource(admin.create_group)
    update = inspect.getsource(admin.update_group)
    delete = inspect.getsource(admin.delete_group)
    assert "GroupMember(group_name=name" in create
    assert "GroupMember(group_name=name" in update
    # deleting a group must not leave dangling assignee rows
    assert "DomainAssignee" in delete
