# R2 Media Browser

A visually polished, Dokploy-ready media browser/uploader for Cloudflare R2 or any S3-compatible object storage.

Built for Obsidian/media workflows:

- folder browsing by prefix
- big drag/drop upload screen
- image thumbnails
- video thumbnails and inline playback
- copy public URL
- copy Obsidian Markdown embed
- delete objects
- S3/R2 compatible

## Environment

Copy `.env.example` to `.env` locally or paste equivalent variables into Dokploy.

```bash
cp .env.example .env
```

Required secrets must be supplied via environment, not committed.

## Local run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3117
```

## Docker

```bash
docker build -t r2-media-browser .
docker run --env-file .env -p 3117:3117 r2-media-browser
```

## Dokploy

Use `docker-compose.yml` as the paste-in compose. Set secrets in Dokploy environment variables.

Do not expose this publicly without auth/network controls. Recommended first deployment: Tailscale-only or behind Dokploy auth/basic auth.
