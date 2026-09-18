import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const asset = new URL('../', import.meta.url);
const source = readFileSync(new URL('plugin.js', asset), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('manifest.json', asset), 'utf8'));
const reading = { flow: 1.5, targetTemperatureC: 60, milkGrams: 150, seconds: 25 };
const key = '1.500@60.000';
const valid = { autoDetect: true, smallPitcherGrams: 150, mediumPitcherGrams: 220, largePitcherGrams: 300,
  singleDrinkGrams: 160, singleDrinkPitcher: 'small', weightMode: 'gross', temperatureUnit: 'F',
  interpolate: false, targetTemperatureC: 0, referenceMilkGrams: 0, referenceSeconds: 0,
  referenceFlow: 0.4, minimumFlow: 0.4, maximumFlow: 2.5, flowReadings: JSON.stringify([reading]) };
function plugin(settings = valid, host = {}) {
  const context = vm.createContext({}); vm.runInContext(source, context);
  const instance = context.createPlugin(host); instance.onLoad(settings); return instance;
}
function call(instance, endpoint, method = 'GET', body = null) {
  const response = instance.__httpRequestHandler({ endpoint, method, body });
  return { ...response, json: response.headers['content-type'] === 'application/json' ? JSON.parse(response.body) : null };
}
const request = extra => ({
  samples: [800, 400, 0].map(ageMs => ({ weightGrams: 330, ageMs })),
  pitcher: 'auto', machineState: 'idle', stopAtTemperature: 0, calibrationKey: key, ...extra,
});

test('built plugin advertises API v5 and exact calibration choices', () => {
  const instance = plugin();
  assert.deepEqual(manifest.permissions, ['api', 'events.machine', 'pluginStorage']);
  const status = call(instance, 'status').json;
  assert.equal(status.ready, true);
  assert.equal(status.apiVersion, 5);
  assert.equal(status.flowCalibration.mode, 'saved');
  assert.deepEqual(status.flowCalibration.choices, [{ key, flow: 1.5, targetTemperatureC: 60, targetLabel: '140.0 °F' }]);
});

test('v2 storage starts empty instead of importing old calibration semantics', () => {
  const calls = [];
  const instance = plugin(valid, { storage: command => calls.push(structuredClone(command)) });
  assert.deepEqual(calls, [{ type: 'read', key: 'calibration-library.v2' }]);
  assert.equal(call(instance, 'status').json.settings.flowReadings, '[]');
  instance.onEvent({ name: 'storageRead', payload: { key: 'calibration-library.v2', value: null } });
  assert.equal(calls[1].type, 'write');
  assert.equal(calls[1].data.flowReadings, '[]');
  assert.equal(call(instance, 'status').json.calibrationStorage.state, 'writing');
  instance.onEvent({ name: 'storageWrite', payload: { key: 'calibration-library.v2' } });
  assert.equal(call(instance, 'status').json.calibrationStorage.state, 'ready');
});

test('library endpoint saves valid incomplete libraries independently of setup validation', () => {
  const calls = [];
  const instance = plugin({ ...valid, interpolate: true, targetTemperatureC: 60 }, { storage: command => calls.push(structuredClone(command)) });
  const one = JSON.stringify([reading]);
  const response = call(instance, 'library', 'POST', { flowReadings: one, curveFitTargets: [60] });
  assert.equal(response.status, 200);
  assert.equal(call(instance, 'status').json.settings.flowReadings, one);
  assert.deepEqual(call(instance, 'status').json.settings.curveFitTargets, [60]);
  assert.equal(call(instance, 'status').json.ready, false);
  assert.equal(calls.at(-1).key, 'calibration-library.v2');
  assert.deepEqual(calls.at(-1).data.curveFitTargets, [60]);
  assert.equal(call(instance, 'library', 'POST', { flowReadings: '{bad' }).status, 422);
  assert.equal(call(instance, 'library', 'POST', { flowReadings: one, curveFitTargets: [0] }).status, 422);
});

