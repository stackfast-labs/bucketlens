import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import mime from 'mime-types';
import sharp from 'sharp';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { basename, publicUrl, markdown } from './config.js';

export function mediaKind(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (['.jpg','.jpeg','.png','.webp','.gif','.avif','.tif','.tiff'].includes(ext)) return 'image';
  if (['.mp4','.mov','.m4v','.webm','.avi','.mkv'].includes(ext)) return 'video';
  if (['.mp3','.wav','.m4a','.aac','.flac','.ogg'].includes(ext)) return 'audio';
  if (['.pdf'].includes(ext)) return 'doc';
  return 'file';
}
export function objectToItem(config, obj, rel) {
  const kind = mediaKind(rel);
  return { type: 'file', kind, key: rel, name: basename(rel), size: obj.Size || 0, modified: obj.LastModified, contentType: mime.lookup(rel) || '', url: publicUrl(config, rel), markdown: markdown(config, rel), thumbnail: ['image','video'].includes(kind) ? `/api/thumbnail?key=${encodeURIComponent(rel)}` : '' };
}
export async function thumbnailPath(config, rel, kind) {
  const h = crypto.createHash('sha1').update(`${kind}:${rel}`).digest('hex');
  return path.join(config.cacheDir, 'thumbs', `${h}.jpg`);
}
export async function makeImageThumb(s3, config, key, out) {
  const obj = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  await pipeline(obj.Body, sharp().rotate().resize(520, 360, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }), fss.createWriteStream(out));
}
export async function makeVideoThumb(s3, config, key, out) {
  const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 900 });
  const tmp = path.join(os.tmpdir(), `${crypto.randomUUID()}.jpg`);
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner','-loglevel','error','-ss','00:00:01','-i', signedUrl, '-frames:v','1','-vf','scale=520:-1', '-q:v','3', tmp]);
    ff.on('error', reject);
    ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
  await sharp(tmp).resize(520, 360, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(out);
  await fs.rm(tmp, { force: true });
}
export async function deleteThumbs(config, rel) {
  for (const kind of ['image','video']) await fs.rm(await thumbnailPath(config, rel, kind), { force: true });
}
export function demoMediaUrl(rel) {
  if (mediaKind(rel) === 'video') return 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  return `/api/thumbnail?key=${encodeURIComponent(rel)}`;
}
export function demoThumbSvg(rel) {
  const kind = mediaKind(rel);
  const name = basename(rel).replace(/[&<>]/g, '');
  const hue = Number.parseInt(crypto.createHash('sha1').update(rel).digest('hex').slice(0, 2), 16);
  const label = kind === 'video' ? '▶ VIDEO' : 'IMAGE';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},70%,34%)"/><stop offset="1" stop-color="hsl(${(hue+70)%360},80%,16%)"/></linearGradient></defs><rect width="800" height="520" fill="url(#g)"/><circle cx="650" cy="80" r="180" fill="rgba(255,255,255,.12)"/><text x="42" y="70" fill="rgba(255,255,255,.72)" font-family="Inter,Arial" font-size="26" font-weight="800" letter-spacing="4">${label}</text><text x="42" y="430" fill="white" font-family="Inter,Arial" font-size="42" font-weight="900">${name.slice(0,34)}</text></svg>`;
}
