import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8');
const installedVersion = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')).version;
const nextVersion = installedVersion.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_, major, minor, patch) => `${major}.${minor}.${Number(patch) + 1}`);
const settingsMockup = readFileSync(new URL('../assets/settings_mockup.html', import.meta.url), 'utf8');
const saved = (flow, seconds, targetTemperatureC = 60) => ({ flow, targetTemperatureC, milkGrams: 160, seconds });
const partial = { autoDetect: false, smallPitcherGrams: 150, mediumPitcherGrams: 220, largePitcherGrams: 0,
  weightMode: 'gross', targetTemperatureC: 60, referenceMilkGrams: 160, referenceSeconds: 25,
  referenceFlow: 1.5, minimumFlow: 0.4, maximumFlow: 2.5, interpolate: false,
  flowReadings: JSON.stringify([saved(1.5, 25)]) };

async function page(settings = partial, {
  guided = false,
  remoteVersion = installedVersion,
  betaVersion = nextVersion + '-beta.1',
  sourceBranch = 'main',
  managedVersion = installedVersion,
  remotePermissions = ['api', 'events.machine'],
  betaPermissions = ['api', 'events.machine', 'pluginStorage'],
  checkError = null,
  updateError = null,
  pendingUpdate = null,
} = {}) {
  const runtime = vm.createContext({}); vm.runInContext(source, runtime);
  const plugin = runtime.createPlugin(); plugin.onLoad(settings);
  const fields = {}, ids = {}; let time = 10000, socket; const timers = [];
  class FakeDate extends Date { static now() { return time; } }
  class FakeWebSocket { constructor() { socket = this; } close() {} }
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; }
    set value(value) { this._value = String(value); } get value() { return this._value; }
    set name(value) { this.fieldName = value; fields[value] = this; } get name() { return this.fieldName; }
    set id(value) { this.elementId = value; ids[value] = this; } get id() { return this.elementId; }
    get parentElement() { return this.parent; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : (this._textContent || ''); }
    set textContent(value) { this.children = []; this._textContent = String(value); }
    focus() { this.focused = true; }
    append(...children) { for (const child of children) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); this.children.push(child); child.parent = this; if (this.tag === 'select' && !this.value) this.value = child.value; } }
    replaceChildren(...children) { this.children = []; this._textContent = ''; this.append(...children); }
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
    setAttribute(key, value) { this[key] = value; }
    insertBefore(child, before) { const index = this.children.indexOf(before); if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parent = this; }
    addEventListener(event, handler) { const old = this.handlers[event]; this.handlers[event] = async (...args) => { await old?.(...args); return handler(...args); }; }
  }
  for (const id of ['settings', 'status', 'save', 'return-settings', 'settings-tabs', 'configuration-summary', 'extension-version', 'check-extension-update', 'approve-extension-update', 'extension-update-status', 'extension-update-dialog', 'extension-update-dialog-title', 'extension-update-dialog-message', 'extension-update-dialog-close', 'extension-update-dialog-confirm']) {
    ids[id] = new Element(id === 'settings' ? 'form' : /close|check-|approve-/.test(id) ? 'button' : 'div'); ids[id].id = id;
  }
  ids['extension-update-dialog'].hidden = true; ids['check-extension-update'].textContent = 'Update';
  ids.settings.elements = { namedItem: key => {
    const input = fields[key];
    for (let element = input; element; element = element.parent) {
      if (element === ids.settings) return input;
    }
    return null;
  } };
  const calls = [], savedSettings = [], calibrationCalls = [], persistedLibraries = [];
  const managed = {
    id: 'calibrated-steam.reaplugin', version: managedVersion, permissions: ['api', 'events.machine'],
    source: { kind: 'github_branch', repo: 'pponce/decentAutoSteamCalculator', branch: sourceBranch, lastError: null }, pendingUpdate,
  };
  let session = null;
  const fetch = async (url, options = {}) => {
    const endpoint = url.split('/').at(-1);
    if (url === '/api/v1/plugins') return { ok: true, text: async () => JSON.stringify([managed]) };
    if (url === 'https://raw.githubusercontent.com/pponce/decentAutoSteamCalculator/main/manifest.json') {
      return checkError
        ? { ok: false, status: 403, statusText: 'Forbidden', text: async () => JSON.stringify({ error: checkError }) }
        : { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ id: 'calibrated-steam.reaplugin', version: remoteVersion, permissions: remotePermissions }) };
    }
    if (url === 'https://raw.githubusercontent.com/pponce/decentAutoSteamCalculator/beta/manifest.json') {
      return checkError
        ? { ok: false, status: 403, statusText: 'Forbidden', text: async () => JSON.stringify({ error: checkError }) }
        : { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ id: 'calibrated-steam.reaplugin', version: betaVersion, permissions: betaPermissions }) };
    }
    if (url === '/api/v1/plugins/install/github-branch') {
      calls.push('github-branch');
      if (updateError) return { ok: false, status: 403, statusText: 'Forbidden', text: async () => JSON.stringify({ error: updateError }) };
      const requested = JSON.parse(options.body);
      managed.source.branch = requested.branch;
      managed.version = requested.branch === 'beta' ? betaVersion : remoteVersion;
      managed.permissions = requested.branch === 'beta' ? betaPermissions : remotePermissions;
      return { ok: true, text: async () => JSON.stringify({ id: managed.id, version: managed.version }) };
    }
    if (url === '/api/v1/plugins/calibrated-steam.reaplugin/update/approve') {
      calls.push('approve'); managed.version = pendingUpdate?.version || remoteVersion; managed.pendingUpdate = null;
      return { ok: true, text: async () => JSON.stringify({ id: managed.id, version: managed.version }) };
    }
    if (url === 'https://api.github.com/rate_limit') return { ok: true, json: async () => ({ resources: { core: { reset: Math.ceil((time + 600000) / 1000) } } }) };
    calls.push(endpoint);
    if (endpoint === 'calibration' && guided) {
      const body = JSON.parse(options.body); calibrationCalls.push(body);
      if (body.action === 'begin') session = { active: true, phase: 'armed', token: 'test', seconds: 0, measurement: body };
      if (body.action === 'heartbeat' && session?.phase === 'complete') session = { ...session, active: false, result: { milkGrams: session.measurement.milkGrams, flow: session.measurement.flow, seconds: 25 } };
      if (body.action === 'cancel') session = { ...session, active: false, phase: 'failed', message: 'Cancelled.' };
      return { ok: true, text: async () => JSON.stringify(session) };
    }
    if (endpoint === 'tare') return { ok: true, text: async () => '' };
    if (endpoint === 'library') {
      persistedLibraries.push(JSON.parse(options.body));
      return { ok: true, text: async () => JSON.stringify({ saved: true }) };
    }
    if (endpoint === 'settings') { savedSettings.push(JSON.parse(options.body)); return { ok: true, text: async () => '{}' }; }
    const response = plugin.__httpRequestHandler({ endpoint, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return { ok: response.status === 200, text: async () => response.body };
  };
  const body = plugin.__httpRequestHandler({ endpoint: 'ui', method: 'GET' }).body;
  const document = { referrer: '', getElementById: id => ids[id], createElement: tag => new Element(tag) };
  const navigations = [];
  const context = vm.createContext({ document, fetch, URL, Date: FakeDate, WebSocket: FakeWebSocket,
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
    window: { addEventListener() {}, location: { href: 'http://localhost:8080/ui', assign: value => navigations.push(value) } } });
  vm.runInContext(body.match(/<script>([\s\S]*)<\/script>/)[1], context);
  await new Promise(resolve => setImmediate(resolve));
  const all = element => [element, ...element.children.flatMap(all)];
  return { fields, ids, calls, savedSettings, calibrationCalls, persistedLibraries, navigations,
    buttons: text => all(ids.settings).filter(item => item.tag === 'button' && item.textContent === text),
    elements: () => all(ids.settings),
    scale(weight) { time += 300; socket.onmessage({ data: JSON.stringify({ weight }) }); },
    async heartbeat() { const callback = timers.shift(); if (callback) await callback(); },
    machineStart() { session.phase = 'steaming'; session.seconds = 3; },
    machinePuffing() { session.phase = 'puffing'; session.seconds = 25; },
    machineStop() { session.phase = 'complete'; session.seconds = 25; },
    change: target => ids.settings.handlers.change({ target }),
    submit: () => ids.settings.handlers.submit({ preventDefault() {} }),
  };
}

