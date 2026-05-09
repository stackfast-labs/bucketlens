# Configuration

BucketLens is configured through environment variables. See `.env.example` for the complete list.

## Storage

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_FORCE_PATH_STYLE`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `S3_PREFIX`
- `PUBLIC_BASE_URL`

## Safety

- `READ_ONLY`
- `ALLOW_UPLOAD`
- `ALLOW_DELETE`
- `ALLOW_FOLDER_CREATE`
- `APP_TOKEN`

BucketLens has no built-in auth by default. Run it behind Tailscale, Cloudflare Zero Trust Access, or another trusted access layer.
