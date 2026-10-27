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
  Python workers the server spawns on demand as subprocesses: the scheduling
  worker (`uv run --project workers/cp-sat python scheduler.py`, greedy by
  default) and,
  once authenticated, the Garmin Connect sync
  (`uv run --project workers/garmin python sync.py`).
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

The print feature renders PDFs with WeasyPrint, which needs pango/harfbuzz
shared libraries on top of the Python package. Install them once:

```sh
sudo apt update
sudo apt install -y libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi8
```

**Dev machine** (a Linux laptop in the example; macOS works too): Node 22+
(the server needs `node:sqlite`, introduced in Node 22), pnpm 10
(the repo pins `packageManager: pnpm@10.15.1` in the root `package.json`),
and SSH access to the Pi (`ssh pi@rpi` must already work, ideally via an
entry in `~/.ssh/config`).

## 1. Clone the repo on the Pi

The default branch is `main` — check it out explicitly so the Pi
follows a named branch:

```sh
ssh pi@rpi
git clone git@github.com:eric-chapdelaine/mind-palace.git ~/mind-palace
cd ~/mind-palace
git checkout main
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
uv sync --project workers/briefing   # the printable daily briefing (see §10)
uv sync --project workers/garmin     # only needed if you use the Garmin integration (see §9)
```

Why these pieces: packages import each other as TypeScript source, so the
backend needs **no build step**. `pnpm install` links the TS sources and
`tsx` runs them directly. `uv sync` prepares the Python environment each
worker runs in (`cp-sat` for the scheduler, `briefing` for the printable
daily briefing, `garmin` for the optional Garmin Connect sync).

Each worker is a `uv` project with its own `pyproject.toml` and `uv.lock` in
its directory. The server spawns them as
`uv run --project workers/<name> python <script>`, so the lock file decides
which versions actually run — that is why the locks are committed. The
`# /// script` header inside `render_briefing.py` is *not* what installs
WeasyPrint here; `uv run --project` ignores it in favour of `pyproject.toml`.

## 3. Environment variables

The server reads three deployment variables (`apps/server/src/config.ts`):

| Variable | Default | Required in prod |
|---|---|---|
| `HOST` | `127.0.0.1` | `0.0.0.0` — otherwise not reachable from other hosts |
| `PORT` | `4310` | leave as-is |
| `DATABASE_PATH` | `<repo>/data/mind-palace.db` | a stable path in the repo root, e.g. `/home/pi/mind-palace/mind-palace.db` — put it somewhere untracked by git so pulls never touch it |

Note: a `.env` file in the repo root is **not read by anything** (the code
has no dotenv and no env-based secrets today). Credentials and config live
in the systemd unit's `Environment=` lines. If a future integration needs
env-based secrets, add them to the unit, not to `.env`.

