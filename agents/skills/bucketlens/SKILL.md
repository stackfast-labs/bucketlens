---
name: bucketlens
description: Browse, upload, preview, and manage media in R2/S3-compatible buckets with BucketLens web, CLI, and MCP.
---

# BucketLens

Use BucketLens when working with media assets in Cloudflare R2 or S3-compatible buckets.

## Safety

- Never print secrets.
- BucketLens has no built-in auth by default; expect Tailscale, Cloudflare Zero Trust, or reverse-proxy access control.
- Prefer read-only unless upload/delete is explicitly needed.
- Delete requires confirmation and must respect `ALLOW_DELETE`.

## CLI

```bash
bucketlens list [prefix]
bucketlens upload <file...> --prefix <prefix>
bucketlens mkdir <prefix>
bucketlens url <key>
bucketlens markdown <key>
bucketlens delete <key> --yes
```

## MCP

```bash
bucketlens mcp
```

Use MCP tools for agent workflows: list, upload, create folder, delete, get URL, get Markdown embed.
