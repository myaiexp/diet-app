# Database Password Rotation

Runbook for rotating the `dietapp` Postgres role password.

## Where `.env` lives

All secrets live in a gitignored `.env` (`chmod 600`, owned by the run user) —
never committed; `.env.example` holds placeholders only. Prod is the main
checkout on the VPS: `diet-app-api.service` runs as `User=mase`,
`WorkingDirectory=/home/mase/Projects/diet-app`, with
`EnvironmentFile=/home/mase/Projects/diet-app/.env`. Each Helm worktree keeps
its own gitignored `.env` copy for dev — rotation must update all of them.

## Procedure

1. As a Postgres superuser (e.g. `mase`, via peer auth), rotate the role
   password:
   ```sql
   ALTER ROLE dietapp PASSWORD '<new>';
   ```
   Generate the new password URL-safe (e.g. `openssl rand -hex 24`) so it
   needs no escaping in the connection URL.
2. Update `DATABASE_URL` in the main-checkout `.env` **and every active
   worktree `.env`** (keep each `chmod 600`).
3. Restart the API service: `sudo systemctl restart diet-app-api.service`.
4. Verify:
   - New password connects over TCP.
   - Old password is rejected.
   - `/api/health` returns ok.
