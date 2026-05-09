# Security

BucketLens is a self-hosted media browser for object storage. It can upload and delete objects when configured to do so, so treat deployments as sensitive.

## Authentication

BucketLens has no built-in user/session authentication by default. Deploy it behind a trusted access layer:

- Tailscale / tailnet-only access
- Cloudflare Zero Trust Access
- reverse-proxy auth/OIDC/basic auth
- private LAN/VPN

`APP_TOKEN` is available as a lightweight guard for simple private deployments, but it is not a replacement for production-grade identity, SSO, or network access control.

## Credentials

Use scoped S3/R2 credentials with only the bucket/prefix permissions required.

Never commit:

- `.env`
- access key IDs or secret access keys
- bucket credentials
- production endpoints that should stay private

## Destructive operations

`ALLOW_DELETE=false` is the recommended default. Enable deletes only for trusted deployments.

Folder deletion deletes only the zero-byte folder placeholder object. S3 folders are prefixes, not real directories.

## Reporting vulnerabilities

Open a private security advisory or contact the StackFast maintainers. Do not publish working exploits against public deployments.
