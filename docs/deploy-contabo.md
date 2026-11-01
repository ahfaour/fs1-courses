# Hosting on the Contabo server (edufs.org)

The live site is **https://edufs.org/lufs1-courses**, on a Contabo VPS (Ubuntu 24.04).
`www.edufs.org` redirects to `edufs.org`. DNS is at name.com: two A records (`@` and `www`) → the server.

`BASE_PATH=/lufs1-courses` in `/srv/fs1-courses/.env` puts the prefix on every link and redirect, and Caddy sends old links to the same path under `/lufs1-courses`. To change the address, change both. The health check stays at `/healthz` on port 3000.

`https://edufs.org` itself is a separate static main page in `/srv/edufs-home`, with its files under `/home/`. Its source and publishing steps are in the `edufs-home` folder beside this project.

## Publishing a change

From this folder on the laptop:

```bash
git push server main
```

The server checks out `main`, runs `npm ci` and `npm run build`, restarts the site and checks `/healthz`.
The push output ends with `>> Site is up`, or shows the error log if the site failed to start.
Also `git push origin main` to keep GitHub up to date.

## What runs where

| Piece | Where |
| --- | --- |
| Push target (bare repo + `hooks/post-receive`) | `/srv/git/fs1-courses.git` |
| App code (built) | `/srv/fs1-courses/app`, owned by user `fs1` |
| Settings and secrets | `/srv/fs1-courses/.env` (mode 600; symlinked into `app/`) |
| Database | PostgreSQL 17 on the server, database `fs1`, role `fs1`. Uploaded files are stored in it. |
| Service | `systemctl status fs1-courses`, logs: `journalctl -u fs1-courses -f` |
| HTTPS proxy | Caddy, `/etc/caddy/Caddyfile`. Certificates renew automatically. |
| Firewall | `ufw`: only SSH, 80 and 443 are open |

## Admin account

Create it, or reset its password (typed at the prompt):

```bash
ssh -t root@edufs.org "cd /srv/fs1-courses/app && runuser -u fs1 -- npm run create-admin -- --email you@example.com"
```

## Backups

```bash
ssh root@edufs.org "runuser -u postgres -- pg_dump -Fc fs1" > fs1-backup.dump
```
