# Running Mind Palace on a Raspberry Pi

Guide for running Mind Palace in production: a Raspberry Pi (aarch64,
Raspberry Pi OS) running the server 24/7 as a systemd service, with the
frontend bundle built on a dev machine and shipped over SSH.

Throughout this guide the examples use the Raspberry Pi OS default
username `pi` and the hostname `rpi`; substitute your own user/hostname
everywhere. If your username differs, replace `/home/pi` in the systemd
unit with your home directory (or use systemd's `%h` specifier, which
expands to the service user's home).

## Mental model: what runs where

- **On the Pi:** the entire app — SQLite database (e.g.
  `/home/pi/mind-palace/mind-palace.db`), the Hono API server
  (`pnpm --filter @mind-palace/server start` → `tsx src/index.ts`), and the
  CP-SAT scheduler, which the server spawns on demand as a subprocess
  (`uv run --project workers/cp-sat python scheduler.py`).
- **On the dev machine:** the frontend **build**. Vite
  (`pnpm --filter @mind-palace/web build`) is too slow/memory-hungry to run
  on the Pi, so `apps/web/dist/` is compiled there and rsync'd to the Pi.
  The Pi server serves that `dist/` directory statically.
- Users reach the app over the network at `http://<pi-hostname>:4310` (the
  server binds `0.0.0.0:4310`). Single-owner, no auth.

## Prerequisites

**Pi:** Raspberry Pi OS (64-bit, Bookworm or newer), `git`, `curl`, a
GitHub SSH key (`ssh-keygen -t ed25519`, then add the public key to your
GitHub account — the repo is cloned over `git@github.com`), and Tailscale
enabled if you want to reach it remotely without opening firewall ports.

**Dev machine** (a Linux laptop in the example; macOS works too): Node 22+
(the server needs `node:sqlite`, introduced in Node 22), pnpm 10
(the repo pins `packageManager: pnpm@10.15.1` in the root `package.json`),
and SSH access to the Pi (`ssh pi@rpi` must already work, ideally via an
entry in `~/.ssh/config`).

## 1. Clone the repo on the Pi

The default branch is not necessarily `new-impl`, so check it out
explicitly:

```sh
ssh pi@rpi
git clone git@github.com:eric-chapdelaine/mind-palace.git ~/mind-palace
cd ~/mind-palace
git checkout -b new-impl --track origin/new-impl
```

## 2. Install the toolchain and dependencies (once)

```sh
# Node via nvm (the server needs node:sqlite, so Node 22+)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# (reload your shell, then)
nvm install 26
nvm alias default 26

# pnpm (standalone installer → PNPM_HOME=~/.local/share/pnpm, adds itself to PATH)
curl -fsSL https://get.pnpm.io/install.sh | sh -

# uv (Astral standalone installer → ~/.local/bin/uv); needed by the scheduler
curl -LsSf https://astral.sh/uv/install.sh | sh

# Done: the shell config (~/.profile/.bashrc) should now put node, pnpm and uv on PATH.

# Install the repo's dependencies
cd ~/mind-palace
pnpm install
uv sync --project workers/cp-sat
```

Why these pieces: packages import each other as TypeScript source, so the
backend needs **no build step**. `pnpm install` links the TS sources and
`tsx` runs them directly. `uv sync` prepares the Python environment the
scheduler runs in.

## 3. Environment variables

The server reads exactly three (`apps/server/src/config.ts`):

| Variable | Default | Required in prod |
|---|---|---|
| `HOST` | `127.0.0.1` | `0.0.0.0` — otherwise not reachable from other hosts |
| `PORT` | `4310` | leave as-is |
| `DATABASE_PATH` | `<repo>/data/mind-palace.db` | a stable path in the repo root, e.g. `/home/pi/mind-palace/mind-palace.db` — put it somewhere untracked by git so pulls never touch it |

Note: a `.env` file in the repo root is **not read by anything** (the code
has no dotenv and no env-based secrets today). Credentials and config live
in the systemd unit's `Environment=` lines. If a future integration needs
env-based secrets, add them to the unit, not to `.env`.

## 4. First manual run (sanity check before systemd)

```sh
cd ~/mind-palace
HOST=0.0.0.0 DATABASE_PATH=$HOME/mind-palace/mind-palace.db \
  pnpm --filter @mind-palace/server start
# expect: "Mind Palace API listening on http://0.0.0.0:4310"
# then curl http://localhost:4310/ from another shell
```

The DB file is created and migrated automatically on first start (the
server calls `database.migrate()` on boot; `pnpm db:migrate` exists to run
it explicitly and fail loudly). If you hit `command not found` for
pnpm/node/uv in an SSH shell, see [Troubleshooting](#troubleshooting).

## 5. Run in the background with systemd (auto-start on boot)

Create `/etc/systemd/system/mind-palace.service`:

```ini
[Unit]
Description=Mind Palace (new-impl)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=pi
Group=pi
WorkingDirectory=/home/pi/mind-palace
Environment=PATH=/home/pi/.local/bin:/home/pi/.nvm/current/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOST=0.0.0.0
Environment=PORT=4310
Environment=DATABASE_PATH=/home/pi/mind-palace/mind-palace.db
ExecStart=/home/pi/.local/share/pnpm/bin/pnpm --filter @mind-palace/server start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now mind-palace.service
systemctl status mind-palace.service
journalctl -u mind-palace.service -f        # watch it come up
```

Details that matter:

- **`Environment=PATH` must include `~/.local/bin`** — the scheduler
  spawns `uv`, which the Astral installer puts at `~/.local/bin/uv`.
  Without it the journal shows `spawn uv ENOENT` on every schedule
  generation. Use `~/.nvm/current/bin` for node so the path stays valid
  when you upgrade Node via nvm.
- **`ExecStart` uses the absolute pnpm path**
  (`~/.local/share/pnpm/bin/pnpm`): systemd does not run your login shell,
  so it would otherwise not find pnpm or node.
- `WantedBy=multi-user.target` + `enable` = starts at boot, restarts on
  crash (`Restart=on-failure`).
- Make a backup of the unit before editing it:
  `sudo cp /etc/systemd/system/mind-palace.service{,.bak}`.

## 6. Shipping the frontend: build on the dev machine, rsync to the Pi

The Pi only runs the server; UI changes arrive as a pre-built bundle:

```sh
# on the dev machine, in the repo
pnpm --filter @mind-palace/web build      # writes apps/web/dist/ (gitignored)
rsync -az --delete apps/web/dist/ pi@rpi:/home/pi/mind-palace/apps/web/dist/
```

`--delete` removes stale hashed assets from the Pi. No service restart is
needed — the server reads the static files from disk per request. If the
page still looks old afterwards, hard-refresh (`Ctrl/Cmd+Shift+R`); the
hashed asset names bust caches, but `index.html` itself can be cached.

## 7. Updating the deployment (day-2 flow)

```sh
# --- on the Pi ---
ssh pi@rpi
sudo systemctl stop mind-palace.service
cd ~/mind-palace
git pull --ff-only origin new-impl
# Only if the pull changed package.json/pnpm-lock.yaml:
#   pnpm install
# Only if the pull changed workers/cp-sat/pyproject.toml or uv.lock:
#   uv sync --project workers/cp-sat
DATABASE_PATH=$HOME/mind-palace/mind-palace.db pnpm db:migrate
sudo systemctl start mind-palace.service
journalctl -u mind-palace.service -f

# --- on the dev machine, only if the pull touched apps/web/** ---
cd ~/mind-palace-dev                 # wherever your checkout lives
git pull --ff-only origin new-impl
pnpm --filter @mind-palace/web build
rsync -az --delete apps/web/dist/ pi@rpi:/home/pi/mind-palace/apps/web/dist/
```

Roughly: **migrations and backend changes need stop/pull/migrate/start on
the Pi; frontend changes need build+rsync from the dev machine** (a
backend-only update doesn't need the rsync, and a frontend-only update
doesn't need the restart — but doing the whole flow is always safe). Check
what's incoming first with
`git fetch origin && git log --oneline HEAD..origin/new-impl`.
`schema_migrations` is append-only: never edit an applied migration; add a
new `00N-*` file instead.

## 8. Daily backups to the dev machine

SD cards fail; the database is the one thing that must not live only on the
Pi. The backup strategy is two-sided:

**Pi side — a snapshot script using SQLite's online-backup API** (safe while
the server is running; no downtime, no `cp` of a live WAL database).
Place it at `~/.local/bin/mind-palace-backup.sh`:

```sh
#!/usr/bin/env bash
# Snapshot the live Mind Palace DB with the SQLite online-backup API.
set -euo pipefail
DB="$HOME/mind-palace/mind-palace.db"
SNAP="$HOME/backups/mind-palace-db-$(date +%F).db"
mkdir -p "$HOME/backups"
/usr/bin/python3 - "$DB" "$SNAP" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)          # consistent snapshot even while the server writes
dst.close(); src.close()
PY
echo "snapshotted $SNAP"
find "$HOME/backups" -name 'mind-palace-db-*.db' -mtime +14 -delete
```

```sh
chmod +x ~/.local/bin/mind-palace-backup.sh
~/.local/bin/mind-palace-backup.sh        # test it once
```

**Dev-machine side — a nightly pull** (cron on Linux, launchd on macOS;
use the dev→Pi SSH direction, which already has keys, so there's no open
listener on the dev machine):

```sh
crontab -e
# every day at 03:17
17 3 * * * mkdir -p ~/mind-palace-backups && ssh pi@rpi 'bash ~/.local/bin/mind-palace-backup.sh' && rsync -az pi@rpi:~/backups/ ~/mind-palace-backups/
```

The Pi keeps 14 days of snapshots locally (pruned by the script), and the
dev machine mirrors the whole `~/backups/` tree — so even a dead Pi leaves
the DB on the dev machine.

**Restore:**

```sh
sudo systemctl stop mind-palace.service
cp ~/mind-palace-backups/mind-palace-db-2033-01-01.db /tmp/restore.db
/usr/bin/python3 -c "import sqlite3; print(sqlite3.connect('/tmp/restore.db').execute('PRAGMA integrity_check').fetchone())"   # ok
cp /tmp/restore.db ~/mind-palace/mind-palace.db
sudo systemctl start mind-palace.service   # server migrates forward if the snapshot is older
```

## Troubleshooting

- **`command not found: pnpm/node/uv` over SSH.** Non-interactive SSH
  shells don't source your login shell config, so the toolchain isn't on
  `PATH`. Prefix your commands with
  `export PATH=$HOME/.nvm/current/bin:$HOME/.local/share/pnpm/bin:$HOME/.local/bin:$PATH`
  or use absolute paths. The systemd service is unaffected (it sets its
  own `PATH`).
- **`spawn uv ENOENT` in `journalctl -u mind-palace.service`.** The unit's
  `Environment=PATH` is missing `~/.local/bin`; add it and
  `sudo systemctl daemon-reload && sudo systemctl restart mind-palace.service`.
- **Page shows old UI after an update.** The dev-machine build+rsync step
  (#6) was skipped, or the browser cached `index.html` — hard refresh.
- **Git over SSH warns about a changed host key.** Your Pi's
  `~/.ssh/known_hosts` doesn't pin GitHub's IP range; it's a one-time
  prompt after GitHub rotates keys.
- **Scheduling windows look wrong.** The solver computes 07:00–23:00 slots
  in `America/New_York`; keep the Pi's clock sane (`timedatectl`, NTP is on
  by default) even though the TZ itself doesn't change the solver's fixed
  zone.