test('tabs and compact S M L Auto summary react to draft settings', async () => {
  const p = await page();
  assert.match(source, /id="save" form="settings" type="submit" disabled>Save settings<\/button>/);
  assert.match(source, /'Update saved calibration'/);
  assert.doesNotMatch(source, /id="save"[^>]*>Save calibration<\/button>/);
  assert.equal(p.ids['panel-general'], undefined);
  assert.deepEqual(p.ids['configuration-summary'].children.slice(0, 4).map(item => [item.textContent, item.className]), [
    ['S', 'configured-pitcher'], ['M', 'configured-pitcher'], ['L', 'unconfigured-pitcher'], ['Auto', 'unconfigured-pitcher'],
  ]);
  assert.doesNotMatch(p.ids['configuration-summary'].textContent, /Set flow/);
  p.fields.smallPitcherGrams.value = ''; await p.ids.settings.handlers.input({ target: p.fields.smallPitcherGrams });
  assert.equal(p.ids['configuration-summary'].children[0].className, 'unconfigured-pitcher');
  assert.equal(p.fields.interpolate.checked, false);
  assert.match(p.fields.targetTemperatureC.textContent, /All targets/);
});

test('the page-wide status describes Auto Steam readiness', async () => {
  const ready = await page();
  assert.equal(ready.ids.status.textContent, 'Auto Steam is ready to use.');
  const incomplete = await page({ ...partial, smallPitcherGrams: 0, mediumPitcherGrams: 0, flowReadings: '[]' });
  assert.equal(incomplete.ids.status.textContent, 'Complete the pitcher and calibration setup before using Auto Steam.');
});

