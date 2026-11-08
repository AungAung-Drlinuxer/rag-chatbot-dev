# Domains & routing

## How a question is routed

1. **LLM classifier (primary)** — `app/classifier/llm_classifier.py` sends the active domain
   catalogue (`display_name` + `description`) and the question to the configured model and
   expects `{domain, confidence, reason}`. Unknown key, unparseable reply or a model outage →
   falls back, never an error.
2. **Keyword rules (fallback)** — `app/classifier/engine.py`, substring hits from
   `classifier_domains.keywords`, cached in memory for sub-millisecond matching.

So a domain with **no keywords is still routable** — the LLM path only needs a name and a
description. The board says "No keyword fallback — routing still works through the LLM" rather
than claiming the domain can never match.

## Auto-writing a profile

`POST /api/admin/domains/{id}/suggest` asks the same model to draft:

- a one-sentence **description** (≤280 chars) of what belongs in the domain,
- 10–18 **keywords** a user would type.

**When it runs automatically**

- **On create** — `POST /api/admin/domains` drafts the profile when the request left the
  description or keywords blank, and reports `auto_profile: true`. A model outage never blocks
  the create: the domain is saved and can be filled later.
- **Nightly at 04:10 UTC** — `workers.sync_tasks.backfill_domain_profiles` fills blanks only
  (description empty or keywords empty), up to 10 LLM calls per run. Anything an admin wrote is
  never overwritten.
- **Manually** — "Suggest with AI" in the Edit sheet, which *does* replace the fields in the
  form (saving stays explicit).

It is grounded in the titles of the articles already classified into that domain
(`kb_meta.title` where `lower(domain) = key`, newest 25), so the vocabulary is this workspace's
own. The admin UI exposes it as **Suggest with AI** in the Edit sheet — the values land in the
form and are only stored when the admin saves. A missing/limited model returns `503` with a
reason; nothing is written.

## The three flags on a domain card

| Flag | Means | Fix |
|---|---|---|
| `No Jira route` | `jira_project` is empty, so escalations cannot be filed | Edit → Jira project (e.g. `ITHD`) |
| `No description` | The LLM router only has the name and the keywords | Suggest with AI |
| `No keyword fallback` | Offline keyword path has nothing to match | Suggest with AI |

## Assignees per category

`domain_assignees` maps a category to app groups and/or users (Domains → **Assignees**);
`GET /api/tickets/assignees?domain=<key>` expands groups to members for the create dialog.
