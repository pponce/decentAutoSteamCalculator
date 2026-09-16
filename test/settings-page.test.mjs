import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8');
const partial = { autoDetect: false, smallPitcherGrams: 0, mediumPitcherGrams: 220, largePitcherGrams: 0,
  weightMode: 'gross', referenceMilkGrams: 150, referenceSeconds: 25,
  referenceFlow: 1.5 };

async function page(settings = partial, failSave = false, guidedRun = false, updateVersion = null, updateError = null) {
  const runtime = vm.createContext({});
  vm.runInContext(source, runtime);
  const plugin = runtime.createPlugin();
  plugin.onLoad(settings);
  const fields = {};
  let time = 10000;
  let socket;
  class FakeDate extends Date { static now() { return time; } }
  const timers = [];
  class FakeWebSocket { constructor() { socket = this; } close() {} }
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    set name(value) { this.fieldName = value; fields[value] = this; }
    get name() { return this.fieldName; }
    set id(value) { this.elementId = value; ids[value] = this; }
    get id() { return this.elementId; }
    get parentElement() { return this.parent; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : (this._textContent || ''); }
    set textContent(value) { this.children = []; this._textContent = value; }
    focus() { this.focused = true; }
    append(...children) { for (const child of children) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); this.children.push(child); child.parent = this; if (this.tag === 'select' && !this.value) this.value = child.value; } }
    replaceChildren(...children) { this.children = []; this._textContent = ''; this.value = ''; this.append(...children); }
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
    setAttribute(key, value) { this[key] = value; }
    insertBefore(child, before) { this.children.splice(this.children.indexOf(before), 0, child); child.parent = this; }
    addEventListener(event, handler) {
      const previous = this.handlers[event];
      this.handlers[event] = async (...args) => { await previous?.(...args); return handler(...args); };
    }
  }
  const ids = Object.fromEntries(['settings', 'status', 'save', 'return-settings', 'settings-tabs', 'configuration-summary', 'extension-version', 'check-extension-update', 'approve-extension-update', 'extension-update-status', 'extension-update-dialog', 'extension-update-dialog-title', 'extension-update-dialog-message', 'extension-update-dialog-close'].map(id => [id, new Element(id === 'settings' ? 'form' : id.endsWith('close') || id.includes('check-') || id.includes('approve-') ? 'button' : id)]));
  ids['extension-update-dialog'].hidden = true;
  ids['check-extension-update'].textContent = 'Check & Update';
  ids.settings.elements = { namedItem: key => fields[key] };
  const navigations = [];
  const calls = [];
  const calibrationCalls = [];
  const savedSettings = [];
  let session = null;
  const managedPlugin = { id: 'calibrated-steam.reaplugin', version: '0.11.2', source: { kind: 'github_branch', repo: 'pponce/decentAutoSteamCalculator', branch: 'main', lastError: null }, pendingUpdate: null };
  const returnTo = 'http://localhost:43210/?page=settings';
  const document = { referrer: '', getElementById: id => ids[id], createElement: tag => new Element(tag) };
  const fetch = async (url, options = {}) => {
    const endpoint = url.split('/').at(-1);
    if (url === 'https://api.github.com/rate_limit') return { ok: true, json: async () => ({ resources: { core: { reset: Math.ceil((time + 600000) / 1000) } } }) };
    if (url === '/api/v1/plugins') return { ok: true, text: async () => JSON.stringify([managedPlugin]) };
    if (url === '/api/v1/plugins/update') {
      calls.push('update');
      managedPlugin.source.lastError = updateError;
      if (updateVersion && !updateError) managedPlugin.version = updateVersion;
      return { ok: true, text: async () => JSON.stringify({ message: 'Plugin update check complete' }) };
    }
    if (url.endsWith('/update/approve')) return { ok: true, text: async () => JSON.stringify({ version: managedPlugin.version }) };
    calls.push(endpoint);
    if (endpoint === 'calibration' && guidedRun) {
      const body = JSON.parse(options.body); calibrationCalls.push(body);
      if (body.action === 'begin') session = { active: true, phase: 'armed', token: 'page-test', seconds: 0, result: null, measurement: body };
      if (body.action === 'start') session = { ...session, phase: 'steaming', seconds: 0 };
      if (body.action === 'stop') session = { ...session, active: false, phase: 'complete', seconds: 25, result: { milkGrams: 160, flow: session.measurement.flow, seconds: 25 } };
      if (body.action === 'cancel') session = { ...session, active: false, phase: 'failed', message: 'Cancelled.', result: null };
      return { ok: true, text: async () => JSON.stringify(session) };
    }
    if (endpoint === 'tare') return { ok: true, text: async () => '' };
    if (endpoint === 'settings') {
      savedSettings.push(JSON.parse(options.body));
      if (failSave) throw new Error('Save failed');
      return { ok: true, text: async () => '{}'  };
    }
    const response = plugin.__httpRequestHandler({ endpoint, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    return { ok: response.status === 200, text: async () => response.body };
  };
  const body = plugin.__httpRequestHandler({ endpoint: 'ui', method: 'GET' }).body;
  const context = vm.createContext({ document, fetch, URL, Date: FakeDate, WebSocket: FakeWebSocket, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout: () => {}, window: { addEventListener() {}, location: {
    href: `http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/ui?returnTo=${encodeURIComponent(returnTo)}`,
    assign: url => navigations.push(url),
  } } });
  vm.runInContext(body.match(/<script>([\s\S]*)<\/script>/)[1], context);
  await new Promise(resolve => setImmediate(resolve));
  const all = element => [element, ...element.children.flatMap(all)];
  return { fields, ids, calls, navigations, returnTo, calibrationCalls, savedSettings,
    buttons: text => all(ids.settings).filter(element => element.tag === 'button' && element.textContent === text),
    scale: weight => { time += 300; socket.onmessage({ data: JSON.stringify({ weight }) }); },
    change: () => ids.settings.handlers.change(), submit: () => ids.settings.handlers.submit({ preventDefault() {} }) };
}

test('standalone form removes starting selection and keeps one visible calibration flow', async () => {
  const p = await page();
  assert.equal(p.fields.defaultPitcher, undefined);
  assert.equal(p.ids['automatic-fields'].hidden, true);
  assert.equal(p.fields.singleDrinkGrams.required, false);
  assert.equal(p.ids['return-settings'].href, p.returnTo);
  assert.equal(p.fields.referenceSteamTemperature, undefined);
  assert.equal(p.fields.maxSeconds, undefined);
  assert.equal(p.fields.referenceFlow.type, 'hidden');
  assert.equal(p.ids['calibration-flow'].min, '0.4');
  assert.equal(p.ids['calibration-flow'].max, '2.5');
  await p.submit();
  assert.deepEqual(p.calls, ['status', 'validate', 'settings']);
  assert.deepEqual(p.navigations, [p.returnTo]);
});

test('enabling Auto reveals required fields and incomplete Auto cannot save or navigate', async () => {
  const p = await page();
  p.fields.autoDetect.checked = true;
  await p.change();
  assert.equal(p.ids['automatic-fields'].hidden, false);
  assert.equal(p.fields.singleDrinkGrams.required, true);
  assert.equal(p.fields.singleDrinkPitcher.required, true);
  await p.submit();
  assert.deepEqual(p.calls, ['status']);
  assert.deepEqual(p.navigations, []);
  assert.match(p.ids.status.textContent, /all three pitcher weights/);
});

test('failed persistence leaves the form open with an error', async () => {
  const p = await page(partial, true);
  await p.submit();
  assert.deepEqual(p.navigations, []);
  assert.equal(p.ids.status.textContent, 'Save failed');
  assert.equal(p.ids.save.disabled, false);
});


test('tare waits for zero before capturing a stable empty pitcher weight', async () => {
  const p = await page();
  const tare = p.buttons('Tare empty scale')[0];
  const set = p.buttons('Set from scale')[0];
  await tare.handlers.click();
  for (let i = 0; i < 10; i++) p.scale(150);
  await set.handlers.click();
  assert.equal(p.fields.smallPitcherGrams.value, '');
  assert.match(set.parent.children.at(-1).textContent, /stable zero/);
  assert.notEqual(set.parent.tag, 'label');
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(155.5);
  await set.handlers.click();
  assert.equal(p.fields.smallPitcherGrams.value, '155.5');
  assert.ok(p.calls.includes('tare'));
});

test('calibration offers its own empty-scale tare and captures milk after subtracting the chosen pitcher', async () => {
  const p = await page();
  await p.buttons('Edit')[0].handlers.click();
  await p.ids['flow-method-guided'].handlers.click();
  assert.equal(p.buttons('Tare empty scale').length, 2);
  await p.buttons('Tare empty scale')[1].handlers.click();
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(380);
  await p.buttons('Capture pitcher + milk')[0].handlers.click();
  assert.equal(p.buttons('Prepare calibration')[0].disabled, false);
  assert.equal(p.buttons('Start steam')[0].disabled, true);
  assert.equal(p.calls.filter(call => call === 'calibration').length, 0);
});


test('guided form starts and stops, fills measured values, and saves back to settings', async () => {
  const p = await page(partial, false, true);
  await p.buttons('Edit')[0].handlers.click();
  await p.ids['flow-method-guided'].handlers.click();
  await p.buttons('Tare empty scale')[1].handlers.click();
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(380);
  await p.buttons('Capture pitcher + milk')[0].handlers.click();
  await p.buttons('Prepare calibration')[0].handlers.click();
  assert.equal(p.calibrationCalls[0].milkGrams, 160);
  assert.equal(p.calibrationCalls[0].pitcher, 'medium');
  assert.equal(p.calibrationCalls[0].flow, 1.5);
  assert.equal(p.ids.save.disabled, true);
  assert.equal(p.ids['calibration-flow'].disabled, true);
  assert.equal(p.buttons('Start steam')[0].disabled, false);
  await p.buttons('Start steam')[0].handlers.click();
  assert.equal(p.buttons('Start steam')[0].disabled, true);
  assert.equal(p.buttons('Stop steam')[0].disabled, false);
  await p.buttons('Stop steam')[0].handlers.click();
  assert.equal(p.ids.save.disabled, false);
  assert.equal(p.fields.referenceSeconds.value, '25');
  assert.equal(p.fields.referenceMilkGrams.value, '160');
  assert.equal(p.buttons('Prepare calibration')[0].disabled, true);
  await p.submit();
  assert.deepEqual(p.navigations, [p.returnTo]);
});

test('Return to settings cancels an active guided run before navigating', async () => {
  const p = await page(partial, false, true);
  await p.buttons('Edit')[0].handlers.click();
  await p.ids['flow-method-guided'].handlers.click();
  await p.buttons('Tare empty scale')[1].handlers.click();
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(380);
  await p.buttons('Capture pitcher + milk')[0].handlers.click();
  await p.buttons('Prepare calibration')[0].handlers.click();
  let prevented = false;
  await p.ids['return-settings'].handlers.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(p.calibrationCalls.at(-1).action, 'cancel');
  assert.deepEqual(p.navigations, [p.returnTo]);
  assert.equal(p.calls.includes('settings'), false);
});


test('compact tabs group settings and reveal invalid calibration fields on save', async () => {
  const p = await page({ ...partial, referenceSeconds: 0 });
  assert.match(source, /<div id="settings-toolbar"><nav id="settings-tabs"[\s\S]*<p id="configuration-summary"/);
  assert.equal(p.ids['panel-general'], undefined);
  assert.equal(p.ids['panel-pitchers'].hidden, false);
  await p.ids['tab-pitchers'].handlers.click();
  assert.equal(p.ids['panel-pitchers'].hidden, false);
  assert.equal(p.fields.autoDetect.closest('fieldset'), p.fields.singleDrinkGrams.closest('fieldset'));
  assert.deepEqual(p.ids['configuration-summary'].children.filter(child => child.className === 'configured-pitcher').map(child => child.textContent), ['M']);
  assert.deepEqual(p.ids['configuration-summary'].children.filter(child => child.className === 'unconfigured-pitcher').map(child => child.textContent), ['S', 'L', 'Auto']);
  assert.match(p.ids['configuration-summary'].textContent, /Set flow: 1\.5 ml\/s/);
  await p.submit();
  assert.equal(p.ids['panel-calibration'].hidden, false);
  assert.equal(p.fields.weightMode.closest('fieldset'), p.fields.targetTemperatureC.closest('fieldset'));
  assert.equal(p.ids['calibration-flow'].closest('fieldset'), p.fields.weightMode.closest('fieldset'));
  assert.equal(p.fields.referenceSeconds.closest('details').open, true);
  assert.equal(p.fields.referenceSeconds.focused, true);
});

test('the visible calibration flow edits the hidden saved value and clears the previous time', async () => {
  const p = await page();
  const mirror = p.ids['calibration-flow'];
  mirror.value = '0.4'; await mirror.handlers.input();
  assert.equal(p.fields.referenceFlow.value, '0.4');
  assert.equal(p.fields.referenceSeconds.value, '');
  p.fields.referenceFlow.value = '0.8';
  await p.ids.settings.handlers.input({ target: p.fields.referenceFlow });
  assert.equal(mirror.value, '0.8');
  assert.match(p.ids['configuration-summary'].textContent, /Set flow: 0\.8 ml\/s/);
});

test('a blocked milk capture explains the missing tare beside its own button', async () => {
  const p = await page();
  await p.buttons('Edit')[0].handlers.click();
  await p.ids['flow-method-guided'].handlers.click();
  const capture = p.buttons('Capture pitcher + milk')[0];
  await capture.handlers.click();
  const message = capture.parent.parent.children.at(-1);
  assert.match(message.textContent, /stable zero/);
  assert.equal(p.buttons('Prepare calibration')[0].disabled, true);
});

test('multiple-flow manual wizard requires all readings and saves the full draft once', async () => {
  const p = await page();
  await p.ids['flow-mode-multiple'].handlers.click();
  assert.equal(p.fields.calibrationMode.value, 'multiple');
  assert.deepEqual(JSON.parse(p.fields.flowReadings.value).map(r => r.flow), [0.4, 1.5, 2.5]);
  await p.submit();
  assert.equal(p.savedSettings.length, 0);
  assert.equal(p.ids['panel-calibration'].hidden, false);
  for (const seconds of [40, 20, 12]) {
    p.fields.referenceMilkGrams.value = '200'; p.fields.referenceSeconds.value = seconds;
    await p.ids['flow-use-reading'].handlers.click();
  }
  assert.equal(p.ids['flow-review'].hidden, false);
  await p.submit();
  assert.equal(p.savedSettings.length, 1);
  assert.deepEqual(JSON.parse(p.savedSettings[0].flowReadings), [
    { flow: 0.4, milkGrams: 200, seconds: 40 }, { flow: 1.5, milkGrams: 200, seconds: 20 }, { flow: 2.5, milkGrams: 200, seconds: 12 },
  ]);
});

test('guided multiple readings prepare the machine at each planned flow and require fresh captures', async () => {
  const p = await page(partial, false, true);
  await p.ids['flow-mode-multiple'].handlers.click();
  await p.ids['flow-method-guided'].handlers.click();
  for (const expected of [0.4, 1.5, 2.5]) {
    assert.equal(p.buttons('Prepare calibration')[0].disabled, true);
    await p.buttons('Tare empty scale')[1].handlers.click();
    for (let i = 0; i < 12; i++) p.scale(0);
    for (let i = 0; i < 12; i++) p.scale(380);
    await p.buttons('Capture pitcher + milk')[0].handlers.click();
    await p.buttons('Prepare calibration')[0].handlers.click();
    assert.equal(p.calibrationCalls.at(-1).flow, expected);
    assert.equal(p.ids['flow-reading-count'].disabled, true);
    assert.equal(p.ids['flow-mode-single'].disabled, true);
    await p.buttons('Start steam')[0].handlers.click();
    await p.buttons('Stop steam')[0].handlers.click();
    await p.ids['flow-use-reading'].handlers.click();
  }
  assert.equal(p.fields.referenceFlow.value, '1.5');
  await p.submit();
  assert.deepEqual(JSON.parse(p.savedSettings[0].flowReadings).map(r => r.flow), [0.4, 1.5, 2.5]);
});

test('changing default flow preserves multiple measurements and editing a reading requires use again', async () => {
  const readings = [{ flow: 0.4, milkGrams: 200, seconds: 40 }, { flow: 2.5, milkGrams: 200, seconds: 10 }];
  const p = await page({ ...partial, calibrationMode: 'multiple', flowReadings: JSON.stringify(readings) });
  await p.buttons('Edit')[0].handlers.click();
  assert.equal(p.fields.referenceSeconds.value, '40');
  p.ids['calibration-flow'].value = '1.0'; await p.ids['calibration-flow'].handlers.input();
  assert.equal(p.fields.referenceSeconds.value, '40');
  assert.deepEqual(JSON.parse(p.fields.flowReadings.value), readings);
  p.fields.referenceSeconds.value = '45';
  await p.ids.settings.handlers.input({ target: p.fields.referenceSeconds });
  await p.submit();
  assert.equal(p.savedSettings.length, 0);
  await p.ids['flow-use-reading'].handlers.click();
  await p.submit();
  assert.equal(p.savedSettings[0].referenceFlow, 1);
  assert.equal(JSON.parse(p.savedSettings[0].flowReadings)[0].seconds, 45);
});

test('legacy starting-pitcher settings are discarded when saving', async () => {
  const p = await page({ ...partial, defaultPitcher: 'medium' });
  assert.equal(p.fields.defaultPitcher, undefined);
  await p.submit();
  assert.equal(Object.hasOwn(p.savedSettings[0], 'defaultPitcher'), false);
});

test('single calibration reopens compactly with its actual measured milk weight', async () => {
  const p = await page({ ...partial, targetTemperatureC: 60 });
  assert.equal(p.ids['flow-review'].hidden, false);
  assert.equal(p.ids['flow-reading-panel'].hidden, true);
  assert.match(p.ids['flow-review'].textContent, /60 °C/);
  await p.buttons('Edit')[0].handlers.click();
  assert.equal(p.ids['flow-reading-panel'].hidden, false);
  p.fields.referenceMilkGrams.value = '158';
  await p.ids.settings.handlers.input({ target: p.fields.referenceMilkGrams });
  assert.equal(p.ids['flow-use-reading'].textContent, 'Use values and review');
  await p.ids['flow-use-reading'].handlers.click();
  assert.match(p.ids['flow-review'].textContent, /158 g/);
  await p.submit();
  assert.equal(p.savedSettings[0].referenceMilkGrams, 158);
  const reopened = await page(p.savedSettings[0]);
  assert.equal(reopened.ids['flow-review'].hidden, false);
  assert.equal(reopened.ids['flow-reading-panel'].hidden, true);
  assert.match(reopened.ids['flow-review'].textContent, /158 g.*60 °C/);
  assert.equal(reopened.ids['flow-calibration-status'].textContent, 'Changes only apply after save.');
});

test('multiple saved readings all reopen compactly and one edit preserves the other readings', async () => {
  const readings = [
    { flow: 0.4, milkGrams: 158, seconds: 40 },
    { flow: 1.5, milkGrams: 160, seconds: 20 },
    { flow: 2.5, milkGrams: 159, seconds: 12 },
  ];
  const p = await page({ ...partial, calibrationMode: 'multiple', flowReadings: JSON.stringify(readings), targetTemperatureC: 60 });
  assert.equal(p.ids['flow-review'].hidden, false);
  assert.equal(p.ids['flow-reading-steps'].hidden, true);
  assert.equal(p.buttons('Edit').length, 3);
  await p.buttons('Edit')[1].handlers.click();
  assert.equal(p.fields.referenceSeconds.value, '20');
  p.fields.referenceSeconds.value = '21';
  await p.ids.settings.handlers.input({ target: p.fields.referenceSeconds });
  assert.equal(p.ids['flow-use-reading'].textContent, 'Use values and review');
  await p.ids['flow-use-reading'].handlers.click();
  assert.equal(p.ids['flow-review'].hidden, false);
  await p.submit();
  const updated = readings.map((r, i) => i === 1 ? { ...r, seconds: 21 } : r);
  assert.deepEqual(JSON.parse(p.savedSettings[0].flowReadings), updated);
  const reopened = await page(p.savedSettings[0]);
  assert.equal(reopened.ids['flow-review'].hidden, false);
  assert.equal(reopened.buttons('Edit').length, 3);
  assert.match(reopened.ids['flow-review'].textContent, /21 s/);
  assert.equal(reopened.fields.targetTemperatureC.value, '60');
});

test('guided measurement saves actual milk and does not send the temperature note', async () => {
  const p = await page({ ...partial, targetTemperatureC: 60 }, false, true);
  await p.buttons('Edit')[0].handlers.click();
  await p.ids['flow-method-guided'].handlers.click();
  await p.buttons('Tare empty scale')[1].handlers.click();
  for (let i = 0; i < 12; i++) p.scale(0);
  for (let i = 0; i < 12; i++) p.scale(380);
  await p.buttons('Capture pitcher + milk')[0].handlers.click();
  await p.buttons('Prepare calibration')[0].handlers.click();
  assert.equal(p.fields.targetTemperatureC.disabled, true);
  assert.equal(p.calibrationCalls[0].targetTemperatureC, undefined);
  assert.equal(p.calibrationCalls[0].heaterTemperature, undefined);
  assert.equal(p.calibrationCalls[0].milkGrams, 160);
  await p.buttons('Start steam')[0].handlers.click();
  await p.buttons('Stop steam')[0].handlers.click();
  await p.ids['flow-use-reading'].handlers.click();
  await p.submit();
  assert.equal(p.savedSettings[0].referenceMilkGrams, 160);
  assert.equal(p.savedSettings[0].targetTemperatureC, 60);
});

test('instructions and glossary are navigable tabs with calibration field guidance', async () => {
  const p = await page();
  await p.ids['tab-instructions'].handlers.click();
  assert.equal(p.ids['panel-instructions'].hidden, false);
  assert.match(p.ids['panel-instructions'].textContent, /same target milk temperature/);
  await p.ids['tab-instructions'].handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(p.ids['panel-glossary'].hidden, false);
  assert.doesNotMatch(p.ids['panel-glossary'].textContent, /Target milk per reading/);
  assert.match(p.ids['panel-glossary'].textContent, /Calibration milk weight/);
  assert.match(p.ids['panel-glossary'].textContent, /note only/i);
  await p.ids['tab-glossary'].handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(p.ids['panel-pitchers'].hidden, false);
});

test('settings page displays its version and checks for managed extension updates', async () => {
  const p = await page(partial, false, false, '0.12.0');
  assert.equal(p.ids['extension-version'].textContent, 'Version 0.11.2');
  assert.equal(p.ids['check-extension-update'].textContent, 'Check & Update');
  assert.equal(p.ids['check-extension-update'].disabled, false);
  await p.ids['check-extension-update'].handlers.click();
  assert.ok(p.calls.includes('update'));
  assert.equal(p.ids['extension-version'].textContent, 'Version 0.12.0');
  assert.equal(p.ids['extension-update-dialog'].hidden, false);
  assert.match(p.ids['extension-update-dialog-message'].textContent, /Updated to version 0\.12\.0/);
});

test('GitHub 403 update failures open a rate-limit dialog with retry minutes', async () => {
  const p = await page(partial, false, false, null, 'Exception: Failed to resolve pponce/decentAutoSteamCalculator@main: 403');
  await p.ids['check-extension-update'].handlers.click();
  assert.equal(p.ids['extension-update-dialog'].hidden, false);
  assert.equal(p.ids['extension-update-dialog-title'].textContent, 'Update failed');
  assert.match(p.ids['extension-update-dialog-message'].textContent, /Try again in 10 minutes/);
  await p.ids['extension-update-dialog-close'].handlers.click();
  assert.equal(p.ids['extension-update-dialog'].hidden, true);
});

test('temperature note can be changed without reopening or overwriting a saved reading', async () => {
  const p = await page();
  p.fields.targetTemperatureC.value = '62';
  await p.ids.settings.handlers.input({ target: p.fields.targetTemperatureC });
  assert.equal(p.ids['flow-review'].hidden, false);
  assert.match(p.ids['flow-review'].textContent, /150 g.*25 s.*62 °C/);
  await p.submit();
  const reopened = await page(p.savedSettings[0]);
  assert.equal(reopened.fields.referenceMilkGrams.value, '150');
  assert.equal(reopened.fields.referenceSeconds.value, '25');
  assert.equal(reopened.fields.targetTemperatureC.value, '62');
});

test('invalid temperature note reveals Calibration and can be corrected without losing measured values', async () => {
  const p = await page();
  p.fields.targetTemperatureC.value = '150';
  await p.submit();
  assert.equal(p.savedSettings.length, 0);
  assert.match(p.ids.status.textContent, /0 and 100 °C/);
  assert.equal(p.ids['panel-calibration'].hidden, false);
  assert.equal(p.fields.targetTemperatureC.focused, true);
  p.fields.targetTemperatureC.value = '';
  await p.submit();
  assert.equal(p.savedSettings[0].referenceSeconds, 25);
  assert.equal(p.savedSettings[0].targetTemperatureC, 0);
});

test('invalid planned range cannot reuse old points or save until corrected', async () => {
  const p = await page(); await p.ids['flow-mode-multiple'].handlers.click();
  p.ids['flow-minimum'].value = '0.3'; await p.ids['flow-minimum'].handlers.change();
  assert.equal(p.ids['flow-use-reading'].disabled, true);
  for (let i = 0; i < 3; i++) {
    p.fields.referenceMilkGrams.value = '200'; p.fields.referenceSeconds.value = '30';
    await p.ids['flow-use-reading'].handlers.click();
  }
  await p.submit(); assert.equal(p.savedSettings.length, 0);
  p.ids['flow-minimum'].value = '0.4'; await p.ids['flow-minimum'].handlers.change();
  assert.equal(p.ids['flow-use-reading'].disabled, false);
  assert.equal(p.fields.referenceSeconds.value, '');
});

test('new single calibration requires actual milk weight and never prefills a target', async () => {
  const p = await page({ ...partial, referenceMilkGrams: 0, referenceSeconds: 0, targetMilkGrams: 160 });
  assert.equal(p.fields.targetMilkGrams, undefined);
  assert.equal(p.fields.referenceMilkGrams.value, '');
  p.fields.referenceSeconds.value = '25';
  await p.ids['flow-use-reading'].handlers.click();
  assert.equal(p.ids['flow-review'].hidden, true);
  await p.submit();
  assert.equal(p.savedSettings.length, 0);
  p.fields.referenceMilkGrams.value = '158';
  await p.ids['flow-use-reading'].handlers.click();
  await p.submit();
  assert.equal(p.savedSettings[0].referenceMilkGrams, 158);
  assert.equal(p.savedSettings[0].targetMilkGrams, undefined);
});

test('each new flow reading requires its own actual milk weight and retains it after save', async () => {
  const p = await page();
  await p.ids['flow-mode-multiple'].handlers.click();
  const readings = [
    { flow: 0.4, milkGrams: 158, seconds: 40 },
    { flow: 1.5, milkGrams: 161, seconds: 20 },
    { flow: 2.5, milkGrams: 159, seconds: 12 },
  ];
  for (const reading of readings) {
    assert.equal(p.fields.referenceMilkGrams.value, '');
    p.fields.referenceSeconds.value = reading.seconds;
    await p.ids['flow-use-reading'].handlers.click();
    assert.match(p.ids['flow-calibration-status'].textContent, /Enter 10–1500 g/);
    p.fields.referenceMilkGrams.value = reading.milkGrams;
    await p.ids['flow-use-reading'].handlers.click();
  }
  await p.submit();
  assert.deepEqual(JSON.parse(p.savedSettings[0].flowReadings), readings);
  const reopened = await page(p.savedSettings[0]);
  for (let i = 0; i < readings.length; i++) {
    await reopened.buttons('Edit')[i].handlers.click();
    assert.equal(Number(reopened.fields.referenceMilkGrams.value), readings[i].milkGrams);
    await reopened.ids['flow-use-reading'].handlers.click();
  }
  await p.ids['flow-mode-single'].handlers.click();
  assert.equal(p.fields.referenceMilkGrams.value, '');
});

test('changing single calibration flow clears the previous milk measurement', async () => {
  const p = await page();
  await p.ids['calibration-flow'].handlers.input();
  assert.equal(p.fields.referenceMilkGrams.value, '150');
  assert.equal(p.fields.referenceSeconds.value, '25');
  p.ids['calibration-flow'].value = '0.4';
  await p.ids['calibration-flow'].handlers.input();
  assert.equal(p.fields.referenceMilkGrams.value, '');
  assert.equal(p.fields.referenceSeconds.value, '');
});

test('pitcher badges show every choice in configured or unconfigured colors', async () => {
  const p = await page({ ...partial, referenceSeconds: 0 });
  const configured = () => p.ids['configuration-summary'].children.filter(child => child.className === 'configured-pitcher').map(child => child.textContent);
  const unconfigured = () => p.ids['configuration-summary'].children.filter(child => child.className === 'unconfigured-pitcher').map(child => child.textContent);
  assert.deepEqual(configured(), ['M']);
  assert.deepEqual(unconfigured(), ['S', 'L', 'Auto']);
  assert.doesNotMatch(p.ids['configuration-summary'].textContent, /Configured|Not configured|Calibration|ready|setup required/);
  p.fields.smallPitcherGrams.value = '150';
  p.fields.largePitcherGrams.value = '300';
  p.fields.autoDetect.checked = true;
  await p.change();
  assert.deepEqual(configured(), ['S', 'M', 'L']);
  assert.deepEqual(unconfigured(), ['Auto']);
  p.fields.singleDrinkGrams.value = '160';
  p.fields.singleDrinkPitcher.value = 'small';
  await p.change();
  assert.deepEqual(configured(), ['S', 'M', 'L', 'Auto']);
  assert.deepEqual(unconfigured(), []);
  p.fields.autoDetect.checked = false;
  p.fields.smallPitcherGrams.value = '';
  await p.change();
  assert.deepEqual(configured(), ['M', 'L']);
  assert.deepEqual(unconfigured(), ['S', 'Auto']);
});
