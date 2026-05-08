import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import express from 'express';
import Busboy from 'busboy';
import mime from 'mime-types';
import sharp from 'sharp';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PORT = Number(process.env.PORT || 3117);
const APP_TITLE = process.env.APP_TITLE || 'R2 Media Browser';
const BUCKET = required('S3_BUCKET');
const ROOT_PREFIX = cleanPrefix(process.env.S3_PREFIX || '');
const PUBLIC_BASE_URL = stripSlash(process.env.PUBLIC_BASE_URL || '');
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), '.cache');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024 * 1024);
const APP_TOKEN = process.env.APP_TOKEN || '';
const DEMO_MODE = String(process.env.DEMO_MODE || 'false') === 'true';

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
  credentials: {
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
});

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  if (!APP_TOKEN) return next();
  const token = req.get('x-r2-browser-token') || req.query.token;
  if (token === APP_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized' });
});
app.use(express.static(path.join(process.cwd(), 'public'), { extensions: ['html'] }));

app.get('/api/health', (_req, res) => res.json({ ok: true, title: APP_TITLE }));
app.get('/api/config', (_req, res) => {
  res.json({ title: APP_TITLE, prefix: ROOT_PREFIX, publicBaseUrl: PUBLIC_BASE_URL, maxUploadBytes: MAX_UPLOAD_BYTES, demoMode: DEMO_MODE });
});

app.get('/api/list', async (req, res, next) => {
  try {
    const folder = cleanPrefix(String(req.query.prefix || ''));
    if (DEMO_MODE) return res.json(demoList(folder));
    const prefix = joinKey(ROOT_PREFIX, folder);
    const delimiter = '/';
    const folders = new Map();
    const files = [];
    let token;
    do {
      const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix ? `${prefix}/` : '', Delimiter: delimiter, ContinuationToken: token, MaxKeys: 1000 }));
      for (const cp of out.CommonPrefixes || []) {
        const full = cp.Prefix?.replace(/\/$/, '') || '';
        const rel = stripRoot(full);
        folders.set(rel, { type: 'folder', key: full, name: basename(rel), prefix: rel });
      }
      for (const obj of out.Contents || []) {
        if (!obj.Key || obj.Key.endsWith('/')) continue;
        const rel = stripRoot(obj.Key);
        files.push(objectToItem(obj, rel));
      }
      token = out.NextContinuationToken;
    } while (token);
    res.json({ prefix: folder, breadcrumbs: breadcrumbs(folder), folders: [...folders.values()].sort(byName), files: files.sort(byName) });
  } catch (err) { next(err); }
});

app.get('/api/object-url', async (req, res, next) => {
  try {
    const rel = cleanKey(String(req.query.key || ''));
    if (DEMO_MODE) return res.json({ key: rel, url: publicUrl(rel), signedUrl: demoMediaUrl(rel) });
    const key = fullKey(rel);
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 900 });
    res.json({ key: stripRoot(key), url: publicUrl(stripRoot(key)), signedUrl });
  } catch (err) { next(err); }
});

app.get('/api/thumbnail', async (req, res, next) => {
  try {
    const rel = cleanKey(String(req.query.key || ''));
    if (DEMO_MODE) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.type('image/svg+xml');
      return res.send(demoThumbSvg(rel));
    }
    const key = fullKey(rel);
    const kind = mediaKind(rel);
    const cachePath = await thumbnailPath(rel, kind);
    if (!fss.existsSync(cachePath)) {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      if (kind === 'image') await makeImageThumb(key, cachePath);
      else if (kind === 'video') await makeVideoThumb(key, cachePath);
      else return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('image/jpeg');
    fss.createReadStream(cachePath).pipe(res);
  } catch (err) { next(err); }
});


app.post('/api/folder', async (req, res, next) => {
  try {
    const parent = cleanPrefix(String(req.body?.prefix || ''));
    const name = cleanFolderName(String(req.body?.name || ''));
    if (!name) return res.status(400).json({ error: 'Missing folder name' });
    const rel = joinKey(parent, name);
    const key = `${fullKey(rel)}/`;
    if (DEMO_MODE) return res.json({ ok: true, key: `${rel}/`, prefix: rel, demoMode: true });
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: '', ContentType: 'application/x-directory' }));
    res.json({ ok: true, key: `${rel}/`, prefix: rel });
  } catch (err) { next(err); }
});

