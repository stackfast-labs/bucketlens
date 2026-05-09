# Contributing

Thanks for helping improve BucketLens.

## Local setup

```bash
cp .env.example .env
DEMO_MODE=true S3_BUCKET=demo npm run dev
```

## Checks

```bash
npm run check
npm run docker:build
```

## Pull requests

- Keep provider-specific behavior configurable.
- Do not commit secrets or business-specific defaults.
- Prefer generic examples.
- Add tests for config/path/copy-format changes.
