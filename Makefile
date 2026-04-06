# Todo Manager — Development Makefile
# Usage: make help

# Supabase config
PROJECT_ID   := urkytivapfgzenpvflce
SUPABASE_URL := https://$(PROJECT_ID).supabase.co
FUNC_URL     := $(SUPABASE_URL)/functions/v1/api-proxy

.PHONY: help serve deploy deploy-fn db-push db-reset db-diff link status test-api clean

# ─────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ─────────────────────────────────────────────────
# Local Development
# ─────────────────────────────────────────────────

serve: ## Start local dev server (python http.server on port 8000)
	python3 -m http.server 8000

serve-fn: ## Start Supabase Edge Functions locally
	supabase functions serve api-proxy --no-verify-jwt

# ─────────────────────────────────────────────────
# Deployment
# ─────────────────────────────────────────────────

deploy: deploy-fn ## Deploy all (Edge Functions)

deploy-fn: ## Deploy api-proxy Edge Function to Supabase
	supabase functions deploy api-proxy --project-ref $(PROJECT_ID)

# ─────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────

link: ## Link to Supabase remote project
	supabase link --project-ref $(PROJECT_ID)

db-push: ## Push local migrations to remote database
	supabase db push

db-reset: ## Reset local database (drops all data)
	supabase db reset

db-diff: ## Generate migration from remote schema diff
	supabase db diff --use-migra -f $(name)

db-schema: ## Apply full schema to remote DB (via psql)
	@echo "Run this SQL in Supabase SQL Editor:"
	@echo "  docs/full-schema.sql"
	@echo ""
	@echo "Or individual schemas:"
	@echo "  docs/api-token-schema.sql"
	@echo "  docs/profiles-schema.sql"
	@echo "  docs/shared-calendar-schema.sql"

# ─────────────────────────────────────────────────
# API Testing
# ─────────────────────────────────────────────────

test-api: ## Test API endpoints (set TOKEN env var first)
	@if [ -z "$(TOKEN)" ]; then \
		echo "Usage: make test-api TOKEN=mtsk_your_token_here"; \
		exit 1; \
	fi
	@echo "=== List tasks ==="
	@curl -s -X POST $(FUNC_URL) \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '{"action":"list","limit":3}' | python3 -m json.tool
	@echo ""
	@echo "=== Create task ==="
	@curl -s -X POST $(FUNC_URL) \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '{"action":"create","text":"Test from Makefile","category":"work"}' | python3 -m json.tool
	@echo ""
	@echo "=== Test invalid token ==="
	@curl -s -w "\nHTTP Status: %{http_code}\n" -X POST $(FUNC_URL) \
		-H "Authorization: Bearer mtsk_invalid" \
		-H "Content-Type: application/json" \
		-d '{"action":"list"}'

test-create: ## Create a task via API (set TOKEN and TEXT)
	@if [ -z "$(TOKEN)" ] || [ -z "$(TEXT)" ]; then \
		echo "Usage: make test-create TOKEN=mtsk_xxx TEXT=\"Buy milk\""; \
		exit 1; \
	fi
	@curl -s -X POST $(FUNC_URL) \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '{"action":"create","text":"$(TEXT)"}' | python3 -m json.tool

# ─────────────────────────────────────────────────
# Status & Info
# ─────────────────────────────────────────────────

status: ## Show project status
	@echo "Project: Todo Manager"
	@echo "Supabase URL: $(SUPABASE_URL)"
	@echo "API Endpoint: $(FUNC_URL)"
	@echo ""
	@echo "Files:"
	@wc -l index.html style.css script.js auth.js db.js detail-panel.js shared.js 2>/dev/null || true
	@echo ""
	@echo "Edge Functions:"
	@wc -l supabase/functions/api-proxy/index.ts 2>/dev/null || true

clean: ## Remove generated/temp files
	@find . -name ".DS_Store" -delete 2>/dev/null || true
	@find . -name "*.swp" -delete 2>/dev/null || true
	@echo "Cleaned."