app.post('/api/upload', (req, res, next) => {
  if (DEMO_MODE) {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_BYTES, files: 200 } });
    const uploaded = [];
    bb.on('file', (_field, file, info) => {
      const filename = safeName(info.filename || 'upload.bin');
      const rel = cleanKey(joinKey(String(req.query.prefix || ''), filename));
      uploaded.push({ name: filename, key: rel, url: publicUrl(rel), markdown: obsidianMarkdown(rel) });
      file.resume();
    });
    bb.on('error', next);
    bb.on('close', () => res.json({ uploaded, errors: [], demoMode: true }));
    return req.pipe(bb);
  }
  const folder = cleanPrefix(String(req.query.prefix || ''));
  const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_BYTES, files: 200 } });
  const uploads = [];
  const errors = [];
  bb.on('file', (_field, file, info) => {
    const filename = safeName(info.filename || 'upload.bin');
    const rel = cleanKey(joinKey(folder, filename));
    const key = fullKey(rel);
    const contentType = info.mimeType || mime.lookup(filename) || 'application/octet-stream';
    const upload = new Upload({
      client: s3,
      params: { Bucket: BUCKET, Key: key, Body: file, ContentType: contentType },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
      leavePartsOnError: false,
    }).done().then(() => ({ name: filename, key: rel, url: publicUrl(rel), markdown: obsidianMarkdown(rel) })).catch(err => {
      errors.push({ name: filename, error: err.message });
      file.resume();
    });
    uploads.push(upload);
  });
  bb.on('error', next);
  bb.on('close', async () => {
    try {
      const uploaded = (await Promise.all(uploads)).filter(Boolean);
      res.status(errors.length ? 207 : 200).json({ uploaded, errors });
    } catch (err) { next(err); }
  });
  req.pipe(bb);
});

app.delete('/api/object', async (req, res, next) => {
  try {
    const rel = cleanKey(String(req.body.key || ''));
    if (!rel) return res.status(400).json({ error: 'Missing key' });
    if (DEMO_MODE) return res.json({ ok: true, key: rel, demoMode: true });
    const key = rel.endsWith('/') ? `${fullKey(rel.replace(/\/+$/g, ''))}/` : fullKey(rel);
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!rel.endsWith('/')) await deleteThumbs(rel);
    res.json({ ok: true, key: rel });
  } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, () => console.log(`${APP_TITLE} listening on :${PORT}`));

