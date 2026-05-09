import path from 'node:path';

export function loadConfig(env = process.env) {
  const demoMode = bool(env.DEMO_MODE, false);
  const readOnly = bool(env.READ_ONLY, false);
  const config = {
    port: number(env.PORT, 3117),
    appTitle: env.APP_TITLE || 'BucketLens',
    demoMode,
    bucket: env.S3_BUCKET || (demoMode ? 'demo-bucket' : ''),
    rootPrefix: cleanPrefix(env.S3_PREFIX || ''),
    publicBaseUrl: stripSlash(env.PUBLIC_BASE_URL || ''),
    cacheDir: env.CACHE_DIR || path.join(process.cwd(), '.cache'),
    maxUploadBytes: number(env.MAX_UPLOAD_BYTES, 20 * 1024 * 1024 * 1024),
    appToken: env.APP_TOKEN || '',
    readOnly,
    allowUpload: !readOnly && bool(env.ALLOW_UPLOAD, true),
    allowDelete: !readOnly && bool(env.ALLOW_DELETE, false),
    allowFolderCreate: !readOnly && bool(env.ALLOW_FOLDER_CREATE, true),
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || 'auto',
      forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, true),
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  };
  if (!demoMode) {
    requireValue('S3_BUCKET', config.bucket);
    requireValue('S3_ACCESS_KEY_ID', config.s3.accessKeyId);
    requireValue('S3_SECRET_ACCESS_KEY', config.s3.secretAccessKey);
  }
  return config;
}

export function publicConfig(config) {
  return {
    title: config.appTitle,
    prefix: config.rootPrefix,
    publicBaseUrl: config.publicBaseUrl,
    maxUploadBytes: config.maxUploadBytes,
    demoMode: config.demoMode,
    readOnly: config.readOnly,
    allowUpload: config.allowUpload,
    allowDelete: config.allowDelete,
    allowFolderCreate: config.allowFolderCreate,
  };
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
export function number(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
export function requireValue(name, value) {
  if (!value || value === '[REDACTED]' || String(value).includes('<')) throw new Error(`Missing ${name}`);
}
export function cleanPrefix(s) { return String(s || '').replace(/^\/+|\/+$/g, '').replace(/\.\./g, '').replace(/\/+/g, '/').trim(); }
export function cleanKey(s) { return String(s || '').replace(/^\/+/, '').replace(/\.\./g, '').replace(/\/+/g, '/').trim(); }
export function cleanFolderName(s) { return String(s || '').replace(/[\\/]+/g, '-').replace(/\.\./g, '').trim().replace(/^\.+/, ''); }
export function stripSlash(s) { return String(s || '').replace(/\/+$/g, ''); }
export function joinKey(...parts) { return parts.map(cleanPrefix).filter(Boolean).join('/'); }
export function basename(s) { return String(s).split('/').filter(Boolean).pop() || String(s); }
export function encodePath(rel) { return String(rel).split('/').map(encodeURIComponent).join('/'); }
export function publicUrl(config, rel) { return config.publicBaseUrl ? `${config.publicBaseUrl}/${encodePath(rel)}` : ''; }
export function markdown(config, rel, format = 'markdown') {
  const url = publicUrl(config, rel);
  if (format === 'html-video') return `<video controls src="${url}"></video>`;
  if (format === 'html-image') return `<img src="${url}" alt="" />`;
  return `![](${url})`;
}
export function fullKey(config, rel) { return joinKey(config.rootPrefix, cleanKey(rel)); }
export function stripRoot(config, key) { return config.rootPrefix && key.startsWith(`${config.rootPrefix}/`) ? key.slice(config.rootPrefix.length + 1) : key; }
export function breadcrumbs(prefix) { const out = [{ name: 'Assets', prefix: '' }]; let cur = ''; for (const part of cleanPrefix(prefix).split('/').filter(Boolean)) { cur = joinKey(cur, part); out.push({ name: part, prefix: cur }); } return out; }
