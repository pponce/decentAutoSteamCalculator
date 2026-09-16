import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('repository root is a directly installable Decaid plugin with a stable identity', () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.id, 'calibrated-steam.reaplugin');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.apiVersion, 1);
  assert.deepEqual(manifest.permissions, ['api', 'events.machine']);
  const runtime = vm.createContext({});
  vm.runInContext(readFileSync(new URL('plugin.js', root), 'utf8'), runtime);
  const plugin = runtime.createPlugin();
  plugin.onLoad({ mediumPitcherGrams: 220, referenceMilkGrams: 158, referenceSeconds: 25, referenceFlow: 0.4 });
  const status = JSON.parse(plugin.__httpRequestHandler({ endpoint: 'status', method: 'GET' }).body);
  assert.equal(status.apiVersion, 4);
  assert.equal(status.ready, true);
  assert.equal(status.settings.referenceMilkGrams, 158);
});
