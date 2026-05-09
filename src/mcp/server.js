#!/usr/bin/env node
import readline from 'node:readline';
import { loadConfig, markdown } from '../config.js';
import { createS3, listAssets, uploadFile, createFolder, deleteAsset, signedObjectUrl } from '../storage.js';

const config = loadConfig();
const s3 = createS3(config);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

const tools = [
  { name: 'bucketlens_list_assets', description: 'List folders and files in an R2/S3-compatible bucket prefix.', inputSchema: { type: 'object', properties: { prefix: { type: 'string' } } } },
  { name: 'bucketlens_upload_asset', description: 'Upload a local file to the configured bucket.', inputSchema: { type: 'object', properties: { local_path: { type: 'string' }, prefix: { type: 'string' } }, required: ['local_path'] } },
  { name: 'bucketlens_create_folder', description: 'Create a folder placeholder object.', inputSchema: { type: 'object', properties: { prefix: { type: 'string' } }, required: ['prefix'] } },
  { name: 'bucketlens_delete_asset', description: 'Delete an object key when deletion is enabled.', inputSchema: { type: 'object', properties: { key: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['key', 'confirm'] } },
  { name: 'bucketlens_get_asset_url', description: 'Return the configured public URL for an object key.', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'bucketlens_get_markdown_embed', description: 'Return Markdown/HTML embed text for an object key.', inputSchema: { type: 'object', properties: { key: { type: 'string' }, format: { type: 'string' } }, required: ['key'] } },
];

rl.on('line', async line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  try { await handle(msg); } catch (err) { respond(msg.id, null, { code: -32000, message: err.message }); }
});

async function handle(msg) {
  if (msg.method === 'initialize') return respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'bucketlens', version: '0.1.0' } });
  if (msg.method === 'tools/list') return respond(msg.id, { tools });
  if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params || {};
    const result = await callTool(name, args);
    return respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  }
  if (msg.id !== undefined) respond(msg.id, {});
}
async function callTool(name, args) {
  if (name === 'bucketlens_list_assets') return listAssets(s3, config, args.prefix || '');
  if (name === 'bucketlens_upload_asset') return uploadFile(s3, config, args.local_path, args.prefix || '');
  if (name === 'bucketlens_create_folder') { const parts = String(args.prefix || '').split('/').filter(Boolean); return createFolder(s3, config, parts.slice(0,-1).join('/'), parts.at(-1)); }
  if (name === 'bucketlens_delete_asset') { if (!args.confirm) throw new Error('confirm=true required'); return deleteAsset(s3, config, args.key); }
  if (name === 'bucketlens_get_asset_url') return signedObjectUrl(s3, config, args.key);
  if (name === 'bucketlens_get_markdown_embed') return { key: args.key, markdown: markdown(config, args.key, args.format || 'markdown') };
  throw new Error(`Unknown tool: ${name}`);
}
function respond(id, result, error) { const msg = { jsonrpc: '2.0', id }; if (error) msg.error = error; else msg.result = result; process.stdout.write(JSON.stringify(msg) + '\n'); }