test('All targets and a specific Milk target filter exact saved calibrations', async () => {
  const readings = [saved(0.8, 35, 55), saved(1.5, 25, 60)];
  const p = await page({ ...partial, targetTemperatureC: 0, flowReadings: JSON.stringify(readings) });
  assert.equal(p.fields.targetTemperatureC.value, '0');
  assert.match(p.ids['active-calibrations'].textContent, /0\.8 ml\/s/);
  assert.match(p.ids['active-calibrations'].textContent, /1\.5 ml\/s/);
  p.fields.targetTemperatureC.value = '55'; await p.fields.targetTemperatureC.handlers.change();
  assert.match(p.ids['active-calibrations'].textContent, /0\.8 ml\/s/);
  assert.doesNotMatch(p.ids['active-calibrations'].textContent, /1\.5 ml\/s/);
  assert.match(p.ids['other-calibrations'].textContent, /1\.5 ml\/s/);
});

test('turning on Interpolate selects the lowest saved milk target and removes All', async () => {
  const readings = [saved(1.2, 30, 65), saved(0.8, 35, 55)];
  const p = await page({ ...partial, targetTemperatureC: 0, flowReadings: JSON.stringify(readings) });
  p.fields.interpolate.checked = true; await p.fields.interpolate.handlers.change();
  assert.equal(p.fields.targetTemperatureC.value, '55');
  assert.doesNotMatch(p.fields.targetTemperatureC.textContent, /All targets/);
  assert.match(p.fields.targetTemperatureC.textContent, /incomplete/);
});

test('saved calibrations edit inline and persist independently', async () => {
  const p = await page();
  await p.buttons('Edit')[0].handlers.click();
  assert.equal(p.buttons('Cancel').length >= 1, true);
  assert.equal(p.ids['calibration-editor'].parent.className, 'saved-calibration');
  p.fields.referenceSeconds.value = '27'; await p.ids.settings.handlers.input({ target: p.fields.referenceSeconds });
  await p.buttons('Update saved calibration')[0].handlers.click();
  assert.equal(p.ids['calibration-editor'].hidden, true);
  assert.match(p.ids['active-calibrations'].textContent, /27 s/);
  assert.equal(p.persistedLibraries.length, 1);
  await p.buttons('+ New calibration')[0].handlers.click();
  assert.equal(p.buttons('Cancel').length >= 1, true);
  await p.buttons('Cancel')[0].handlers.click();
  assert.equal(p.ids['calibration-editor'].hidden, true);
});

