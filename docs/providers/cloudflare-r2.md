# Cloudflare R2

Use the R2 S3-compatible endpoint:

```text
https://<account-id>.r2.cloudflarestorage.com
```

Typical settings:

```text
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
```

Set `PUBLIC_BASE_URL` to your R2 custom public domain if you want copy buttons to emit public URLs.
