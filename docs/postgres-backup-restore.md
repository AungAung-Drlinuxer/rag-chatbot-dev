# Postgres Backup & Restore — dev

Dev uses the **same mechanism** as prod: CloudNativePG + barman-cloud plugin
→ S3 (`s3.drlinuxer.com`). Only the prefix and retention differ.

| | prod (`rag-chatbot`) | dev (`rag-chatbot-dev`) |
|---|---|---|
| destination | `s3://production-backups/rag-chatbot-postgres` | `s3://production-backups/rag-chatbot-dev-postgres` |
| retention | 14d | 7d |
| nightly base backup | 19:30 | 19:45 |
| WAL archiving | on (continuous) | on (continuous) |
| instances | 3 | 1 |

With WAL archiving you get **point-in-time recovery** — not just "last night's backup",
you can restore to the minute.

## 1. Files

- `infra/k8s-dev/20-database.yaml` — the Cluster has `plugins: barman-cloud…isWALArchiver`
  and `archive_mode: on`.
- `infra/k8s-dev/21-backup.yaml` — `ObjectStore` (bucket/prefix/credentials) and
  `ScheduledBackup` (nightly).

The credential secret `cnpg-backup-s3` (keys: `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION`)
is **not committed to the repo**. It is copied from the prod namespace; do not write the
values into chat or logs.

## 2. How to verify

```bash
# cluster backup plugin + archive mode
kubectl -n rag-chatbot-dev get cluster postgres-dev \
  -o jsonpath='{.spec.plugins}{"\n"}{.spec.postgresql.parameters.archive_mode}{"\n"}'

# nightly schedule
kubectl -n rag-chatbot-dev get scheduledbackup postgres-dev-nightly \
  -o jsonpath='{.spec.schedule} next={.status.nextScheduleTime}{"\n"}'

# backups list (completed/failed + size)
kubectl -n rag-chatbot-dev get backups

# WAL archiver health — last_archived_time must be recent
kubectl -n rag-chatbot-dev exec postgres-dev-1 -c postgres -- \
  psql -U postgres -d assistant -c "SELECT last_archived_time, failed_count FROM pg_stat_archiver;"
```

## 3. Taking a manual backup

```bash
kubectl -n rag-chatbot-dev apply -f - <<'YAML'
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: postgres-dev-manual-$(date +%Y%m%d%H%M)
  namespace: rag-chatbot-dev
spec:
  cluster: { name: postgres-dev }
  method: plugin
  pluginConfiguration: { name: barman-cloud.cloudnative-pg.io }
YAML

kubectl -n rag-chatbot-dev get backups -w     # phase: started → completed
```

## 4. Restore drill (important)

Test the restore on **a new cluster** — do not delete the current dev DB.

```bash
# 1) Get that backup's ID
kubectl -n rag-chatbot-dev get backup postgres-dev-manual-202611081200 \
  -o jsonpath='{.status.backupId}{"\n"}'      # e.g. 20261108T044052

# 2) Bootstrap a new cluster (using the same secrets) from the ObjectStore
kubectl -n rag-chatbot-dev apply -f - <<'YAML'
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres-dev-restore
  namespace: rag-chatbot-dev
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/postgresql:16.4
  storage: { size: 5Gi }
  bootstrap:
    recovery:
      source: dev-store
      recoveryTarget:
        targetTime: "2026-11-08 12:00:00+00"   # set this to pin PITR
  externalClusters:
    - name: dev-store
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: cnpg-backup-store
          serverName: postgres-dev
YAML

# 3) Verify, then delete
kubectl -n rag-chatbot-dev exec postgres-dev-restore-1 -c postgres -- \
  psql -U postgres -d assistant -tAc "select count(*) from kb_meta;"
kubectl -n rag-chatbot-dev delete cluster postgres-dev-restore
```

## 5. Cautions

- `retentionPolicy: 7d` — dev keeps one week only. To keep longer, edit
  `21-backup.yaml`.
- Because the bucket is shared, **never mix up the prefix** — restoring a dev backup as
  prod would bring in stale data.
- A backup restores the entire database (including roles); passwords come from the
  `postgres-dev-app` secret, so that secret must also exist for the restore cluster.