test('closed calibration editor stays form-owned so initialization, tare, edit and delete work', async () => {
  const p = await page();
  assert.doesNotMatch(p.ids.status.textContent, /null/i);
  assert.ok(p.fields.referenceMilkGrams);
  await p.buttons('Tare empty scale')[0].handlers.click();
  assert.doesNotMatch(p.ids.status.textContent, /null/i);
  assert.match(p.ids['panel-pitchers'].textContent, /Waiting for a stable zero/);
  await p.buttons('Edit')[0].handlers.click();
  assert.equal(p.ids['calibration-editor'].hidden, false);
  await p.buttons('Cancel')[0].handlers.click();
  await p.buttons('Delete')[0].handlers.click();
  assert.match(p.ids['active-calibrations'].textContent, /No saved calibrations match/);
  assert.equal(p.persistedLibraries.length, 1);
});

test('compact calibration controls omit inline help retained by instructions and glossary', async () => {
  const p = await page();
  for (const key of ['weightMode', 'temperatureUnit', 'targetTemperatureC']) {
    assert.equal(p.fields[key].parent.children.some(child => child.tag === 'small'), false);
  }
  assert.match(p.ids['panel-instructions'].textContent, /Scale weight mode/);
  assert.match(p.ids['panel-glossary'].textContent, /Display preference for calibration targets/);
});

