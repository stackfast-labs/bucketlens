# Dokploy deployment

Use the repository `docker-compose.yml` in Dokploy.

Set secrets in Dokploy environment variables, not in Git.

Recommended exposure:

- Tailscale-only, or
- Cloudflare Zero Trust Access in front of the app.

BucketLens has no built-in authentication by default.