Integrations read their own environment on top of these. Garmin Connect
uses `GARMINTOKENSTORE` to locate its credential/token store; it is
optional (the server falls back to `~/.garminconnect` then `~/.garth`) and
only matters once you authenticate — see [§9](#9-optional-integrations-garmin-connect).

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
Description=Mind Palace
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
Environment=GARMINTOKENSTORE=/home/pi/.garminconnect
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
  generation (and Garmin sync would fail the same way). Use
  `~/.nvm/current/bin` for node so the path stays valid
  when you upgrade Node via nvm.
- **`Environment=GARMINTOKENSTORE` is optional** but recommended: it pins
  the token store path so the server doesn't have to guess the home
  directory under systemd. Harmless if you never authenticate.
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
git pull --ff-only origin main
# Only if the pull changed package.json/pnpm-lock.yaml:
#   pnpm install
# Only if the pull changed workers/cp-sat/pyproject.toml or uv.lock:
#   uv sync --project workers/cp-sat
# Only if the pull changed workers/briefing/pyproject.toml or uv.lock:
#   uv sync --project workers/briefing
# If you use Garmin and the pull changed workers/garmin/pyproject.toml or uv.lock:
#   uv sync --project workers/garmin
DATABASE_PATH=$HOME/mind-palace/mind-palace.db pnpm db:migrate
sudo systemctl start mind-palace.service
journalctl -u mind-palace.service -f

# --- on the dev machine, only if the pull touched apps/web/** ---
cd ~/mind-palace-dev                 # wherever your checkout lives
git pull --ff-only origin main
pnpm --filter @mind-palace/web build
rsync -az --delete apps/web/dist/ pi@rpi:/home/pi/mind-palace/apps/web/dist/
```

Roughly: **migrations and backend changes need stop/pull/migrate/start on
the Pi; frontend changes need build+rsync from the dev machine** (a
backend-only update doesn't need the rsync, and a frontend-only update
doesn't need the restart — but doing the whole flow is always safe). Check
what's incoming first with
`git fetch origin && git log --oneline HEAD..origin/main`.
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

## 9. Optional integrations (Garmin Connect)

The app ships an optional Garmin Connect integration: it syncs sleep and
recorded activities and shows them as read-only context on the Schedule
calendar. **It is enabled by authenticating, not by a config flag** — a
provider appears in the UI only once its credential/token store exists on
disk. Until then the app behaves exactly as if the integration were not
there (no sync button, no calendar overlay, no extra requests), so there
is nothing to disable if you don't want it. The generic endpoint
`GET /api/integrations` reports every provider's connection state.

### Garmin Connect

1. **Install the worker's Python deps** (once; `workers/garmin` was already
   synced in §2 if you ran that line):

   ```sh
   cd ~/mind-palace
   uv sync --project workers/garmin
   ```

2. **Authenticate to create the token store.** Run the login on the Pi over
   SSH, through the worker's uv environment so `garth` is importable:

   ```sh
   cd ~/mind-palace
   uv run --project workers/garmin python -c \
     "import garth; garth.login(); garth.save('/home/pi/.garminconnect')"
   ```

   This prompts for your Garmin email/password (and MFA, if enabled) and
   writes the store to `/home/pi/.garminconnect`. **The store is a
   credential** — keep it `chmod 700` and out of git and shared backups.
   To avoid a second login, you can instead run the same command on your
   dev machine and `scp -r` the store to `pi@rpi:~/.garminconnect`.

   The server runs as user `pi` (see the unit in §5), so the store must
   live in `/home/pi`; `GARMINTOKENSTORE` exists for the case where it
   doesn't.

3. **Point the server at it** (recommended under systemd). Add to the unit
   and reload — this is already in the §5 unit:

   ```ini
   Environment=GARMINTOKENSTORE=/home/pi/.garminconnect
   ```

   ```sh
   sudo systemctl daemon-reload && sudo systemctl restart mind-palace.service
   ```

   The server resolves this path with a plain filesystem check — no
   subprocess, no network — then passes it to the worker, so the check is
   cheap and safe even before you've authenticated.

4. **Verify** the app sees it:

   ```sh
   curl -s http://localhost:4310/api/integrations
   # → [{"key":"garmin","label":"Garmin Connect","connected":true,...}]
   ```

   `connected:true` makes the **Sync Garmin** button and the sleep/activity
   overlays appear on `http://<pi-hostname>:4310/schedule`. Removing the
   token store again hides them.

5. **Syncing is already scheduled.** The first sync pulls a short lookback
   window (7 days of sleep, 30 days of activities); later syncs fetch only
   from the newest stored date forward, so the daily job stays cheap. The
   server runs it in-process at 11:00 `America/New_York` (`garmin-sync` in
   `apps/server/src/jobs.ts`) — there is no crontab to add. Inspect it with:

   ```sh
   curl -s http://localhost:4310/api/jobs
   ```

   Sleep and activities land in the `sleep_sessions` / `health_activities`
   tables in the same SQLite database, so the daily backup in §8 already
   covers them.

### Future integrations

Any provider added later follows the same shape: `uv sync` its worker (if
it has one), authenticate it so its credential/token store exists, set the
provider-specific env var if the store isn't in the default location, and
it will show up in `GET /api/integrations` with its own control in the UI.
There is no central enable/disable list to edit — **authentication is the
switch**.

## 10. Printing the daily briefing

The briefing is one page you print rather than read on a screen. It lives at
`GET /api/briefing` — a PDF, rendered on demand from data already in the
database. **No live API calls are made when you print**: the weather in the DB
is what prints, so a page generated offline is still correct as of its last
sync.

### Where to run `lp`

The renderer runs on the Pi (it is part of the server). Printing can happen in
either place:

| You run `pnpm briefing` on… | Result |
|---|---|
| **the Pi** | Pi's `lp` sends the job to the network printer. Needs the printer installed in the Pi's CUPS. |
| **your laptop** | Laptop's `lp` prints a PDF fetched from the Pi over HTTP. Needs no printer setup on the Pi at all. |

The second is simpler for manual testing and for the first week, and it is
what the CLI defaults to. Use the first when you later want the Pi to print on
a schedule with nobody at the keyboard.

### Manual printing from your laptop (recommended for testing)

```sh
# in your dev checkout
MIND_PALACE_URL=http://rpi:4310 pnpm briefing
```

That fetches the PDF from the Pi and pipes it to your laptop's default
printer. Useful variants:

```sh
MIND_PALACE_URL=http://rpi:4310 pnpm briefing --printer Brother2460
MIND_PALACE_URL=http://rpi:4310 pnpm briefing --out ~/today.pdf   # no printing, just the file
MIND_PALACE_URL=http://rpi:4310 pnpm briefing --date 2026-10-26   # a different day
```

`--out` is the one to reach for while iterating: it writes the PDF and never
touches CUPS. Then `xdg-open ~/today.pdf` to eyeball it.

Set `MIND_PALACE_URL` in your shell profile if you'd rather not type it.
Tailscale also works: `http://<pi-tailscale-name>:4310`.

### Verifying the Pi can render at all

Before worrying about printing, confirm the Pi produces a PDF:

```sh
# on the Pi
curl -s http://localhost:4310/api/briefing -o /tmp/b.pdf
pdfinfo /tmp/b.pdf | head -3          # Pages: 1, Page size: 612 x 792 pts (letter)
```

If this returns JSON instead of a PDF, you are seeing an error — read it:

```sh
curl -s http://localhost:4310/api/briefing | head -c 400
```

The two failures you are most likely to hit, both reported this way:

- **`ModuleNotFoundError: No module named 'weasyprint'`** — `workers/briefing`
  was never `uv sync`'d. Run `uv sync --project workers/briefing` on the Pi.
- **`OSError: cannot load library 'libpango-1.0-0'`** (or `libgobject`) — the
  system libraries are missing; install the `apt` packages from
  [Prerequisites](#prerequisites).

The renderer takes about a second on a Pi 4 and a few seconds on a Zero. The
route has a 90-second timeout, so a slow first run (uv creating the venv) is
fine.

### Printing from the Pi

Only needed for the unattended case. Set up CUPS on the Pi once:

```sh
sudo apt install -y cups cups-client
sudo usermod -aG lpadmin pi          # log out and back in for this to apply
# Find the printer on the network, then add it. `lpinfo -v` lists IPP devices;
# for a Brother/HP on Bonjour the address looks like ipp://BRW...local:631/ipp/print
lpinfo -v | grep -i ipp
lpadmin -p Brother2460 -E -v ipp://BRW4845E6754379.local:631/ipp/print -m everywhere
lpstat -p                            # "printer Brother2460 is idle"
```

Then, from the Pi:

```sh
curl -s http://localhost:4310/api/briefing | lp -d Brother2460
```

and to check a job went through, `lpq` / `lpstat -W completed -o`.

A `-m everywhere` driverless queue is worth preferring: it asks the printer for
its own capabilities, so the page is not silently rescaled or sent in the wrong
size. If pages come out shrunken or clipped, the queue has the wrong paper size
— compare `lpoptions -p Brother2460 -l` against the PDF's `Page size` from
`pdfinfo`.

### What is *not* automatic yet

There is no scheduler entry for printing. `apps/server/src/jobs.ts` runs the
weather refresh and the Garmin sync on a timer; auto-print would be a third
entry there (`briefing.generate` → write temp file → `lp`). That was
deliberately left out until the page had been printed by hand for a while —
the layout is still moving, and a daily job printing a page you have not
reviewed is a bad way to find that out.

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
- **Garmin sync fails with "not authenticated" / no Sync button.** No token
  store was found for the service user. Re-run the login in §9 (as user
  `pi`), set `Environment=GARMINTOKENSTORE` to its absolute path, and
  restart. `curl -s http://localhost:4310/api/integrations` should report
  `connected:true`.
- **The briefing prints as JSON, or `pnpm briefing` says `briefing failed: 500`.**
  The route returns the worker's error text in the JSON body, so `curl -s
  http://localhost:4310/api/briefing | head -c 400` names the cause. The two
  usual ones are a missing `uv sync --project workers/briefing` (no WeasyPrint)
  and missing pango system libraries — see
  [§10](#10-printing-the-daily-briefing).
- **Page shows old UI after an update.** The dev-machine build+rsync step
  (#6) was skipped, or the browser cached `index.html` — hard refresh.
- **Git over SSH warns about a changed host key.** Your Pi's
  `~/.ssh/known_hosts` doesn't pin GitHub's IP range; it's a one-time
  prompt after GitHub rotates keys.
- **Scheduling windows look wrong.** The solver computes 07:00–23:00 slots
  in `America/New_York`; keep the Pi's clock sane (`timedatectl`, NTP is on
  by default) even though the TZ itself doesn't change the solver's fixed
  zone.
