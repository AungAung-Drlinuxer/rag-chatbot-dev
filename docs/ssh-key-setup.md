# SSH Key Setup for Gitea (git.drlinuxer.com)

## 1. Add your public key to Gitea (one time, via web UI)

Your public key (already on this machine, `~/.ssh/id_ed25519.pub`):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFEGsXqY7E1PO4tZIEZtLaCHTrnmvq83g58Om/fi0TTv aungaung@drlinuxer
```

Steps:
1. Login → https://git.drlinuxer.com → **Settings → SSH / GPG Keys**
2. **Add Key** → paste the line above → name it `aungaung@work` → Add

## 2. SSH routing — the cluster side is DONE, one proxy rule remains

Cluster already exposes Gitea SSH on NodePort **30222** (verified reachable on
worker `10.10.10.94`). But `git.drlinuxer.com` resolves to **10.10.10.16** (the
reverse-proxy VM), whose port 22 is the VM's own OpenSSH — NOT the cluster.

Pick ONE fix on the 10.10.10.16 proxy host:

### Option A (recommended) — port-forward 2222 → cluster NodePort
On 10.10.10.16, add a TCP forward: host port **2222** → `10.10.10.200:30222`
(nginx stream block or socat). Then use this SSH alias:

```
# ~/.ssh/config
Host git.drlinuxer.com
    HostName git.drlinuxer.com
    Port 2222
    User git
    IdentityFile ~/.ssh/id_ed25519
```

Then set Gitea's advertised SSH port to 2222 (Gitea UI → Site Admin →
Configuration, or env `GITEA__server__SSH_PORT=2222` in the deployment) so
clone URLs are correct.

### Option B (quickest test, no proxy change)
Use the worker NodePort directly:

```
git clone ssh://git@10.10.10.94:30222/ragchatbot/ragchatbot.git
```

## 3. Verify

```bash
ssh -T git@git.drlinuxer.com        # Option A (after alias)
ssh -T -p 30222 git@10.10.10.94     # Option B
# expected: "Hi there, ithadmin! You've successfully authenticated..."
```

## 4. Cleanup note
`%LOCALAPPDATA%\Temp\gitea_admin_pw` still holds the OLD admin password —
delete it (password already rotated in the UI).

## DONE (2026-09-03)
- gitssh.drlinuxer.com -> 10.10.10.201 registered in internal DNS
- remote gitea = git@gitssh.drlinuxer.com:ragchatbot/ragchatbot.git (verified)
