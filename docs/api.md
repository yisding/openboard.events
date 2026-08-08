# Openboard API

Public, cached endpoints:

- `GET /api/v1/events/ai-engineer`
- `GET /api/v1/events/ai-engineer/schedule`
- `GET /api/v1/events/ai-engineer/speakers`

Keyed endpoints require `Authorization: Bearer <OPENBOARD_API_KEY>`. The example local configuration uses `demo-api-key`:

- `GET /api/v1/events/ai-engineer/stats`
- `GET /api/v1/events/ai-engineer/submissions`

Responses use `{ "data": ..., "meta"?: ... }`. Errors use `{ "error": { "code", "message" } }`. Public endpoints send permissive CORS and `s-maxage=60` cache headers.