function required(name) { const v = process.env[name]; if (!v || v === '[REDACTED]') throw new Error(`Missing ${name}`); return v; }
function cleanPrefix(s) { return String(s || '').replace(/^\/+|\/+$/g, '').replace(/\.\./g, '').trim(); }
function cleanKey(s) { return String(s || '').replace(/^\/+/, '').replace(/\.\./g, '').trim(); }
function cleanFolderName(s) { return String(s || '').replace(/[\\/]+/g, '-').replace(/\.\./g, '').trim().replace(/^\.+/, ''); }
function stripSlash(s) { return String(s || '').replace(/\/+$/g, ''); }
function joinKey(...parts) { return parts.map(cleanPrefix).filter(Boolean).join('/'); }
function fullKey(rel) { return joinKey(ROOT_PREFIX, cleanKey(rel)); }
function stripRoot(key) { return ROOT_PREFIX && key.startsWith(`${ROOT_PREFIX}/`) ? key.slice(ROOT_PREFIX.length + 1) : key; }
function basename(s) { return s.split('/').filter(Boolean).pop() || s; }
function byName(a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); }
function publicUrl(rel) { return PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/${encodePath(rel)}` : ''; }
function encodePath(rel) { return rel.split('/').map(encodeURIComponent).join('/'); }
function obsidianMarkdown(rel) { return `![](${publicUrl(rel)})`; }
function safeName(name) { return name.replace(/[\\]/g, '/').split('/').filter(Boolean).pop()?.replace(/^\.+/, '') || 'upload.bin'; }
function breadcrumbs(prefix) { const out = [{ name: 'Assets', prefix: '' }]; let cur = ''; for (const part of cleanPrefix(prefix).split('/').filter(Boolean)) { cur = joinKey(cur, part); out.push({ name: part, prefix: cur }); } return out; }
function mediaKind(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (['.jpg','.jpeg','.png','.webp','.gif','.avif','.tif','.tiff'].includes(ext)) return 'image';
  if (['.mp4','.mov','.m4v','.webm','.avi','.mkv'].includes(ext)) return 'video';
  if (['.mp3','.wav','.m4a','.aac','.flac','.ogg'].includes(ext)) return 'audio';
  if (['.pdf'].includes(ext)) return 'doc';
  return 'file';
}
function objectToItem(obj, rel) {
  const kind = mediaKind(rel);
  const url = publicUrl(rel);
  return { type: 'file', kind, key: rel, name: basename(rel), size: obj.Size || 0, modified: obj.LastModified, contentType: mime.lookup(rel) || '', url, markdown: obsidianMarkdown(rel), thumbnail: ['image','video'].includes(kind) ? `/api/thumbnail?key=${encodeURIComponent(rel)}` : '' };
}
async function thumbnailPath(rel, kind) {
  const h = crypto.createHash('sha1').update(`${kind}:${rel}`).digest('hex');
  return path.join(CACHE_DIR, 'thumbs', `${h}.jpg`);
}
async function makeImageThumb(key, out) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(obj.Body, sharp().rotate().resize(520, 360, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }), fss.createWriteStream(out));
}
async function makeVideoThumb(key, out) {
  const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 900 });
  const tmp = path.join(os.tmpdir(), `${crypto.randomUUID()}.jpg`);
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner','-loglevel','error','-ss','00:00:01','-i', signedUrl, '-frames:v','1','-vf','scale=520:-1', '-q:v','3', tmp]);
    ff.on('error', reject);
    ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
  await sharp(tmp).resize(520, 360, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(out);
  await fs.rm(tmp, { force: true });
}
async function deleteThumbs(rel) {
  for (const kind of ['image','video']) {
    const p = await thumbnailPath(rel, kind);
    await fs.rm(p, { force: true });
  }
}

function demoList(prefix) {
  const samples = [
    { key: 'lux-living-meta/ret-meta-v5-strapi-gallery/RET-META-01_ShortlistWaiting_v5_strapi_4x5.png', size: 1849200, kind: 'image' },
    { key: 'lux-living-meta/ret-meta-v5-strapi-gallery/RET-META-02_Carousel_Checks_01.png', size: 2110300, kind: 'image' },
    { key: 'lux-living-meta/video/downsizer-quiz-walkthrough.mp4', size: 85420000, kind: 'video' },
    { key: 'stackfast/promo/stackfast-cold-email-promo-cut.mp4', size: 183420000, kind: 'video' },
    { key: 'clarity-diamonds/blind-test/hero-still.webp', size: 942000, kind: 'image' },
  ];
  const folders = new Map();
  const files = [];
  const p = cleanPrefix(prefix);
  for (const sample of samples) {
    if (p && !sample.key.startsWith(`${p}/`)) continue;
    const rest = p ? sample.key.slice(p.length + 1) : sample.key;
    const parts = rest.split('/');
    if (parts.length > 1) {
      const folderPrefix = joinKey(p, parts[0]);
      folders.set(folderPrefix, { type: 'folder', key: folderPrefix, name: parts[0], prefix: folderPrefix });
    } else {
      files.push({ type: 'file', kind: sample.kind, key: sample.key, name: basename(sample.key), size: sample.size, modified: new Date().toISOString(), contentType: mime.lookup(sample.key) || '', url: publicUrl(sample.key), markdown: obsidianMarkdown(sample.key), thumbnail: `/api/thumbnail?key=${encodeURIComponent(sample.key)}` });
    }
  }
  return { prefix: p, breadcrumbs: breadcrumbs(p), folders: [...folders.values()].sort(byName), files: files.sort(byName) };
}
function demoMediaUrl(rel) {
  if (mediaKind(rel) === 'video') return 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  return `/api/thumbnail?key=${encodeURIComponent(rel)}`;
}
function demoThumbSvg(rel) {
  const kind = mediaKind(rel);
  const name = basename(rel).replace(/[&<>]/g, '');
  const hue = Number.parseInt(crypto.createHash('sha1').update(rel).digest('hex').slice(0, 2), 16);
  const label = kind === 'video' ? '▶ VIDEO' : 'IMAGE';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},70%,34%)"/><stop offset="1" stop-color="hsl(${(hue+70)%360},80%,16%)"/></linearGradient></defs><rect width="800" height="520" fill="url(#g)"/><circle cx="650" cy="80" r="180" fill="rgba(255,255,255,.12)"/><text x="42" y="70" fill="rgba(255,255,255,.72)" font-family="Inter,Arial" font-size="26" font-weight="800" letter-spacing="4">${label}</text><text x="42" y="430" fill="white" font-family="Inter,Arial" font-size="42" font-weight="900">${name.slice(0,34)}</text></svg>`;
}
