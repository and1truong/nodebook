.PHONY: dev dev\:web dev\:worker db\:migrate deploy free-ports setup

PORTS ?= 5173 8787
DEPLOY_URL ?= https://nodebook.v3knet.workers.dev

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

# Build and deploy using the machine-local production bindings, then verify the
# health endpoint is reachable. Cloudflare Access returns 302 without a session.
# Apply remote D1 migrations separately (after a backup) when a schema migration is pending.
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