test('recovered tablet layout keeps quick-reference tabs compact and two-column', async () => {
  const p = await page();
  assert.equal(p.ids['panel-instructions'].className, 'settings-panel');
  assert.equal(p.ids['panel-glossary'].className, 'settings-panel');
  const helpList = p.ids['panel-instructions'].children.find(child => child.className === 'help-list');
  assert.ok(helpList);
  assert.equal(helpList.children.length, 8);
  assert.equal(helpList.children.every(child => child.className === 'help-section'), true);
  const glossary = p.ids['panel-glossary'].children.find(child => child.className === 'glossary');
  assert.ok(glossary);
  assert.equal(glossary.children.length, 14);
  assert.equal(glossary.children.every(child => child.className === 'glossary-term'), true);
  assert.match(source, /#settings-toolbar\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(source, /\.help-list\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /\.glossary\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /@media\(pointer:coarse\)\{button,input,select\{min-height:44px/);
});

test('getting started is a full-width bordered card with a strong heading', async () => {
  const p = await page();
  const card = p.ids['panel-instructions'].children.find(child => child.className === 'getting-started');
  assert.ok(card);
  assert.equal(card.children[0].children[0].tag, 'strong');
  assert.equal(card.children[0].children[0].textContent, 'Getting started:');
  assert.match(source, /\.getting-started\{margin-bottom:9px;padding:10px;border:1px solid var\(--border\)/);
  assert.match(source, /\.getting-started strong\{color:var\(--text\);font-weight:600\}/);
});

test('Pitchers and Calibration use the recovered mockup component structure', async () => {
  const p = await page();
  assert.equal(p.ids['panel-pitchers'].children[0].className, 'panel-intro');
  assert.equal(p.ids['panel-calibration'].children[0].className, 'panel-intro');
  assert.equal(p.fields.smallPitcherGrams.parent.parent.className, 'pitcher-grid full-width');
  assert.equal(p.fields.autoDetect.className, undefined);
  assert.equal(p.fields.autoDetect.parent.className, 'automatic-switch');
  assert.match(source, /#setting-autoDetect\{flex:0 0 30px;width:30px;height:30px/);
  assert.match(source, /\.pitcher-grid\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(source, /\.calibration-library-header\{display:flex/);
  assert.match(source, /header\{display:grid;grid-template-columns:minmax\(0,1fr\);grid-template-areas:"header"/);
  assert.doesNotMatch(source, /\.extension-actions\{grid-column:1\/-1;grid-row:2/);
  assert.match(source, /<div class="extension-title"><h1>Auto Steam Calculator<\/h1><\/div><div class="extension-actions"><span id="extension-version">/);
});

test('inline editor matches the mockup manual and guided states', async () => {
  const p = await page(); await p.buttons('Edit')[0].handlers.click();
  assert.equal(p.buttons('Enter measured time')[0]['aria-pressed'], 'true');
  assert.equal(p.buttons('Guided calibration')[0]['aria-pressed'], 'false');
  const manual = p.elements().find(item => item.className === 'manual-workspace');
  const guided = p.elements().find(item => item.className === 'guided-calibration guided-workspace');
  assert.equal(manual.hidden, false);
  assert.equal(guided.hidden, true);
  assert.doesNotMatch(p.ids['calibration-editor'].textContent, /Steaming: 0\.0 s/);
  assert.match(p.ids['calibration-editor'].textContent, /0\.0 sWaiting for milk capture/);
  await p.buttons('Guided calibration')[0].handlers.click();
  assert.equal(manual.hidden, true);
  assert.equal(guided.hidden, false);
});

test('interpolation editor keeps up and down reading navigation', async () => {
  const settings = { ...partial, interpolate: true, targetTemperatureC: 60, minimumFlow: 0.6, maximumFlow: 2.0, referenceFlow: 0.6,
    flowReadings: JSON.stringify([saved(0.6, 40), saved(1.2, 30), saved(2.0, 20)]) };
  const p = await page(settings); await p.buttons('Edit')[0].handlers.click();
  assert.match(p.ids['calibration-editor'].textContent, /Reading 1 of 3/);
  assert.equal(p.buttons('↑')[0].disabled, true);
  assert.equal(p.buttons('↓')[0].disabled, false);
  await p.buttons('↓')[0].handlers.click();
  assert.match(p.ids['calibration-editor'].textContent, /Reading 2 of 3/);
  assert.equal(p.buttons('↑')[0].disabled, false);
});

test('Interpolate separates out-of-range and different-target readings', async () => {
  const settings = { ...partial, interpolate: true, targetTemperatureC: 60, minimumFlow: 0.6, maximumFlow: 2.0, referenceFlow: 1.2,
    flowReadings: JSON.stringify([saved(0.4, 45), saved(0.6, 40), saved(1.2, 30), saved(2.0, 20), saved(2.4, 18), saved(1.0, 32, 55)]) };
  const p = await page(settings);
  assert.match(p.ids['active-calibrations'].textContent, /0\.6 ml\/s/);
  assert.match(p.ids['active-calibrations'].textContent, /1\.2 ml\/s/);
  assert.match(p.ids['active-calibrations'].textContent, /2\.0 ml\/s/);
  assert.doesNotMatch(p.ids['active-calibrations'].textContent, /0\.4 ml\/s|2\.4 ml\/s|55\.0 °C/);
  assert.match(p.ids['other-calibrations'].textContent, /0\.4 ml\/s/);
  assert.match(p.ids['other-calibrations'].textContent, /2\.4 ml\/s/);
  assert.match(p.ids['other-calibrations'].textContent, /131\.0 °F/);
  assert.equal(p.ids['other-calibrations'].open, undefined);
});

test('interpolation preview browses complete milk targets and saves Smooth curve fit per target', async () => {
  const readings = [
    saved(0.5, 80, 55), saved(1.5, 40, 55), saved(2.5, 32, 55),
    saved(0.5, 60, 60), saved(1.5, 40, 60), saved(2.5, 20, 60),
  ];
  const p = await page({ ...partial, interpolate: true, targetTemperatureC: 60, minimumFlow: 0.5, maximumFlow: 2.5,
    flowReadings: JSON.stringify(readings) });
  assert.equal(p.buttons('Preview interpolation').length, 1);
  await p.buttons('Preview interpolation')[0].handlers.click();
  assert.equal(p.ids['interpolation-preview-dialog'].hidden, false);
  assert.match(p.ids['interpolation-preview-title'].textContent, /140\.0 °F milk target/);
  assert.match(p.ids['interpolation-preview-graph'].innerHTML, /100 g milk/);
  assert.match(p.ids['interpolation-preview-graph'].innerHTML, /Measured reading/);
  await p.buttons('‹')[0].handlers.click();
  assert.match(p.ids['interpolation-preview-title'].textContent, /131\.0 °F milk target/);
  await p.buttons('Use this milk target')[0].handlers.click();
  assert.equal(p.fields.targetTemperatureC.value, '55');
  const smooth = p.elements().find(item => item.parent?.className === 'smooth-curve-option');
  smooth.checked = true; await smooth.handlers.change();
  assert.match(p.ids['interpolation-preview-dialog'].textContent, /safe smooth curve was selected automatically/);
  await p.submit();
  assert.deepEqual(p.persistedLibraries.at(-1).curveFitTargets, [55]);
  assert.equal(p.savedSettings.at(-1).targetTemperatureC, 55);
});

test('Preview interpolation stays hidden for an incomplete selected target', async () => {
  const readings = [saved(0.5, 60, 60), saved(1.5, 40, 60), saved(2.5, 20, 60), saved(1.0, 40, 55)];
  const p = await page({ ...partial, interpolate: true, targetTemperatureC: 55, minimumFlow: 0.5, maximumFlow: 2.5,
    flowReadings: JSON.stringify(readings) });
  assert.equal(p.buttons('Preview interpolation')[0].hidden, true);
});

test('missing interpolation requirements have Create reading buttons that toggle to Cancel', async () => {
  const p = await page({ ...partial, interpolate: true, targetTemperatureC: 0, flowReadings: '[]', referenceMilkGrams: 0, referenceSeconds: 0 });
  assert.equal(p.buttons('Create reading').length, 3);
  await p.buttons('Create reading')[1].handlers.click();
  assert.equal(p.buttons('Cancel').length >= 1, true);
  const flow = p.elements().find(item => item.parent?.className?.includes('editor-flow'));
  assert.equal(flow.value, '1.5');
  assert.match(p.ids['calibration-editor'].textContent, /ml\/s · 0\.4–2\.5/);
  flow.value = '1.3'; await flow.handlers.input();
  assert.equal(flow.value, '1.3');
  await p.buttons('Cancel')[0].handlers.click();
  assert.equal(p.buttons('Create reading').length, 3);
});

test('gross and tared guided modes expose the correct capture experience', async () => {
  const gross = await page(); await gross.buttons('Edit')[0].handlers.click();
  await gross.buttons('Guided calibration')[0].handlers.click();
  assert.equal(gross.buttons('Capture pitcher + milk (g)').length, 1);
  assert.equal(gross.elements().some(item => item.tag === 'select' && item['aria-label'] === 'Calibration pitcher' && !item.parent.hidden), true);
  const tared = await page({ ...partial, weightMode: 'tared' }); await tared.buttons('Edit')[0].handlers.click();
  await tared.buttons('Guided calibration')[0].handlers.click();
  assert.equal(tared.buttons('Capture milk only (g)').length, 1);
  const pitcher = tared.elements().find(item => item.tag === 'select' && item['aria-label'] === 'Calibration pitcher');
  assert.equal(pitcher.parent.hidden, true);
});

test('capture arms calibration and physical machine start/stop completes timing without software start/stop buttons', async () => {
  const p = await page(partial, { guided: true }); await p.buttons('Edit')[0].handlers.click();
  await p.buttons('Guided calibration')[0].handlers.click();
  await p.buttons('Tare')[0].handlers.click(); for (let i = 0; i < 12; i++) p.scale(0); for (let i = 0; i < 12; i++) p.scale(380);
  await p.buttons('Capture pitcher + milk (g)')[0].handlers.click();
  assert.equal(p.calibrationCalls[0].action, 'begin'); assert.equal(p.calibrationCalls[0].milkGrams, 230);
  assert.equal(p.buttons('Start steam').length, 0); assert.equal(p.buttons('Stop steam').length, 0);
  assert.match(p.ids['calibration-editor'].textContent, /Start steam now[\s\S]*140\.0 °F/);
  p.machineStart(); await p.heartbeat();
  p.machinePuffing(); await p.heartbeat();
  assert.match(p.ids['calibration-editor'].textContent, /Steam stopped · finishing purge/);
  p.machineStop(); await p.heartbeat();
  assert.match(p.ids['calibration-editor'].textContent, /Need to try again/);
  assert.equal(p.fields.referenceSeconds.value, '25');
});

test('instructions document matching, interpolation and physical calibration controls', async () => {
  const p = await page();
  assert.match(p.ids['panel-instructions'].textContent, /Leave Interpolate off and create one calibration reading/);
  assert.match(p.ids['panel-instructions'].textContent, /at least three readings/);
  assert.match(p.ids['panel-instructions'].textContent, /every saved reading at the selected milk target inside the selected range/);
  assert.match(p.ids['panel-instructions'].textContent, /More matching readings improve/);
  assert.match(p.ids['panel-instructions'].textContent, /machine controls/);
  assert.match(p.ids['panel-glossary'].textContent, /All targets/);
  assert.match(p.ids['panel-glossary'].textContent, /Smooth curve fit/);
});

test('F is default and changing units converts every display without changing stored Celsius', async () => {
  const p = await page();
  assert.equal(p.fields.temperatureUnit.value, 'F');
  assert.equal(p.fields.targetTemperatureC.value, '60');
  assert.match(p.fields.targetTemperatureC.textContent, /All targets/);
  assert.match(p.fields.targetTemperatureC.parent.children[0].textContent, /Milk target/);
  assert.match(p.ids['active-calibrations'].textContent, /140\.0 °F/);

  p.fields.temperatureUnit.value = 'C'; await p.fields.temperatureUnit.handlers.change();
  assert.equal(p.fields.targetTemperatureC.value, '60');
  assert.match(p.fields.targetTemperatureC.textContent, /60\.0 °C/);
  assert.match(p.ids['active-calibrations'].textContent, /60\.0 °C/);

  p.fields.temperatureUnit.value = 'F'; await p.fields.temperatureUnit.handlers.change();
  assert.equal(p.fields.targetTemperatureC.value, '60');
  assert.match(p.fields.targetTemperatureC.textContent, /140\.0 °F/);
  assert.match(p.ids['active-calibrations'].textContent, /140\.0 °F/);
  p.fields.temperatureUnit.value = 'C'; await p.fields.temperatureUnit.handlers.change();
  await p.submit();
  assert.equal(p.savedSettings[0].temperatureUnit, 'C');
  assert.equal(p.savedSettings[0].targetTemperatureC, 60);
  assert.equal(JSON.parse(p.savedSettings[0].flowReadings)[0].targetTemperatureC, 60);
});

test('incomplete Interpolate setup is blocked with a visible dialog', async () => {
  const p = await page({ ...partial, interpolate: true, targetTemperatureC: 0, flowReadings: '[]' });
  await p.submit();
  assert.deepEqual(p.savedSettings, []);
  assert.match(p.ids.status.textContent, /Choose a milk target/);
  assert.equal(p.ids['extension-update-dialog-title'].textContent, 'Interpolation setup incomplete');
  assert.equal(p.ids['extension-update-dialog'].hidden, false);
});

test('the header hides its update action when the installed extension is current', async () => {
  const p = await page();
  assert.equal(p.ids['extension-version'].textContent, 'Version ' + installedVersion);
  assert.equal(p.ids['check-extension-update'].hidden, true);
  assert.equal(p.ids['approve-extension-update'].hidden, true);
});

test('a newer branch version shows Update and updates only Auto Steam Calculator', async () => {
  const p = await page(partial, { remoteVersion: nextVersion });
  assert.equal(p.ids['extension-version'].textContent, 'Current ' + installedVersion + ' → New ' + nextVersion);
  assert.equal(p.ids['check-extension-update'].hidden, false);
  assert.equal(p.ids['check-extension-update'].textContent, 'Update');
  await p.ids['check-extension-update'].handlers.click();
  assert.ok(p.calls.includes('github-branch'));
  assert.equal(p.calls.includes('update'), false);
  assert.equal(p.ids['extension-update-dialog-message'].textContent, 'Updated to version ' + nextVersion + '. Reopen this page to load the updated interface.');
});

test('new permissions require a named approval before updating', async () => {
  const p = await page(partial, { remoteVersion: nextVersion, remotePermissions: ['api', 'events.machine', 'events.shots'] });
  assert.equal(p.ids['extension-version'].textContent, 'Current ' + installedVersion + ' → New ' + nextVersion);
  assert.equal(p.ids['approve-extension-update'].hidden, false);
  assert.equal(p.ids['approve-extension-update'].textContent, 'Approve & Update');
  await p.ids['approve-extension-update'].handlers.click();
  assert.match(p.ids['extension-update-dialog-message'].textContent, /events\.shots/);
  assert.equal(p.calls.includes('github-branch'), false);
  await p.ids['extension-update-dialog-confirm'].handlers.click();
  assert.ok(p.calls.includes('github-branch'));
});

test('a failed automatic check shows a compact Retry action', async () => {
  const p = await page(partial, { checkError: 'rate limited' });
  assert.equal(p.ids['check-extension-update'].hidden, false);
  assert.equal(p.ids['check-extension-update'].textContent, 'Unable to check · Retry');
  assert.match(p.ids['extension-update-status'].textContent, /Unable to check/);
  assert.equal(p.ids['extension-update-dialog'].hidden, true);
  await p.ids['check-extension-update'].handlers.click();
  assert.equal(p.ids['extension-update-dialog'].hidden, false);
  assert.match(p.ids['extension-update-dialog-message'].textContent, /Try again in 10 minutes/);
});

test('an update failure still reports the GitHub rate-limit wait', async () => {
  const p = await page(partial, { remoteVersion: nextVersion, updateError: 'failed 403' });
  await p.ids['check-extension-update'].handlers.click();
  assert.equal(p.ids['extension-update-dialog'].hidden, false);
  assert.match(p.ids['extension-update-dialog-message'].textContent, /Try again in 10 minutes/);
});

test('stable users can join the extension beta from Instructions', async () => {
  const p = await page();
  assert.match(p.ids['beta-channel-status'].textContent, /Stable channel/);
  assert.match(p.ids['beta-channel-status'].textContent, new RegExp(nextVersion + '-beta\\.1'));
  assert.equal(p.ids['beta-channel-action'].textContent, 'Join beta');
  assert.equal(p.ids['beta-channel-action'].disabled, false);
  await p.ids['beta-channel-action'].handlers.click();
  assert.match(p.ids['extension-update-dialog-message'].textContent, /may be less stable/);
  assert.match(p.ids['extension-update-dialog-message'].textContent, /does not currently allow downgrades/);
  assert.match(p.ids['extension-update-dialog-message'].textContent, /pluginStorage/);
  await p.ids['extension-update-dialog-confirm'].handlers.click();
  assert.match(p.ids['beta-channel-status'].textContent, /Beta channel/);
  assert.equal(p.ids['extension-update-dialog-title'].textContent, 'Beta installed');
});

test('double-digit beta versions compare numerically', async () => {
  const p = await page(partial, { managedVersion: '0.12.11-beta.9', betaVersion: '0.12.11-beta.10' });
  assert.match(p.ids['beta-channel-status'].textContent, /Beta 0\.12\.11-beta\.10 is available/);
  assert.equal(p.ids['beta-channel-action'].disabled, false);
});

test('beta users cannot return while stable would be a downgrade', async () => {
  const betaVersion = nextVersion + '-beta.1';
  const p = await page(partial, { sourceBranch: 'beta', managedVersion: betaVersion, betaVersion });
  assert.match(p.ids['beta-channel-status'].textContent, /Decaid does not allow downgrades/);
  assert.equal(p.ids['beta-channel-action'].textContent, 'Return to stable');
  assert.equal(p.ids['beta-channel-action'].disabled, true);
});

test('beta users can return when stable is equal to or newer than beta', async () => {
  const betaVersion = nextVersion + '-beta.1';
  const p = await page(partial, { sourceBranch: 'beta', managedVersion: betaVersion, betaVersion, remoteVersion: nextVersion });
  assert.equal(p.ids['beta-channel-action'].disabled, false);
  await p.ids['beta-channel-action'].handlers.click();
  assert.match(p.ids['extension-update-dialog-message'].textContent, /leave the beta channel/);
  await p.ids['extension-update-dialog-confirm'].handlers.click();
  assert.match(p.ids['beta-channel-status'].textContent, /Stable channel/);
  assert.equal(p.ids['extension-update-dialog-title'].textContent, 'Stable installed');
});

test('legacy design mockup remains syntactically valid as a visual reference', () => {
  const script = settingsMockup.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(settingsMockup, /Version 0\.12\.7/);
  assert.match(settingsMockup, /id="steam-mock-temperature-unit"/);
  assert.match(settingsMockup, /Other saved calibrations/);
  assert.match(settingsMockup, /item\.flow < minimumFlow[\s\S]*item\.flow > maximumFlow/);
  assert.match(settingsMockup, /Steam stopped · finishing purge…/);
});
