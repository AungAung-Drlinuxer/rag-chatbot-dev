# workers/

Celery + background jobs must sit OUTSIDE app/ (Matrix rule). Existing sync
tasks currently live inside the production main.py/dashboard.py — extraction
happens in the workers PR (see GOVERNANCE.md).
