# Mind Palace

Mind Palace is a single-owner task manager and weekly scheduler. Everything schedulable is a task: actionable work, calendar commitments, recurring routines, and sleep. Stable tags add behavior without creating parallel work-item models.

## V0 Capabilities

- Simple system-font kanban with card hover feedback, cross-column movement, and within-column rank ordering.
- Fuzzy tag selection, inline tag creation, and a collapsible multi-parent hierarchy view.
- Optional time estimates; tasks without estimates stay out of automatic scheduling until estimated.
- Editable task details with Markdown descriptions.
- Seven-day calendar grid with date navigation, fixed and planned blocks, and muted elapsed time.
- Numeric priority with drag rank as the tie-breaker.
- Multi-parent tag DAG with cycle prevention.
- Reserved modular tags: `calendar_event` and `routine`.
- Thirty-minute CP-SAT scheduling through a separate Python worker.
- Per-task schedule acceptance; accepted blocks are immutable.
- Routine templates and independently completable child occurrences.
- Google Calendar normalization into tagged tasks through an import endpoint.
- Garmin activity and sleep normalization into permanent health observations.
- Boston hourly weather cached for eight hours from the National Weather Service.

V0 has no application accounts or login. Each owner runs an independent instance. Bind the server only to localhost or a controlled Tailscale interface.

## Requirements

- Node.js 24+
- pnpm 10+
- Python 3.11+
- `uv`

## Start

```sh
pnpm install
uv sync --project workers/cp-sat
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:4311` in development. Vite proxies API calls to the server on port `4310`.

For the production build:

```sh
pnpm build
pnpm start
```

## Raspberry Pi Deployment

A 64-bit Raspberry Pi OS (aarch64) can run the control plane as a headless single-owner instance, reachable over Tailscale. The web bundle is static, so it can be built on a desktop and copied over — this keeps the build toolchain (and SD-card wear) off the Pi.

### Toolchain

Raspberry Pi OS ships no Node, and `node:sqlite` requires Node 22.5+. Install a current Node via nvm:

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 26
```

Enable pnpm through corepack; inside the repo it resolves the version pinned by `packageManager`:

```sh
corepack enable
```

> Corepack versions before ~0.30 crash with `Cannot find matching keyid`. If you hit that, use the standalone installer instead (`curl -fsSL https://get.pnpm.io/install.sh | PNPM_VERSION=10.15.1 sh -`), which also honors the `packageManager` pin.

uv supplies the Python version the scheduler needs (the Pi's system Python is usually below the `>=3.11` requirement in `workers/cp-sat`):

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Install and run

```sh
cd ~/mind-palace
pnpm install
uv sync --project workers/cp-sat

# Point at an existing database if it isn't in data/ (the repo default):
export DATABASE_PATH=/home/emchap4/mind-palace/mind-palace.db
pnpm db:migrate

# Option A: build on the Pi (a 1 GB Pi needs its ~2 GB swap active)
pnpm --filter @mind-palace/web build

# Option B (recommended): build on a desktop from the same commit, copy the bundle
#   git worktree add /tmp/mind-palace-build main
#   cd /tmp/mind-palace-build && pnpm install && pnpm --filter @mind-palace/web build
#   rsync -az /tmp/mind-palace-build/apps/web/dist/ emchap4@rpi.local:~/mind-palace/apps/web/dist/

HOST=0.0.0.0 DATABASE_PATH=/home/emchap4/mind-palace/mind-palace.db pnpm start
```

`nohup` does not survive reboots; run the server under systemd instead. Adjust the user and absolute paths to your Pi (`which node` / `which pnpm` reveal them):

```ini
[Unit]
Description=Mind Palace
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=emchap4
WorkingDirectory=/home/emchap4/mind-palace
Environment=PATH=/home/emchap4/.nvm/versions/node/v26.9.0/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOST=0.0.0.0
Environment=PORT=4310
Environment=DATABASE_PATH=/home/emchap4/mind-palace/mind-palace.db
ExecStart=/home/emchap4/.local/share/pnpm/bin/pnpm --filter @mind-palace/server start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo cp mind-palace.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mind-palace
```

### Tailscale

A reboot can leave the node logged out even though `tailscaled` is running, silently dropping the Pi from the tailnet. Re-login and visit the printed URL:

```sh
sudo tailscale up
# To authenticate, visit: https://login.tailscale.com/a/<code>
sudo tailscale status
```

The instance is then reachable from your other devices at `http://<pi-tailnet-ip>:4310`. Keep it off the public internet; the server has no accounts.

## Architecture

```text
React web UI
     |
TypeScript/Hono control plane
     |
SQLite in WAL mode
     |
     +-- Python CP-SAT process
     +-- NWS weather adapter
     +-- normalized calendar/Garmin imports
```

Only the TypeScript control plane writes SQLite. The CP-SAT worker accepts JSON through standard input and returns JSON through standard output.

## Packages

- `apps/server`: HTTP API and service boundaries. See `apps/server/README.md` and `apps/server/src/services/README.md`.
- `apps/web`: React kanban, task detail, and schedule UI. See `apps/web/README.md`.
- `packages/database`: migrations and repositories. See `packages/database/README.md`.
- `packages/shared`: shared TypeScript API contracts.
- `workers/cp-sat`: Python OR-Tools worker. See `workers/cp-sat/README.md`.

## Integration State

Weather fetching and CP-SAT scheduling are operational. Google Calendar and Garmin use normalized import endpoints in v0, allowing provider-specific OAuth and polling to be added without changing the domain model. Raw provider payloads are not retained.

## Configuration

`DATABASE_PATH` controls the SQLite location and `HOST` can expose the control plane on a Tailscale interface; set them in the environment as needed. Do not expose this unauthenticated v0 server to the public internet.

## Data Retention

- Tasks, blocks, health observations, and schedule runs: indefinite.
- Raw calendar payloads: not stored.
- Weather: eight-hour cache.
- Solver snapshots: intended 90-day retention; automated cleanup is deferred until enough data exists to validate the policy.