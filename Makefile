.PHONY: help install dev build start test test-watch test-coverage lint lint-fix typecheck security-scan ci

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm install

dev: ## Run development server with watch mode
	npm run dev

build: ## Build the project (TypeScript to JS)
	npm run build

start: ## Run the built project
	npm run start

test: ## Run unit tests
	npm run test

test-watch: ## Run unit tests in watch mode
	npm run test:watch

test-coverage: ## Run unit tests with coverage report
	npm run test:coverage

lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint and automatically fix issues
	npm run lint:fix

typecheck: ## Run TypeScript compiler without emitting files to check types
	npm run typecheck

security-scan: ## Run security audits (npm audit + license check)
	@echo "=== NPM AUDIT ==="
	npm audit --audit-level=high || true
	@echo ""
	@echo "=== LICENSE CHECK ==="
	npx license-checker --production --failOn "GPL-3.0;AGPL-3.0" --summary || true

ci: ## Run the full CI/CD verification pipeline locally
	npm run ci
