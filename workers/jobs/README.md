# Jobs Worker

`sb-jobs` is a deliberately small scheduled dispatcher. It receives only `APP_BASE_URL` and `CRON_SECRET` and POSTs to the matching web Worker.

| Wrangler environment | Worker | Web target |
|---|---|---|
| local | `sb-jobs-local` | `http://localhost:3000` |
| preview | `sb-jobs-preview` | exact `sb-web-preview` origin supplied during deploy |
| production | `sb-jobs` | exact `sb-web` origin supplied during deploy |

One cron runs every minute. `outbox` runs each tick, `reminders` at minutes divisible by 15, Airtable at minutes ending in 5, and cleanup at 09:00 UTC. A missed tick self-heals on the next one because every real job must be an idempotent bounded database scan.

Local scheduled test:

```bash
pnpm dev:jobs
curl 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
```

Deployed route proof (never paste the real secret into this file):

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" "$APP_BASE_URL/api/jobs/outbox"
curl -i -X POST "$APP_BASE_URL/api/jobs/outbox" # must return 401
```

Deploy web first, then run `pnpm deploy:jobs:preview` or `pnpm deploy:jobs:production`. Confirm at least three consecutive ticks in Workers Logs.
