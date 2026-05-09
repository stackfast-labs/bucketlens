#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { loadConfig, markdown } from '../src/config.js';
import { createS3, listAssets, uploadFile, deleteAsset, createFolder, signedObjectUrl, downloadAsset } from '../src/storage.js';
import { createServer } from '../src/server.js';

const args = process.argv.slice(2);
const cmd = args.shift() || 'help';
const config = loadConfig();
const s3 = createS3(config);

try {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') help();
  else if (cmd === 'serve') { const { app } = createServer({ config, s3 }); app.listen(config.port, () => console.log(`${config.appTitle} listening on :${config.port}`)); }
  else if (cmd === 'config') await configCheck();
  else if (cmd === 'list') await list(args[0] || '');
  else if (cmd === 'mkdir') await mkdir(requiredArg(args[0], 'prefix'));
  else if (cmd === 'upload') await upload(args);
  else if (cmd === 'delete') await del(args);
  else if (cmd === 'url') await url(requiredArg(args[0], 'key'));
  else if (cmd === 'markdown') console.log(markdown(config, requiredArg(args[0], 'key'), valueAfter(args, '--format') || 'markdown'));
  else if (cmd === 'download') await download(args);
  else if (cmd === 'mcp') await import('../src/mcp/server.js');
  else throw new Error(`Unknown command: ${cmd}`);
} catch (err) { console.error(`bucketlens: ${err.message}`); process.exit(1); }

async function configCheck() { await listAssets(s3, config, ''); console.log(JSON.stringify({ ok: true, bucket: config.bucket, prefix: config.rootPrefix, demoMode: config.demoMode, readOnly: config.readOnly }, null, 2)); }
async function list(prefix) { const out = await listAssets(s3, config, prefix); console.log(JSON.stringify(out, null, 2)); }
async function mkdir(prefix) { const parent = prefix.split('/').slice(0, -1).join('/'); const name = prefix.split('/').filter(Boolean).pop(); console.log(JSON.stringify(await createFolder(s3, config, parent, name), null, 2)); }
async function upload(argv) { const prefix = valueAfter(argv, '--prefix') || ''; const files = argv.filter(a => !a.startsWith('--') && a !== prefix); if (!files.length) throw new Error('upload requires at least one file'); const out=[]; for (const file of files) out.push(await uploadFile(s3, config, file, prefix)); console.log(JSON.stringify(out, null, 2)); }
async function del(argv) { const key = requiredArg(argv[0], 'key'); if (!argv.includes('--yes')) throw new Error('delete requires --yes'); console.log(JSON.stringify(await deleteAsset(s3, config, key), null, 2)); }
async function url(key) { console.log((await signedObjectUrl(s3, config, key)).url); }
async function download(argv) { const key = requiredArg(argv[0], 'key'); const output = valueAfter(argv, '--output') || key.split('/').pop(); console.log(JSON.stringify(await downloadAsset(s3, config, key, output), null, 2)); }
function valueAfter(argv, flag) { const i = argv.indexOf(flag); return i >= 0 ? argv[i+1] : ''; }
function requiredArg(v, name) { if (!v) throw new Error(`missing ${name}`); return v; }
function help() { console.log(`BucketLens — A media-first browser for R2 and S3-compatible buckets.\n\nUsage:\n  bucketlens serve\n  bucketlens config\n  bucketlens list [prefix]\n  bucketlens mkdir <prefix>\n  bucketlens upload <file...> [--prefix prefix]\n  bucketlens download <key> --output <path>\n  bucketlens url <key>\n  bucketlens markdown <key> [--format markdown|html-image|html-video]\n  bucketlens delete <key> --yes\n  bucketlens mcp`); }
