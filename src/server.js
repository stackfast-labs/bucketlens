import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import express from 'express';
import Busboy from 'busboy';
import mime from 'mime-types';
import { loadConfig, publicConfig, cleanPrefix, cleanKey, cleanFolderName, joinKey } from './config.js';
import { createS3, listAssets, createFolder, uploadStream, deleteAsset, signedObjectUrl } from './storage.js';
import { mediaKind, thumbnailPath, makeImageThumb, makeVideoThumb, demoThumbSvg, deleteThumbs } from './media.js';

export function createServer(options = {}) {
  const config = options.config || loadConfig();
  const s3 = options.s3 || createS3(config);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    if (!config.appToken) return next();
    const token = req.get('x-bucketlens-token') || req.get('x-r2-browser-token') || req.query.token;
    if (token === config.appToken) return next();
    res.status(401).json({ error: 'Unauthorized' });
  });
  app.use(express.static(path.join(process.cwd(), 'public'), { extensions: ['html'] }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, title: config.appTitle }));
  app.get('/api/config', (_req, res) => res.json(publicConfig(config)));
  app.get('/api/list', async (req, res, next) => {
    try { res.json(await listAssets(s3, config, req.query.prefix || '')); } catch (err) { next(err); }
  });
  app.get('/api/object-url', async (req, res, next) => {
    try { res.json(await signedObjectUrl(s3, config, req.query.key || '')); } catch (err) { next(err); }
  });
  app.get('/api/thumbnail', async (req, res, next) => {
    try {
      const rel = cleanKey(String(req.query.key || ''));
      if (config.demoMode) { res.setHeader('Cache-Control', 'public, max-age=86400'); res.type('image/svg+xml'); return res.send(demoThumbSvg(rel)); }
      const key = joinKey(config.rootPrefix, rel);
      const kind = mediaKind(rel);
      const cachePath = await thumbnailPath(config, rel, kind);
      if (!fss.existsSync(cachePath)) {
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        if (kind === 'image') await makeImageThumb(s3, config, key, cachePath);
        else if (kind === 'video') await makeVideoThumb(s3, config, key, cachePath);
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
      res.json(await createFolder(s3, config, parent, name));
    } catch (err) { next(err); }
  });
  app.post('/api/upload', (req, res, next) => {
    if (!config.allowUpload) return res.status(403).json({ error: 'Uploads are disabled' });
    const folder = cleanPrefix(String(req.query.prefix || ''));
    const bb = Busboy({ headers: req.headers, limits: { fileSize: config.maxUploadBytes, files: 200 } });
    const uploads = [];
    const errors = [];
    bb.on('file', (_field, file, info) => {
      const filename = safeName(info.filename || 'upload.bin');
      const rel = cleanKey(joinKey(folder, filename));
      const contentType = info.mimeType || mime.lookup(filename) || 'application/octet-stream';
      const upload = uploadStream(s3, config, rel, file, contentType).then(out => ({ name: filename, ...out })).catch(err => { errors.push({ name: filename, error: err.message }); file.resume(); });
      uploads.push(upload);
    });
    bb.on('error', next);
    bb.on('close', async () => {
      try { const uploaded = (await Promise.all(uploads)).filter(Boolean); res.status(errors.length ? 207 : 200).json({ uploaded, errors }); }
      catch (err) { next(err); }
    });
    req.pipe(bb);
  });
  app.delete('/api/object', async (req, res, next) => {
    try {
      const rel = cleanKey(String(req.body.key || ''));
      if (!rel) return res.status(400).json({ error: 'Missing key' });
      const out = await deleteAsset(s3, config, rel);
      if (!rel.endsWith('/')) await deleteThumbs(config, rel);
      res.json(out);
    } catch (err) { next(err); }
  });
  app.use((err, _req, res, _next) => {
    console.error(err.message || err);
    const message = err.message || 'Internal error';
    const status = /disabled/i.test(message) ? 403 : /missing|required|invalid/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  });
  return { app, config, s3 };
}

function safeName(name) { return name.replace(/[\\]/g, '/').split('/').filter(Boolean).pop()?.replace(/^\.+/, '') || 'upload.bin'; }
