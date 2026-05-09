import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, cleanPrefix, markdown, publicUrl } from '../src/config.js';

test('demo config loads without secrets', () => {
  const c = loadConfig({ DEMO_MODE: 'true', S3_BUCKET: 'demo', PUBLIC_BASE_URL: 'https://assets.example.com' });
  assert.equal(c.demoMode, true);
  assert.equal(c.appTitle, 'BucketLens');
});

test('prefix cleanup prevents traversal-ish segments', () => {
  assert.equal(cleanPrefix('/a/../b/'), 'a/b');
});

test('public url encodes path parts', () => {
  const c = loadConfig({ DEMO_MODE: 'true', S3_BUCKET: 'demo', PUBLIC_BASE_URL: 'https://assets.example.com' });
  assert.equal(publicUrl(c, 'folder/a b.png'), 'https://assets.example.com/folder/a%20b.png');
});

test('markdown format is generic markdown embed', () => {
  const c = loadConfig({ DEMO_MODE: 'true', S3_BUCKET: 'demo', PUBLIC_BASE_URL: 'https://assets.example.com' });
  assert.equal(markdown(c, 'x.png'), '![](https://assets.example.com/x.png)');
});
