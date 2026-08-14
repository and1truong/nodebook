.PHONY: backup db\:migrate deploy dev dev\:web dev\:worker free-ports migrate setup

PORTS ?= 5173 8787
DEPLOY_URL ?= https://nodebook.v3knet.workers.dev
BACKUP_DIR ?= /tmp/nodebook-backups

# Kill whatever is already listening on the dev ports (5173, 8787) so a
# stale/crashed session never causes EADDRINUSE on startup.
free-ports:
	@for port in $(PORTS); do \
		pids=$$(lsof -ti :$$port 2>/dev/null || true); \
		if [ -n "$$pids" ]; then \
			echo "==> Port $$port in use, killing: $$pids"; \
			kill $$pids 2>/dev/null || true; \
		fi; \
	done
	@sleep 1

# Full dev environment: free the ports, apply local D1 migrations, then run
# the Worker (:8787) and the Vite dev server (:5173) together. The Vite proxy
# forwards /api and /mcp to the Worker, so use http://localhost:5173 in the
# browser.
dev: free-ports db\:migrate
	@trap 'kill 0' SIGINT SIGTERM EXIT; \
	npm run dev:worker & \
	npm run dev:web & \
	wait

# Vite dev server only (hot reload on :5173).
dev\:web: free-ports
	npm run dev:web

# Worker only (API + MCP + built UI on :8787).
dev\:worker: free-ports
	npm run dev:worker

# Apply D1 migrations to the local database.
db\:migrate:
	npm run db:migrate:local

# Capture a remote D1 Time Travel restore bookmark before a production change.
# `d1 export` cannot back up NodeBook because its FTS5 virtual tables are not
# exportable. This checkpoint is retained according to D1 Time Travel policy.
backup:
	@test -f wrangler.personal.jsonc || { echo "Missing wrangler.personal.jsonc" >&2; exit 1; }
	@mkdir -p "$(BACKUP_DIR)"
	@file="$(BACKUP_DIR)/nodebook-$$(date -u +%Y%m%dT%H%M%SZ).json"; \
	npx wrangler d1 time-travel info nodebook --config wrangler.personal.jsonc --json > "$$file"; \
	echo "D1 Time Travel bookmark saved to $$file"

# Snapshot, show pending migrations, and apply them to remote D1. Wrangler
# captures an additional D1 backup immediately before applying a migration.
migrate: backup
	npx wrangler d1 migrations list nodebook --remote --config wrangler.personal.jsonc
	npx wrangler d1 migrations apply nodebook --remote --config wrangler.personal.jsonc

# Build and deploy using the machine-local production bindings, then verify the
# health endpoint is reachable. Cloudflare Access returns 302 without a session.
deploy:
	@test -f wrangler.personal.jsonc || { echo "Missing wrangler.personal.jsonc" >&2; exit 1; }
	npm run build
	npx wrangler deploy --config wrangler.personal.jsonc
	@status=$$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-redirs 0 "$(DEPLOY_URL)/healthz"); \
	case "$$status" in \
		200|302) echo "Health check passed: $(DEPLOY_URL)/healthz ($$status)" ;; \
		*) echo "Health check failed: $(DEPLOY_URL)/healthz ($$status)" >&2; exit 1 ;; \
	esac

# One-time setup: create .dev.vars from the example if missing.
setup:
	@test -f .dev.vars || cp .dev.vars.example .dev.vars
	@echo ".dev.vars ready"
