"""Phase 9 RBAC/ACL unit tests (no LDAP/network needed)."""
from app.auth.rbac import allowed_domains, get_role, jira_route
from app.config import SETTINGS


def test_dev_is_admin(monkeypatch):
    monkeypatch.setattr(SETTINGS, "rbac_enabled", True)
    monkeypatch.setattr(SETTINGS, "dev_admin_usernames", "dev")
    assert get_role("dev") == "admin"


def test_nonadmin_defaults_to_user(monkeypatch):
    monkeypatch.setattr(SETTINGS, "rbac_enabled", True)
    monkeypatch.setattr(SETTINGS, "dev_admin_usernames", "dev")
    monkeypatch.setattr(SETTINGS, "ldap_url", "")  # no directory → no groups
    assert get_role("jsmith") == "user"


def test_admin_sees_all_domains():
    assert allowed_domains("admin") is None


def test_role_scoped_domains(monkeypatch):
    monkeypatch.setattr(SETTINGS, "role_domains", "user=general,system;agent=database,security;admin=*")
    assert allowed_domains("user") == {"general", "system"}
    assert allowed_domains("agent") == {"database", "security"}


def test_jira_per_domain_routing(monkeypatch):
    monkeypatch.setattr(SETTINGS, "domain_jira_routing", "database=IT,db-lead;network=IT,net-lead")
    assert jira_route("database") == {"project": "IT", "assignee": "db-lead"}
    assert jira_route("network") == {"project": "IT", "assignee": "net-lead"}
    assert jira_route("unknown") == {"project": None, "assignee": None}
