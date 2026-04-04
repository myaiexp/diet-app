# Diet App

> AI-driven meal planning app with pantry tracking, shopping lists, and nutrition management.

## Key Patterns

- **Central-hub conventions**: ESM, `.js` imports, UUID PKs, timezone timestamps
- **API**: Each route module exports `(db: Db) => Hono`, mounted in app.ts
- **Deployment**: Forgejo git hooks (push to deploy), systemd service on VPS
- **Public URL**: `https://mase.fi/diet/api/` (nginx proxy on VPS, port 3300)
- Core concepts: spoilage-first pantry, AI meal planning, constraint satisfaction, auto-deduct cooking
