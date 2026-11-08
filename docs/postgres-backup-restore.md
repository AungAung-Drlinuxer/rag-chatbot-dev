# Postgres Backup & Restore — dev

Dev မှာ prod နဲ့ **အတူတူ mechanism** ကို သုံးထားပါတယ်: CloudNativePG + barman-cloud plugin
→ S3 (`s3.drlinuxer.com`)။ ကွာခြားချက်က prefix နဲ့ retention ပဲ။

| | prod (`rag-chatbot`) | dev (`rag-chatbot-dev`) |
|---|---|---|
| destination | `s3://production-backups/rag-chatbot-postgres` | `s3://production-backups/rag-chatbot-dev-postgres` |
| retention | 14d | 7d |
| nightly base backup | 19:30 | 19:45 |
| WAL archiving | on (continuous) | on (continuous) |
| instances | 3 | 1 |

WAL archiving ရှိလို့ **point-in-time recovery** ရပါတယ် — "မနေ့ညက backup" တစ်ခုတည်း
မဟုတ်ဘဲ မိနစ်အထိ ပြန်တင်နိုင်ပါတယ်။

## ၁။ ဖိုင်တွေ

- `infra/k8s-dev/20-database.yaml` — Cluster ထဲမှာ `plugins: barman-cloud…isWALArchiver`
  နဲ့ `archive_mode: on`။
- `infra/k8s-dev/21-backup.yaml` — `ObjectStore` (bucket/prefix/credentials) နဲ့
  `ScheduledBackup` (nightly)။

Credential secret `cnpg-backup-s3` (keys: `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION`)
ကို **repo ထဲ မထည့်ပါ**။ prod namespace ကနေ copy လုပ်တာဖြစ်ပြီး တန်ဖိုးတွေကို chat/log
ထဲ မရေးပါ။

## ၂။ စစ်ဆေးပုံ

```bash
# cluster backup plugin + archive mode
kubectl -n rag-chatbot-dev get cluster postgres-dev \
  -o jsonpath='{.spec.plugins}{"\n"}{.spec.postgresql.parameters.archive_mode}{"\n"}'

# nightly schedule
kubectl -n rag-chatbot-dev get scheduledbackup postgres-dev-nightly \
  -o jsonpath='{.spec.schedule} next={.status.nextScheduleTime}{"\n"}'

# backups list (completed/failed + size)
kubectl -n rag-chatbot-dev get backups

# WAL archiver health — last_archived_time က လတ်တလော ဖြစ်ရမယ်
kubectl -n rag-chatbot-dev exec postgres-dev-1 -c postgres -- \
  psql -U postgres -d assistant -c "SELECT last_archived_time, failed_count FROM pg_stat_archiver;"
```

## ၃။ ကိုယ်တိုင် backup တစ်ခု ယူချင်ရင်

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

## ၄။ Restore drill (အရေးကြီး)

Restore ကို **အသစ်တစ်ခုပေါ်မှာ** စမ်းပါ — လက်ရှိ dev DB ကို မဖျက်ပါနဲ့။

```bash
# 1) အဲဒီ backup ရဲ့ ID ကို ယူ
kubectl -n rag-chatbot-dev get backup postgres-dev-manual-202611081200 \
  -o jsonpath='{.status.backupId}{"\n"}'      # ဥပမာ 20261108T044052

# 2) အသစ် cluster တစ်ခု (တူညီတဲ့ secret တွေ သုံး) ကို ObjectStore ကနေ bootstrap
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
        targetTime: "2026-11-08 12:00:00+00"   # PITR လိုချင်ရင် ဒီနေရာမှာ သတ်မှတ်
  externalClusters:
    - name: dev-store
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: cnpg-backup-store
          serverName: postgres-dev
YAML

# 3) စစ်ပြီး ပြီးရင် ဖျက်
kubectl -n rag-chatbot-dev exec postgres-dev-restore-1 -c postgres -- \
  psql -U postgres -d assistant -tAc "select count(*) from kb_meta;"
kubectl -n rag-chatbot-dev delete cluster postgres-dev-restore
```

## ၅။ သတိထားရန်

- `retentionPolicy: 7d` — dev အတွက် ရက်သတ္တပတ်တစ်ခုပဲ သိမ်းတယ်။ ပိုကြာချင်ရင်
  `21-backup.yaml` ထဲ ပြင်ပါ။
- Bucket တူတူဖြစ်လို့ **prefix ကို ဘယ်တော့မှ မရောပါနဲ့** — dev backup ကို prod လို
  restore လုပ်မိရင် data ဟောင်းတွေ ဝင်လာမယ်။
- Backup က database တစ်ခုလုံး (roles အပါ) ပြန်ရတယ်; password တွေက `postgres-dev-app`
  secret ကနေ လာတာမို့ restore cluster အတွက်လည်း အဲဒီ secret ရှိရမယ်။
