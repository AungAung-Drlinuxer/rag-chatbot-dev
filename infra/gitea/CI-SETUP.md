# Gitea Actions CI — setup runbook + workflow

## Status
Workflows committed (`.gitea/workflows/ci.yml` in this repo). Runner deployment
manifests in `infra/gitea/act-runner.yaml`. The ONE manual step left is creating
a runner registration token in the Gitea UI (admin API session can't be scripted
because the old API password was rotated — by design).

## 1. Get a registration token (one-time, in Gitea web UI)
Login as `ithadmin` → **Site Administration → Actions → Runners → Create new runner**
→ copy the registration token.

Then, from a machine with kubectl:
```bash
kubectl -n gitea create secret generic act-runner-token \
  --from-literal=token=<PASTE_TOKEN> --dry-run=client -o yaml | kubectl apply -f -
```

## 2. Deploy the runner
```bash
kubectl apply -f infra/gitea/act-runner.yaml
kubectl -n gitea rollout status deploy/act-runner
```
The runner registers itself on start (GITEA_INSTANCE_URL + token secret) and
picks up jobs with label `ubuntu-latest` (actually a gitea/act_runner pod that
spawns job pods via the cluster's containerd — dind-free, uses host daemon).

## 3. What CI runs (per PR + push to dev/main)
| Gate | Command | Blocking? |
|---|---|---|
| Type check | `npx tsc --noEmit` | yes |
| Governance lint | `npx eslint src` (raw fetch / @/api = errors) | yes |
| Unit tests | `npm test` (vitest, 10 contract tests) | yes |
| Production build | `npm run build` (vite, includes tsc) | yes |

Backend jobs (pytest/ruff) will join when the backend copy in this repo becomes
the deploy source — workflow stubs are commented out in ci.yml until then.

## 4. Verify
- Repo → **Actions** tab shows the workflow runs
- PR → checks appear on the merge box (required status checks:
  set `main` protection → status check `ci / gates` to mandatory once green)
