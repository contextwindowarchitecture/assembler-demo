---
id: api-rate-limits
title: API rate limits
tenant: acme
version: v6
freshness: 2026-09-15T08:00:00Z
---
API rate limits. Free workspaces may make 60 API requests per minute, Pro 600 and Enterprise 6000. Requests over the limit return HTTP 429 with a Retry-After header. Limits are per workspace, not per user.
