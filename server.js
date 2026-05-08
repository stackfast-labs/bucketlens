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
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
  res.json({ title: APP_TITLE, prefix: ROOT_PREFIX, publicBaseUrl: PUBLIC_BASE_URL, maxUploadBytes: MAX_UPLOAD_BYTES });
});

app.get('/api/list', async (req, res, next) => {
  try {
    const folder = cleanPrefix(String(req.query.prefix || ''));
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
    const key = fullKey(String(req.query.key || ''));
    const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 900 });
    res.json({ key: stripRoot(key), url: publicUrl(stripRoot(key)), signedUrl });
  } catch (err) { next(err); }
});

app.get('/api/thumbnail', async (req, res, next) => {
  try {
    const rel = cleanKey(String(req.query.key || ''));
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

app.post('/api/upload', (req, res, next) => {
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
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fullKey(rel) }));
    await deleteThumbs(rel);
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
