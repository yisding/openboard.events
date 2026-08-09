# Admin bootstrap

Use the one-shot bootstrap after migrations and after creating the first event. It creates or updates the planned organizer and reviewer accounts, hashes both passwords through the runtime PBKDF2 implementation, and assigns real event memberships.

```bash
export DATABASE_URL='postgresql://...'
export BOOTSTRAP_EVENT_ID='00000000-0000-4000-8000-000000000001'
export BOOTSTRAP_ADMIN_PASSWORD='replace-with-a-long-random-password'
export BOOTSTRAP_REVIEWER_PASSWORD='replace-with-another-long-random-password'
pnpm admin:bootstrap
```

The command is idempotent for `organizer@openboard.dev` and `reviewer@openboard.dev`. Re-running it rotates their password hashes and restores the owner/reviewer roles for the selected event. Passwords are read only from the environment and are never printed or committed.
