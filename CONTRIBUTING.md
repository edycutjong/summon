# Contributing to summon

Thanks for your interest in contributing! **summon** is part of the
[CROO Constellation](https://github.com/edycutjong/croo-core) — a suite of
specialized on-chain agents built on the CROO A2A network.

## Getting Started

1. Fork the repository and clone your fork.
2. Enter the directory: `cd summon`
3. Install dependencies: `npm install`
4. Copy the environment template: `cp .env.example .env.local`
   (or set `CROO_MOCK=true` to run fully offline — no wallet or USDC needed).
5. Run the test suite: `npm test`

## Development Workflow

- Create a feature branch off `main`: `git checkout -b feat/my-change`
- Keep changes focused and small; one logical change per pull request.
- Follow the existing code style. Run `npm run lint` and `npm run typecheck`
  (where available) before opening a PR.
- Add or update tests for any behavior you change. All tests must pass:
  `npm test`.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add pricing confidence threshold
fix: handle empty comparables set
docs: clarify mock-mode setup
```

## Pull Requests

- Ensure CI is green (build, tests, lint, CodeQL).
- Describe **what** changed and **why** in the PR body.
- Link any related issues.
- Do not commit secrets. `.env.local` is gitignored — keep it that way.

## Reporting Bugs & Requesting Features

Open an issue using the provided templates. For security vulnerabilities, please
follow [SECURITY.md](./SECURITY.md) instead of filing a public issue.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it.
