import fs from 'node:fs/promises';
import fss from 'node:fs';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { cleanPrefix, cleanKey, fullKey, stripRoot, joinKey, basename, breadcrumbs, publicUrl, markdown } from './config.js';
import { mediaKind, objectToItem } from './media.js';
import mime from 'mime-types';

export function createS3(config) {
  return new S3Client({ endpoint: config.s3.endpoint, region: config.s3.region, forcePathStyle: config.s3.forcePathStyle, credentials: config.demoMode ? undefined : { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey } });
}
export async function listAssets(s3, config, folder = '') {
  if (config.demoMode) return demoList(config, folder);
  const clean = cleanPrefix(folder);
  const prefix = fullKey(config, clean);
  const folders = new Map();
  const files = [];
  let token;
  do {
    const out = await s3.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix ? `${prefix}/` : '', Delimiter: '/', ContinuationToken: token, MaxKeys: 1000 }));
    for (const cp of out.CommonPrefixes || []) {
      const full = cp.Prefix?.replace(/\/$/, '') || '';
      const rel = stripRoot(config, full);
      folders.set(rel, { type: 'folder', key: full, name: basename(rel), prefix: rel });
    }
    for (const obj of out.Contents || []) {
      if (!obj.Key || obj.Key.endsWith('/')) continue;
      files.push(objectToItem(config, obj, stripRoot(config, obj.Key)));
    }
    token = out.NextContinuationToken;
  } while (token);
  return { prefix: clean, breadcrumbs: breadcrumbs(clean), folders: [...folders.values()].sort(byName), files: files.sort(byName) };
}
export async function createFolder(s3, config, parent, name) {
  if (!config.allowFolderCreate) throw new Error('Folder creation is disabled');
  const rel = joinKey(parent, name);
  if (!rel) throw new Error('Missing folder name');
  if (!config.demoMode) await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: `${fullKey(config, rel)}/`, Body: '', ContentType: 'application/x-directory' }));
  return { ok: true, key: `${rel}/`, prefix: rel };
}
export async function uploadStream(s3, config, rel, stream, contentType) {
  if (!config.allowUpload) throw new Error('Uploads are disabled');
  if (config.demoMode) return { key: rel, url: publicUrl(config, rel), markdown: markdown(config, rel), demoMode: true };
  await new Upload({ client: s3, params: { Bucket: config.bucket, Key: fullKey(config, rel), Body: stream, ContentType: contentType || mime.lookup(rel) || 'application/octet-stream' }, queueSize: 4, partSize: 10 * 1024 * 1024, leavePartsOnError: false }).done();
  return { key: rel, url: publicUrl(config, rel), markdown: markdown(config, rel) };
}
export async function uploadFile(s3, config, filePath, prefix = '') {
  const name = basename(filePath);
  const rel = cleanKey(joinKey(prefix, name));
  const stream = fss.createReadStream(filePath);
  const out = await uploadStream(s3, config, rel, stream, mime.lookup(name) || 'application/octet-stream');
  return { name, ...out };
}
export async function deleteAsset(s3, config, rel) {
  if (!config.allowDelete) throw new Error('Delete is disabled');
  const clean = cleanKey(rel);
  if (!clean) throw new Error('Missing key');
  if (!config.demoMode) {
    const key = clean.endsWith('/') ? `${fullKey(config, clean.replace(/\/+$/g, ''))}/` : fullKey(config, clean);
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }
  return { ok: true, key: clean };
}
export async function signedObjectUrl(s3, config, rel) {
  const clean = cleanKey(rel);
  if (config.demoMode) return { key: clean, url: publicUrl(config, clean), signedUrl: mediaKind(clean) === 'video' ? 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' : `/api/thumbnail?key=${encodeURIComponent(clean)}` };
  const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: fullKey(config, clean) }), { expiresIn: 900 });
  return { key: clean, url: publicUrl(config, clean), signedUrl };
}
export async function downloadAsset(s3, config, rel, outPath) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: fullKey(config, rel) }));
  await fs.mkdir(new URL('.', `file://${outPath}`).pathname, { recursive: true }).catch(() => {});
  const ws = fss.createWriteStream(outPath);
  await new Promise((resolve, reject) => { obj.Body.pipe(ws); obj.Body.on('error', reject); ws.on('finish', resolve); ws.on('error', reject); });
  return { ok: true, path: outPath };
}
function byName(a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); }
function demoList(config, prefix) {
  const samples = [
    { key: 'campaigns/spring-launch/hero.jpg', size: 1849200, kind: 'image' },
    { key: 'campaigns/spring-launch/social-cut-01.mp4', size: 85420000, kind: 'video' },
    { key: 'brand/product-gallery/product-01.webp', size: 942000, kind: 'image' },
    { key: 'docs/lookbook.pdf', size: 2842000, kind: 'doc' },
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
      files.push({ type: 'file', kind: sample.kind, key: sample.key, name: basename(sample.key), size: sample.size, modified: new Date().toISOString(), contentType: mime.lookup(sample.key) || '', url: publicUrl(config, sample.key), markdown: markdown(config, sample.key), thumbnail: ['image','video'].includes(sample.kind) ? `/api/thumbnail?key=${encodeURIComponent(sample.key)}` : '' });
    }
  }
  return { prefix: p, breadcrumbs: breadcrumbs(p), folders: [...folders.values()].sort(byName), files: files.sort(byName) };
}
