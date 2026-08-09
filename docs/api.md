# Openboard API

Public, cached endpoints:

- `GET /api/v1/events/ai-engineer`
- `GET /api/v1/events/ai-engineer/schedule`
- `GET /api/v1/events/ai-engineer/speakers`

Private endpoints are deliberately unavailable and return `503 FEATURE_UNAVAILABLE` until M40 lands database-backed, hashed, per-event API keys:

- `GET /api/v1/events/ai-engineer/stats`
- `GET /api/v1/events/ai-engineer/submissions`

There is no global environment API key. That shortcut could not enforce event scope and is unsafe even for a demo.

Responses use `{ "data": ..., "meta"?: ... }`. Errors use `{ "error": { "code", "message" } }`. Public endpoints send permissive CORS and `s-maxage=60` cache headers.
