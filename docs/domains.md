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

## Jira route per category

`classifier_domains.jira_project` is what the card's route badge shows **and** what
`escalate()` uses for the issue's project (`domain_project(domain)`), falling back to the
global project when a category has none. An empty value is a real "No Jira route": tickets for
that category would land in the default project while the board implies otherwise.

## Groups and assignees per category

`app_groups` had a reader but no writer, so every install showed "no groups". It is now
manageable where it is used:

- `GET/POST /api/admin/groups`, `PUT/DELETE /api/admin/groups/{name}` (needs `manage_users`),
- the **Assignees** dialog creates a group, ticks its members, and can delete it;
  deleting a group also removes it from every category mapping.

`domain_assignees` maps a category to groups and/or users;
`GET /api/tickets/assignees?domain=<key>` expands groups through `app_group_members` and
returns each person with the group they came from, plus a default (the first), which the
create dialog preselects.