test('fresh installs expose configuration requirements and All targets', () => {
  const status = call(plugin({}), 'status').json;
  assert.equal(status.ready, false);
  assert.equal(status.settings.temperatureUnit, 'F');
  assert.equal(status.settings.targetTemperatureC, 0);
  assert.equal(status.settings.interpolate, false);
  assert.ok(status.errors.length > 0);
});

test('calculate returns the chosen calibration flow, target and duration', () => {
  const response = call(plugin(), 'calculate', 'POST', request());
  assert.equal(response.status, 200);
  assert.equal(response.json.apiVersion, 5);
  assert.equal(response.json.durationSeconds, 30);
  assert.equal(response.json.pitcher, 'small');
  assert.equal(response.json.targetTemperatureC, 60);
  assert.equal(response.json.targetLabel, '140.0 °F');
  assert.equal(response.json.calibrationKey, key);
  assert.deepEqual(response.json.workflowPatch, { steamSettings: { duration: 30, flow: 1.5 } });
});

test('configuration validation is read-only and reload replaces setup settings', () => {
  const instance = plugin();
  assert.equal(call(instance, 'validate', 'POST', { ...valid, flowReadings: '[]' }).status, 422);
  assert.equal(call(instance, 'status').json.settings.flowReadings, valid.flowReadings);
  instance.onLoad({ ...valid, targetTemperatureC: 60 });
  assert.equal(call(instance, 'status').json.settings.targetTemperatureC, 60);
});

test('disabled, wrong-method and unknown endpoints are explicit failures', () => {
  const instance = plugin();
  assert.equal(call(instance, 'calculate', 'GET').status, 405);
  assert.equal(call(instance, 'missing').status, 404);
  assert.equal(call(instance, 'calculate', 'POST', null).status, 422);
  instance.onUnload();
  assert.equal(call(instance, 'calculate', 'POST', {}).status, 503);
});

test('settings UI is self-contained and credits Damian', () => {
  const response = call(plugin(), 'ui');
  assert.equal(response.status, 200);
  assert.match(response.body, /github.com\/Damian-AU\/DSx2/);
  assert.match(response.body, /form="settings"/);
  assert.match(response.body, /role="alertdialog"/);
  assert.match(response.body, /Interpolate/);
  assert.match(response.body, /All targets/);
  const script = response.body.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
});

test('status advertises only configured pitcher choices and Auto is opt-in', () => {
  const fresh = call(plugin({}), 'status').json;
  assert.deepEqual(fresh.availablePitchers, []);
  assert.equal(fresh.settings.autoDetect, false);
  const partial = call(plugin({ ...valid, autoDetect: false, smallPitcherGrams: 0, largePitcherGrams: 0, singleDrinkGrams: 0 }), 'status').json;
  assert.equal(partial.ready, true);
  assert.deepEqual(partial.availablePitchers, ['medium']);
});

test('interpolation status and calculations survive serialization and reload', () => {
  const readings = [
    { flow: 0.4, targetTemperatureC: 60, milkGrams: 200, seconds: 40 },
    { flow: 1.45, targetTemperatureC: 60, milkGrams: 200, seconds: 25 },
    { flow: 2.5, targetTemperatureC: 60, milkGrams: 200, seconds: 10 },
  ];
  const settings = { ...valid, interpolate: true, targetTemperatureC: 60,
    flowReadings: JSON.stringify(readings), minimumFlow: 0.4, maximumFlow: 2.5 };
  const instance = plugin(JSON.parse(JSON.stringify(settings)));
  const status = call(instance, 'status').json;
  assert.equal(status.ready, true);
  assert.equal(status.flowCalibration.mode, 'interpolate');
  assert.equal(status.flowCalibration.step, 0.1);
  const input = request({ pitcher: 'small', flow: 1.45, calibrationKey: undefined, samples: [800, 400, 0].map(ageMs => ({ weightGrams: 350, ageMs })) });
  assert.equal(call(instance, 'calculate', 'POST', input).json.durationSeconds, 25);
  assert.equal(call(instance, 'calculate', 'POST', { ...input, flow: 2.6 }).json.code, 'flow_out_of_range');
  instance.onLoad(status.settings);
  assert.equal(call(instance, 'calculate', 'POST', input).json.durationSeconds, 25);
});
