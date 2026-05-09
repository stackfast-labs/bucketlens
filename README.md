# BucketLens

**A media-first browser for R2 and S3-compatible buckets.**

BucketLens is a self-hosted media console built for the simplicity of Cloudflare R2 and compatible with S3-compatible storage: AWS S3, MinIO, Wasabi, Backblaze B2, DigitalOcean Spaces, and more.

Use it to browse bucket folders, drag-drop large media, preview images and videos, generate thumbnails, copy public URLs or Markdown embeds, and manage assets from a polished web UI, CLI, or MCP server.

BucketLens is also a practical media management layer for AI agent stacks. Agents such as **Hermes** or **OpenClaw** can use the CLI or MCP server to upload generated images/videos, organize outputs into bucket prefixes, retrieve shareable URLs, and produce Markdown embeds for notes, reports, websites, or campaign docs without giving every workflow a bespoke asset pipeline.

## Features

- Folder/prefix browsing for S3-compatible buckets
- Big drag/drop upload screen
- Multipart uploads for large files
- Image thumbnails via Sharp
- Video thumbnails and playback via ffmpeg
- Expand preview modal with playback cleanup on close
- Copy public URL and Markdown embeds
- Copy fallback drawer for non-HTTPS/private-network browsers
- Folder creation using S3 prefix placeholders
- Optional delete, disabled by default in examples
- Read-only mode
- CLI: `bucketlens list/upload/mkdir/url/markdown/delete/serve`
- MCP server for AI agents
- Docker/Dokploy-ready

## Security model

BucketLens has **no built-in authentication by default**. This is intentional for a small self-hosted tool: put it behind infrastructure you already trust.

Recommended deployment:

- Tailscale / tailnet-only access
- Cloudflare Zero Trust Access
- reverse-proxy auth/OIDC/basic auth
- private LAN/VPN

Use scoped bucket credentials. Do not expose write/delete credentials to the public internet.

The optional `APP_TOKEN` is a lightweight guard, not production-grade identity/auth.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:3117
```

For a UI-only demo without storage credentials:

```bash
DEMO_MODE=true S3_BUCKET=demo npm run dev
```

## Configuration

Required for real storage:

```text
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=[REDACTED]
S3_SECRET_ACCESS_KEY=[REDACTED]
S3_BUCKET=my-media-bucket
PUBLIC_BASE_URL=https://assets.example.com
```

Optional safety flags:

```text
READ_ONLY=false
ALLOW_UPLOAD=true
ALLOW_DELETE=false
ALLOW_FOLDER_CREATE=true
```

`S3_PREFIX` scopes the app to a prefix. Leave it empty to browse the whole bucket.

## CLI

```bash
bucketlens config
bucketlens list [prefix]
bucketlens mkdir campaigns/spring-launch
bucketlens upload ./hero.jpg --prefix campaigns/spring-launch
bucketlens url campaigns/spring-launch/hero.jpg
bucketlens markdown campaigns/spring-launch/hero.jpg
bucketlens delete campaigns/spring-launch/hero.jpg --yes
bucketlens serve
bucketlens mcp
```

## MCP

BucketLens can be used by AI agents and automation frameworks as a shared media layer. For example, Hermes or OpenClaw can generate media locally, upload it through BucketLens, then copy back a stable public URL or Markdown embed for downstream publishing.

Run the stdio MCP server:

```bash
bucketlens mcp
```

Tools:

- `bucketlens_list_assets`
- `bucketlens_upload_asset`
- `bucketlens_create_folder`
- `bucketlens_delete_asset`
- `bucketlens_get_asset_url`
- `bucketlens_get_markdown_embed`

## Docker

```bash
docker build -t bucketlens .
docker run --env-file .env -p 3117:3117 bucketlens
```

## Dokploy

Use `docker-compose.yml` in Dokploy and set secrets in Dokploy environment variables. Do not put secrets in Git.

Recommended first deployment: Tailscale-only or behind Cloudflare Zero Trust Access.

## Development

```bash
npm run check
npm run docker:build
```

## License

MIT
