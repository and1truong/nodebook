.PHONY: dev dev\:web dev\:worker db\:migrate free-ports setup

PORTS ?= 5173 8787

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

# One-time setup: create .dev.vars from the example if missing.
setup:
	@test -f .dev.vars || cp .dev.vars.example .dev.vars
	@echo ".dev.vars ready"
