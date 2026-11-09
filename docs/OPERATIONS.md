# Operations — day 2

Deployment is [DEPLOYMENT.md](DEPLOYMENT.md). This is what you do after it: watch it, back it
up, upgrade it, and fix it when a part degrades.

`$NS` below is your namespace (`NAMESPACE` in `infra/env`).

---

## 1. Daily checks

```bash
kubectl -n $NS get pods
kubectl -n $NS exec deploy/backend -- python -m app.bootstrap --check
curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAIN/
```

In the UI: **Overview** answers three questions at once — is anything broken (system health
row), what did it do (conversations, escalations), what does it cost (tokens/latency). A `—`
means "no data yet", never zero.

**Metrics** (if Alloy is deployed) go to Prometheus with `environment="dev"` and
`namespace=$NS`:

| Metric | Watch for |
| --- | --- |
| `guardrail_events_total{type,action}` | injection attempts, PII blocks |
| `llm_tokens_total`, `llm_cost_usd` | spend per model |
| `rag_answer_latency_seconds` | p95 climbing past ~45s |
| `rerank_failures_total` | reranker degraded → answers fall back to vector order |
| `kb_sync_*` | sync failures, article count flat |

## 2. Logs

```bash
kubectl -n $NS logs deploy/backend --tail=200 -f
kubectl -n $NS logs deploy/celery-worker --tail=100
kubectl -n $NS logs job/db-init
kubectl -n $NS logs statefulset/redis-data
```

Structured lines worth grepping: `GUARDRAIL` (blocked input), `rerank attempt` (degraded
reranker), `langgraph path failed` (fell back to the linear pipeline), `sync` (KB ingest).

Every guardrail decision is also durable in the database:

```sql
SELECT created_at, action, username, detail FROM audit_log
WHERE action LIKE 'guardrail.%' ORDER BY created_at DESC LIMIT 20;
```

## 3. Backups and restore

CloudNativePG + the barman-cloud plugin: nightly base backup **plus** continuous WAL, so you
can restore to a minute, not just to last night. Details and the full restore walkthrough:
[postgres-backup-restore.md](postgres-backup-restore.md).

Check that backups are actually happening:

```bash
kubectl -n $NS get scheduledbackup
kubectl -n $NS get backup
kubectl -n $NS describe backup <latest> | tail -20
```

Rule: a backup you have never restored is a hypothesis. Once per quarter, restore into a
scratch namespace and count rows in `articles`, `chat_messages`, `audit_log`.

## 4. Upgrade a release

```bash
infra/scripts/build-images.sh --backend            # or --frontend, from a checkout of the tag
sed -i 's/^BACKEND_TAG=.*/BACKEND_TAG=<new>/' infra/env
python3 infra/scripts/render.py
kubectl apply -f infra/.rendered/30-backend.yaml -f infra/.rendered/43-celery.yaml
kubectl -n $NS rollout status deploy/backend --timeout=300s
```

If the release changes the schema, run the `db-init` Job afterwards (it is idempotent).
Rollback is image-only — see [DEPLOYMENT.md §10](DEPLOYMENT.md).

## 5. Scaling

| Component | Knob | Notes |
| --- | --- | --- |
| backend | `replicas` | stateless; SSE streams are per-request, no sticky sessions needed |
| celery-worker | `replicas` | sync is chunk-safe, parallel workers are fine |
| rerank-svc | `replicas` | CPU-bound; one replica ≈ 2 cores. More replicas help concurrency, not latency |
| ollama | `replicas` + memory | each replica holds the embedding model (~300MB) |
| postgres | `spec.instances` | 1 is correct for dev; HA needs 3 and the operator handles failover |
| redis | `replicas` on both StatefulSets | prod shape: 3 data + 3 sentinel; update `REDIS_SENTINELS` in `05-config.yaml` |

Changing CPU limits on backend/rerank matters more than replicas: an undersized limit turns
into 30-second answers long before it turns into errors.

## 6. Rotating secrets

| Secret | Procedure | Blast radius |
| --- | --- | --- |
| LLM provider key | Settings → AI service | none; takes effect on the next request |
| Confluence / Jira token | Settings → Integrations | none |
| LDAP bind password | Settings → Integrations | none |
| `JWT_SECRET` | update secret, restart backend | every user is signed out |
| Postgres password | `ALTER ROLE app PASSWORD …`, then update `backend-secrets` + `postgres-dev-app`, restart backend/worker | a few seconds of failed queries |
| `rerank-api-key` | update secret, restart backend and rerank-svc | rerank falls back to vector order until both restart |

```bash
infra/scripts/create-secrets.sh --force     # regenerates everything (rotates all of the above)
```

## 7. Knowledge base

- **Routine** — `celery-beat` syncs Confluence every 30 minutes. Manual: Knowledge → Sync.
- **Re-index everything** (after changing the embedding model — the dimension must stay 768):

  ```bash
  kubectl -n $NS exec deploy/backend -- python -c "
  from app.persistence.database import SessionLocal
  from sqlalchemy import text
  with SessionLocal() as s:
      s.execute(text('TRUNCATE langchain_pg_embedding')); s.commit()
  print('embeddings cleared')"
  ```

  Then sync again and watch the reader panel: `chunked`, `embedded`, `skipped`.
- **A page answered badly** — check it is not excluded by domain ACL, and that its chunks
  are not boilerplate (chunking is heading-aware; a 10KB page with no headings becomes one
  chunk and reranks poorly).

## 8. Common incidents

| Symptom | First check | Usual cause |
| --- | --- | --- |
| Answers take 30–60s | `rag_answer_latency_seconds`, provider status | slow provider or an unthrottled CPU limit on backend/rerank |
| Answers cite nothing | Overview → retrieval counters | embeddings job failed, or Ollama unreachable |
| "I couldn't find information" for a page you know exists | `audit_log` for `domain_blocked` | role/domain ACL, not retrieval |
| 429 in the browser | `x-ratelimit-rule` header | 60/min per user; tune the tier if a dashboard polls hard |
| 401 everywhere after a deploy | `JWT_SECRET` in the secret vs the pod env | secret rotated without restarting, or a different secret in the two Deployments |
| Login works, everything else 403 | RBAC groups vs directory group names | group name mismatch (`RBAC_ADMIN_GROUPS`) |
| Pod restarting | `kubectl describe pod` | OOMKilled (raise limits) or a failed readiness probe |
| Frontend loads, API 502 | `kubectl -n $NS get endpoints frontend backend` | backend Service has no ready pod |

## 9. Maintenance window

```bash
kubectl -n $NS scale deploy/celery-beat --replicas=0          # no sync mid-change
kubectl -n $NS exec deploy/backend -- python -m app.bootstrap --check   # snapshot state
# … change, deploy, verify …
kubectl -n $NS scale deploy/celery-beat --replicas=1
```

Do not scale the database down for maintenance: the WAL archiver runs from the primary.
