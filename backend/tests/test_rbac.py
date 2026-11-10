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
    monkeypatch.setattr(SETTINGS, "role_domains", "user=general,system;knowledge=database,security;admin=*")
    assert allowed_domains("user") == {"general", "system"}
    assert allowed_domains("knowledge") == {"database", "security"}


def test_jira_per_domain_routing(monkeypatch):
    monkeypatch.setattr(SETTINGS, "domain_jira_routing", "database=IT,db-lead;network=IT,net-lead")
    assert jira_route("database") == {"project": "IT", "assignee": "db-lead"}
    assert jira_route("network") == {"project": "IT", "assignee": "net-lead"}
    assert jira_route("unknown") == {"project": None, "assignee": None}


def test_the_three_roles_and_their_capabilities():
    """The product spec, as an assertion: User asks/searches/raises tickets,
    Knowledge Manager also owns the KB and routing, Administrator owns everything.
    "IT Support" is gone — a regression that re-adds it fails here."""
    from app.auth.rbac import _DEFAULT_MATRIX, ROLES

    assert set(ROLES) == {"admin", "knowledge", "user"}
    assert set(_DEFAULT_MATRIX) == {"Administrator", "Knowledge Manager", "User"}

    user = _DEFAULT_MATRIX["User"]
    assert user == {"chatbot": True, "kb_search": True, "create_tickets": True,
                    "manage_kb": False, "manage_users": False, "manage_domains": False}

    km = _DEFAULT_MATRIX["Knowledge Manager"]
    assert km == {"chatbot": True, "kb_search": True, "create_tickets": True,
                  "manage_kb": True, "manage_users": False, "manage_domains": True}

    assert all(v is True for v in _DEFAULT_MATRIX["Administrator"].values())


def test_legacy_role_values_normalize_instead_of_granting():
    from app.auth.rbac import normalize_role

    assert normalize_role("agent") == "user"          # removed role → least privilege
    assert normalize_role("IT Support") == "user"
    assert normalize_role("domain_manager") == "knowledge"
    assert normalize_role("knowledge") == "knowledge"
    assert normalize_role(None) == "user"
    assert normalize_role("nonsense") == "user"


def test_matrix_endpoint_lists_only_the_three_roles(monkeypatch):
    """The removed role must not survive in the API used by the Users page.

    It did: admin_ops kept its own copy of the default matrix, so deleting the role from
    rbac.py still left "IT Support" on the RBAC screen.
    """
    from fastapi.testclient import TestClient

    import app.auth.rbac as rbac
    from app.auth.deps import get_current_user
    from app.main import app

    app.dependency_overrides[get_current_user] = lambda: "someone"
    monkeypatch.setattr(rbac, "get_role", lambda username: "admin")
    try:
        body = TestClient(app).get("/api/rbac/matrix").json()
    finally:
        app.dependency_overrides.clear()

    roles = {row["role"]: row["permissions"] for row in body["matrix"]}
    assert set(roles) == {"Administrator", "Knowledge Manager", "User"}
    assert roles["User"]["create_tickets"] is True
    assert roles["Knowledge Manager"]["create_tickets"] is True
    assert roles["Knowledge Manager"]["manage_kb"] is True
    assert roles["Knowledge Manager"]["manage_domains"] is True
    assert roles["User"]["manage_kb"] is False and roles["User"]["manage_users"] is False
