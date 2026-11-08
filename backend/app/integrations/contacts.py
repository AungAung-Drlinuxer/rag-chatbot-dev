"""IT team-lead contact lookup (design doc §7 GET /api/contacts/{domain})."""
from __future__ import annotations

from app.config import SETTINGS

GENERAL = {"name": "IT Helpdesk", "email": "helpdesk@example.com", "phone": "+65-555-0000"}


def get_contact(domain: str | None) -> dict:
    """Return the IT team lead for a domain, or a general helpdesk fallback."""
    if domain and domain in SETTINGS.it_contacts:
        return {"domain": domain, **SETTINGS.it_contacts[domain]}
    return {"domain": "general", **GENERAL}
