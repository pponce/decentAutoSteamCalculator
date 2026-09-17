function settingsBrowser(resolveReturnUrl, mountCalibration, captureWeight, pitcherChoices, validateConfiguration, mountFlowPlan) {
  const base = '/api/v1/plugins/calibrated-steam.reaplugin';
  const form = document.getElementById('settings');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const back = document.getElementById('return-settings');
  const tabs = document.getElementById('settings-tabs');
  const summary = document.getElementById('configuration-summary');
  const extensionVersion = document.getElementById('extension-version');
  const checkUpdate = document.getElementById('check-extension-update');
  const approveUpdate = document.getElementById('approve-extension-update');
  const updateStatus = document.getElementById('extension-update-status');
  const updateDialog = document.getElementById('extension-update-dialog');
  const updateDialogTitle = document.getElementById('extension-update-dialog-title');
  const updateDialogMessage = document.getElementById('extension-update-dialog-message');
  const updateDialogClose = document.getElementById('extension-update-dialog-close');
  back.href = resolveReturnUrl(window.location.href, document.referrer);
  form.noValidate = true;
  let schema = {}, guided = null, loaded = false, flowValue = null, flowPlan = null, installedVersion = '';
  const panels = {}, tabButtons = {}, labels = {}, fieldPanels = {};
  const tabDefinitions = [['pitchers', 'Pitchers & Auto'], ['calibration', 'Calibration'], ['instructions', 'Instructions'], ['glossary', 'Glossary']];
  const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  const field = key => form.elements.namedItem(key);
  const values = () => Object.fromEntries(Object.entries(schema).map(([key, item]) => {
    const input = field(key);
    const number = input.value.trim() === '' ? 0 : Number(input.value);
    return [key, item.type === 'boolean' ? input.checked : item.type === 'number'
      ? (key === 'targetTemperatureC' && number !== 0 ? temperatureToC(number, field('temperatureUnit')?.value || 'F') : number)
      : input.value];
  }));
  function showTab(name) {
    for (const key of Object.keys(panels)) {
      panels[key].hidden = key !== name;
      tabButtons[key].setAttribute('aria-selected', String(key === name));
      tabButtons[key].tabIndex = key === name ? 0 : -1;
    }
  }
  function reveal(key) {
    showTab(fieldPanels[key] || (key === 'pitchers' ? 'pitchers' : 'calibration'));
    if (fieldPanels[key] === 'calibration') flowPlan?.reveal(key);
    const details = field(key)?.closest('details');
    if (details) details.open = true;
    field(key)?.focus();
  }
  async function request(path, options) {
    const response = await fetch(path, options);
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) throw Object.assign(new Error(data.message || data.error || (data.errors || []).map(error => error.message).join(' ') || 'Request failed.'), { data });
    return data;
  }
  async function pluginRecord() {
    const plugins = await request('/api/v1/plugins');
    return Array.isArray(plugins) ? plugins.find(plugin => plugin.id === 'calibrated-steam.reaplugin') : null;
  }
  function showUpdateDialog(title, message) {
    updateDialogTitle.textContent = title;
    updateDialogMessage.textContent = message;
    updateStatus.textContent = title + ': ' + message;
    updateDialog.hidden = false;
    updateDialogClose.focus();
  }
  function closeUpdateDialog() { updateDialog.hidden = true; }
  updateDialogClose.addEventListener('click', closeUpdateDialog);
  updateDialog.addEventListener('click', event => { if (event.target === updateDialog) closeUpdateDialog(); });
  async function updateFailureMessage(error) {
    const message = error?.message || String(error || 'The update failed.');
    if (!/\b403\b/.test(message)) return message;
    try {
      const response = await fetch('https://api.github.com/rate_limit', { headers: { accept: 'application/vnd.github+json' } });
      const data = await response.json();
      const reset = Number(data?.resources?.core?.reset);
      if (Number.isFinite(reset)) {
        const minutes = Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000));
        return "GitHub's unauthenticated update limit has been reached. Try again in " + minutes + ' minute' + (minutes === 1 ? '' : 's') + '.';
      }
    } catch {}
    return "GitHub's unauthenticated update limit has been reached. Try again in about 60 minutes.";
  }
  function paintUpdateState(plugin) {
    const version = plugin?.version || installedVersion;
    extensionVersion.textContent = 'Version ' + version;
    checkUpdate.hidden = false; approveUpdate.hidden = true;
    if (!plugin) {
      checkUpdate.disabled = true;
      updateStatus.textContent = 'Extension update controls are unavailable in this Decaid version.';
      return;
    }
    const managed = ['github_release', 'github_branch'].includes(plugin.source?.kind);
    checkUpdate.disabled = !managed;
    if (!managed) {
      updateStatus.textContent = 'Install this extension from its GitHub release or branch to enable updates.';
      return;
    }
    if (plugin.pendingUpdate) {
      const added = plugin.pendingUpdate.addedPermissions || [];
      updateStatus.textContent = 'Version ' + plugin.pendingUpdate.version + ' needs approval' + (added.length ? ' because it adds: ' + added.join(', ') : '') + '.';
      approveUpdate.textContent = 'Approve and update to ' + plugin.pendingUpdate.version;
      checkUpdate.hidden = true; approveUpdate.hidden = false;
      return;
    }
    if (plugin.source?.lastError) {
      updateStatus.textContent = 'Last update check failed: ' + plugin.source.lastError;
      return;
    }
    updateStatus.textContent = 'Decaid can check all GitHub-backed extensions and install compatible updates while preserving saved settings.';
  }
  async function refreshUpdateState() {
    try {
      const plugin = await pluginRecord(); paintUpdateState(plugin); return plugin;
    } catch {
      paintUpdateState(null); return null;
    }
  }
  checkUpdate.addEventListener('click', async () => {
    checkUpdate.disabled = true; approveUpdate.hidden = true;
    checkUpdate.textContent = 'Checking…';
    updateStatus.textContent = 'Checking all GitHub-backed extensions… Compatible updates install automatically.';
    try {
      const before = installedVersion;
      await request('/api/v1/plugins/update', { method: 'POST' });
      const plugin = await refreshUpdateState();
      if (plugin?.source?.lastError) {
        showUpdateDialog('Update failed', await updateFailureMessage(plugin.source.lastError));
      } else if (plugin?.version && plugin.version !== before) {
        installedVersion = plugin.version;
        extensionVersion.textContent = 'Version ' + plugin.version;
        showUpdateDialog('Extension updated', 'Updated to version ' + plugin.version + '. Reopen this page to load the updated interface.');
      } else if (plugin?.pendingUpdate) {
        showUpdateDialog('Approval required', updateStatus.textContent);
      } else if (plugin && !plugin.pendingUpdate && !plugin.source?.lastError) {
        showUpdateDialog('Extension is up to date', 'Version ' + installedVersion + ' is the latest available version.');
      }
    } catch (error) {
      showUpdateDialog('Update failed', await updateFailureMessage(error));
    } finally {
      checkUpdate.textContent = 'Check & Update'; checkUpdate.disabled = false;
    }
  });
  approveUpdate.addEventListener('click', async () => {
    approveUpdate.disabled = true; checkUpdate.disabled = true;
    updateStatus.textContent = 'Installing the approved update…';
    try {
      await request('/api/v1/plugins/calibrated-steam.reaplugin/update/approve', { method: 'POST' });
      const plugin = await refreshUpdateState();
      if (plugin?.version) {
        installedVersion = plugin.version;
        extensionVersion.textContent = 'Version ' + plugin.version;
        showUpdateDialog('Extension updated', 'Updated to version ' + plugin.version + '. Reopen this page to load the updated interface.');
      }
    } catch (error) {
      showUpdateDialog('Update failed', await updateFailureMessage(error));
    } finally {
      approveUpdate.disabled = false; checkUpdate.disabled = false;
    }
  });
  function updateChoices() {
    const current = values();
    document.getElementById('automatic-fields').hidden = !current.autoDetect;
    for (const key of ['singleDrinkGrams', 'singleDrinkPitcher']) field(key).required = current.autoDetect;
    const choices = pitcherChoices(current);
    const names = { small: 'S', medium: 'M', large: 'L', auto: 'Auto' };
    const descriptions = { small: 'Small', medium: 'Medium', large: 'Large', auto: 'Auto' };
    summary.replaceChildren();
    for (const choice of Object.keys(names)) {
      const configured = choices.includes(choice);
      const badge = make('span', names[choice]);
      badge.className = configured ? 'configured-pitcher' : 'unconfigured-pitcher';
      badge.setAttribute('aria-label', descriptions[choice] + (configured ? ' configured' : ' not configured'));
      summary.append(badge);
    }
    if (current.calibrationMode !== 'multiple') {
      const flow = Number(current.referenceFlow);
      const flowSummary = make('span', 'Set flow: ' + (Number.isFinite(flow) && flow >= 0.4 && flow <= 2.5 ? flow.toFixed(1) + ' ml/s' : '—'));
      flowSummary.className = 'configuration-flow'; summary.append(flowSummary);
    }
  }
  function syncFlow(value, measured = false) {
    const changed = Number(value) !== Number(flowValue);
    field('referenceFlow').value = value;
    const mirror = document.getElementById('calibration-flow');
    if (mirror) mirror.value = value;
    flowValue = String(value);
    if (changed && !measured && field('calibrationMode').value !== 'multiple') {
      field('referenceSeconds').value = '';
      status.textContent = 'Flow changed. Measure a new calibration time at this flow.';
      guided?.flowChanged();
    }
    if (changed) flowPlan?.flowChanged();
    updateChoices();
  }
  async function load() {
    try {
      const data = await request(base + '/status'); schema = data.schema; installedVersion = data.version;
      extensionVersion.textContent = 'Version ' + data.version;
      for (const [name, title] of tabDefinitions) {
        const button = make('button', title); button.type = 'button'; button.id = 'tab-' + name;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'panel-' + name);
        button.addEventListener('click', () => showTab(name));
        button.addEventListener('keydown', event => {
          const names = tabDefinitions.map(([key]) => key), index = names.indexOf(name);
          const next = event.key === 'ArrowRight' ? names[(index + 1) % names.length] : event.key === 'ArrowLeft' ? names[(index + names.length - 1) % names.length] : null;
          if (next) { event.preventDefault(); showTab(next); tabButtons[next].focus(); }
        });
        tabs.append(button); tabButtons[name] = button;
        const panel = make('section'); panel.id = 'panel-' + name; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
        form.append(panel); panels[name] = panel;
      }
      const groups = [
        ['pitchers', 'Empty pitcher weights', ['smallPitcherGrams', 'mediumPitcherGrams', 'largePitcherGrams']],
        ['pitchers', 'Automatic pitcher selection', ['autoDetect', 'singleDrinkGrams', 'singleDrinkPitcher']],
        ['calibration', '', ['weightMode', 'temperatureUnit', 'targetTemperatureC', 'minimumFlow', 'maximumFlow', 'referenceMilkGrams', 'referenceSeconds']],
      ];
      const captions = { smallPitcherGrams: 'Small (g)', mediumPitcherGrams: 'Medium (g)', largePitcherGrams: 'Large (g)', weightMode: 'Scale weight Mode' };
      const hints = { smallPitcherGrams: 'Empty pitcher. Blank means unused.', mediumPitcherGrams: 'Empty pitcher. Blank means unused.', largePitcherGrams: 'Empty pitcher. Blank means unused.', weightMode: 'One global choice for single and multiple calibration. Gross: pitcher + milk. Tared: milk only.' };
      const noInlineHelp = new Set(['weightMode', 'temperatureUnit', 'targetTemperatureC']);
      for (const [panelName, heading, keys] of groups) {
        const section = make('fieldset'); if (heading) section.append(make('legend', heading)); panels[panelName].append(section);
        let automaticFields;
        if (keys.includes('autoDetect')) {
          automaticFields = make('div'); automaticFields.id = 'automatic-fields'; automaticFields.className = 'field-grid';
        }
        for (const key of keys) {
          const item = schema[key]; if (!item) continue;
          const wrapper = make('div'); wrapper.className = key.endsWith('PitcherGrams') ? 'field pitcher-field' : 'field';
          const label = make('label', captions[key] || item.label); label.htmlFor = 'setting-' + key; wrapper.append(label);
          const input = make(item.type === 'enum' ? 'select' : 'input'); input.name = key; input.id = 'setting-' + key;
          if (item.type === 'enum') {
            for (const choice of item.values) {
              const display = key === 'weightMode' && choice ? choice[0].toUpperCase() + choice.slice(1) : (choice || 'Choose a pitcher');
              const option = make('option', display); option.value = choice; input.append(option);
            }
          } else if (item.type === 'boolean') { input.type = 'checkbox'; input.checked = data.settings[key] === true; }
          else {
            input.type = 'number'; input.step = 'any'; input.inputMode = 'decimal'; input.min = '0';
            if (['referenceFlow', 'minimumFlow', 'maximumFlow'].includes(key)) { input.min = '0.4'; input.max = '2.5'; input.step = '0.1'; }
            if (key === 'targetTemperatureC') { input.max = '100'; input.min = '0.1'; input.required = true; }
          }
          if (item.type !== 'boolean') {
            const savedValue = data.settings[key];
            input.value = item.type === 'number' && savedValue === 0 ? ''
              : key === 'targetTemperatureC' ? temperatureFromC(savedValue, data.settings.temperatureUnit || 'F') : savedValue;
          }
          wrapper.append(input);
          if (!noInlineHelp.has(key)) wrapper.append(make('small', hints[key] || item.description));
          if (automaticFields && key !== 'autoDetect') automaticFields.append(wrapper); else section.append(wrapper);
          labels[key] = wrapper; fieldPanels[key] = panelName;
        }
        if (automaticFields) section.append(automaticFields);
      }
      const instructions = [
        ['1 · Configure pitchers', 'In Pitchers & Auto, enter at least one empty pitcher weight. To measure it, tare the empty scale, wait for stable zero, place the empty pitcher, then select its Set from scale button. Your skin can remember the pitcher preset you use on the shot page.'],
        ['2 · Choose how milk is weighed', 'In Calibration, choose one Scale weight mode for both single- and multiple-flow calculations. Gross means the scale shows pitcher plus milk; Tared means it shows milk only. Automatic pitcher selection requires Gross, all three pitcher weights, usual milk per drink and the Small or Medium pitcher normally used for one drink.'],
        ['3 · Plan calibration', 'Choose Fahrenheit or Celsius for display, then enter the required target temperature. The preference is remembered, while saved calibration temperatures remain stored internally in Celsius. Single uses the one saved reading checked as Default. Multiple uses every saved reading at the equivalent target temperature inside the selected range. It requires the exact minimum, exact maximum, and at least one interior reading; a reading near the middle is recommended. More matching readings improve the estimate between measured flows.'],
        ['4 · Measure manually or with guidance', 'For manual entry, enter the actual milk-only weight and steaming time. For guided Gross mode, tare the empty scale, choose the pitcher, then capture pitcher plus milk. For Tared mode, tare with the empty pitcher on the scale, then capture milk only. Capture arms timing; start and stop steam with the machine controls. The counter excludes warm-up and stops when the machine stops steaming.'],
        ['5 · Review and save', 'Edit opens one calibration directly below its saved row; Update saved flow closes it. Create reading changes to Cancel while open. Deleting a Multiple reading makes the set incomplete until the missing minimum, maximum or interior reading is recreated, or you switch to Single. Other saved calibrations remain stored for later use.'],
        ['6 · Make a drink', 'Select Auto in the shot-page steam controls, weigh the filled pitcher and tap its S, M, L or Auto preset. Tapping the same preset again recalculates for the new milk. Check the calculated time before starting steam. Single flow is fixed; multiple-flow calibration allows flow changes within its measured range, followed by a new calculation. Manual Flow and Time remain available. Off reminds you to calculate; it is not a hard start interlock.'],
      ];
      for (const [heading, text] of instructions) {
        const section = make('section'); section.className = 'help-section';
        section.append(make('h2', heading), make('p', text)); panels.instructions.append(section);
      }
      const glossary = make('dl'); glossary.className = 'glossary';
      const glossaryKeys = ['referenceFlow', 'weightMode', 'temperatureUnit', 'smallPitcherGrams', 'mediumPitcherGrams', 'largePitcherGrams', 'autoDetect', 'singleDrinkGrams', 'singleDrinkPitcher', 'calibrationMode', 'targetTemperatureC', 'referenceMilkGrams', 'referenceSeconds'];
      for (const key of glossaryKeys) glossary.append(make('dt', schema[key].label), make('dd', schema[key].description));
      for (const [term, meaning] of [
        ['Minimum / maximum flow', 'Multiple uses all saved readings at the selected target temperature inside this range. Readings outside the range are kept under Other saved calibrations.'],
        ['Saved calibrations', 'Each flow and target-temperature pair is unique. Multiple requires at least three matching readings: exact minimum, exact maximum, and an interior reading. More matching readings are all used for piecewise interpolation.'],
        ['S / M / L / Auto', 'Green means that choice is configured; red means it is not. Some skins do not use Auto pitcher selection, so it is off by default.'],
        ['Tare / capture', 'Gross: tare an empty scale and capture pitcher plus milk; the selected pitcher weight is subtracted. Tared: tare with the empty pitcher on the scale and capture milk only.'],
      ]) glossary.append(make('dt', term), make('dd', meaning));
      panels.glossary.append(glossary);
      for (const key of ['referenceFlow', 'calibrationMode', 'flowReadings']) {
        const input = make('input'); input.type = 'hidden'; input.name = key; input.value = data.settings[key];
        form.append(input); fieldPanels[key] = 'calibration';
      }
      flowValue = String(field('referenceFlow').value);
      form.addEventListener('input', event => {
        if (event.target === field('referenceFlow')) syncFlow(event.target.value);
        else updateChoices();
      });
      form.addEventListener('change', updateChoices);
      updateChoices(); showTab('pitchers'); loaded = true; save.disabled = false;
      status.textContent = data.ready ? 'Calibration is ready.' : 'Configure a pitcher and calibration before using Auto steam.';
      flowPlan = mountFlowPlan({ form, labels, field, updateChoices, syncFlow }, { calibrationLibrary, partitionFlowReadings, multipleCalibrationRequirements, calibrationKey, validFlowReading, temperatureToC, temperatureFromC, formatTemperature });
      guided = mountCalibration({ form, labels, save, back, status, request, base, field, updateChoices, syncFlow, flowPlan }, captureWeight);
      await refreshUpdateState();
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!loaded) return;
    save.disabled = true;
    try {
      guided?.assertCanSave();
      flowPlan?.assertCanSave();
      const errors = validateConfiguration(values());
      if (errors.length) { reveal(errors[0].field); throw new Error(errors.map(error => error.message).join(' ')); }
      const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values()) };
      await request(base + '/validate', options); await request(base + '/settings', options);
      window.location.assign(back.href);
    } catch (error) {
      if (error.data?.errors?.length) reveal(error.data.errors[0].field);
      if (error.field) reveal(error.field);
      status.textContent = error.message;
    } finally { save.disabled = guided?.isActive() || false; }
  });
  load();
}

function settingsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auto Steam Calculator</title>
<style>
:root{color-scheme:light dark;--bg:#f3f5f9;--surface:#fff;--text:#26334a;--muted:#526179;--border:#ccd5e2;--accent:#385a92;--notice:#eef3fb;--configured-bg:#def4e4;--configured-text:#24533a;--unconfigured-bg:#fde8e8;--unconfigured-text:#8f2929;font:14px/1.45 system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#172132;--surface:#202b3e;--text:#e4eaf4;--muted:#b6c1d4;--border:#465166;--accent:#456faf;--notice:#2c3c55;--configured-bg:#234136;--configured-text:#bde4ca;--unconfigured-bg:#512d32;--unconfigured-text:#ffc2c2}}
*{box-sizing:border-box}body{max-width:940px;margin:auto;padding:16px;background:var(--bg);color:var(--text)}header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center}h1{font-size:22px;font-weight:600;margin:0}h2{font-size:16px;margin:0}p{margin:10px 0}button,a,input,select{touch-action:manipulation}button,input,select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;min-height:44px}input,select{font-size:16px;min-width:0;width:100%}input[type=checkbox]{width:24px;height:24px;min-height:24px;accent-color:var(--accent)}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}a{color:var(--accent)}#return-settings{display:inline-block;padding:10px 14px;min-height:44px;text-decoration:none;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.extension-title{min-width:0}.extension-title h1{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#extension-version{display:block;color:var(--muted)}.extension-actions{display:flex;gap:8px;justify-content:flex-end}.extension-actions button{white-space:nowrap}.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.update-dialog{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.55)}.update-dialog-card{width:min(460px,100%);padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface);box-shadow:0 12px 40px rgba(0,0,0,.35)}.update-dialog-card p{color:var(--muted);overflow-wrap:anywhere}.update-dialog-card button{float:right;min-width:80px;background:var(--accent);color:#fff;border-color:transparent}#settings-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0}#configuration-summary{display:flex;align-items:center;gap:6px;color:var(--muted);margin:0 0 0 auto;white-space:nowrap}.configured-pitcher,.unconfigured-pitcher{display:inline-block;padding:5px 10px;border-radius:7px}.configured-pitcher{background:var(--configured-bg);color:var(--configured-text)}.unconfigured-pitcher{background:var(--unconfigured-bg);color:var(--unconfigured-text)}.configuration-flow{margin-left:6px}#settings-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0}#settings-tabs [aria-selected=true],button[aria-pressed=true],#save{background:var(--accent);color:#fff;border-color:transparent}[hidden]{display:none!important}fieldset{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:14px;margin:0 0 14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}legend{font-size:16px;font-weight:600;padding:0 5px}.field{display:grid;gap:6px;align-content:start}.field label{font-weight:500}.field small{color:var(--muted)}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;grid-column:1/-1}.pitcher-field{grid-column:1/-1;grid-template-columns:95px minmax(90px,1fr) auto;align-items:center;border-top:1px solid var(--border);padding-top:12px}.pitcher-field small{grid-column:2/-1}.pitcher-field .capture-button{grid-column:3;grid-row:1}.pitcher-field .capture-result{grid-column:1/-1;margin:0}.full-width{grid-column:1/-1}.scale-tools{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap}.scale-tools p{margin:0}.local-status{background:var(--notice);padding:9px 11px;border-radius:6px;overflow-wrap:anywhere}.guided-calibration{display:block}.calibration-actions{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.calibration-timer{font-size:28px;font-variant-numeric:tabular-nums}.calibration-flow{max-width:220px;margin-bottom:12px}.guided-step{padding:12px 0;border-top:1px solid var(--border)}#status{min-height:1.5em;overflow-wrap:anywhere}.save-row{display:flex;align-items:center;gap:14px;justify-content:space-between;flex-wrap:wrap}footer{font-size:12px;color:var(--muted);margin-top:14px}details{margin-top:12px}summary{cursor:pointer;min-height:44px;padding:10px 0}
.help-section{padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);margin-bottom:12px}.help-section p{margin-bottom:0}.glossary{margin:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px}.glossary dt{font-weight:600;margin-top:14px}.glossary dt:first-child{margin-top:0}.glossary dd{margin:4px 0 12px;color:var(--muted)}.calibration-config-grid{display:grid;grid-template-columns:1.25fr .65fr 1fr 1.25fr;gap:14px}.flow-support{align-self:end}.flow-support .calibration-actions{margin:4px 0 0}.saved-calibration{border:1px solid var(--border);border-radius:9px;background:var(--surface);margin:8px 0;overflow:hidden}.saved-calibration-row{display:flex;gap:8px;align-items:center;padding:9px}.saved-calibration-row>span{flex:1}.saved-calibration-row button{min-height:38px;padding:7px 10px}.default-choice{display:flex;align-items:center;gap:5px}.default-choice input{width:22px}.calibration-editor{padding:12px;border-top:1px solid var(--border);background:var(--notice)}.editor-header{display:flex;align-items:end;justify-content:space-between;gap:10px}.editor-flow{width:120px}.reading-arrow{text-align:center;font-size:20px;color:var(--muted);line-height:1}.missing-calibration{border-style:dashed}#other-calibrations{border:1px solid var(--border);border-radius:9px;padding:0 10px;margin-bottom:14px}#panel-pitchers>fieldset:first-child{grid-template-columns:repeat(3,minmax(0,1fr))}#panel-pitchers>fieldset:first-child .pitcher-field{grid-column:auto;grid-template-columns:1fr}#panel-pitchers>fieldset:first-child .pitcher-field small,#panel-pitchers>fieldset:first-child .pitcher-field .capture-button{grid-column:1;grid-row:auto}
@media(max-width:720px){.calibration-config-grid{grid-template-columns:1.15fr .65fr 1fr}.calibration-config-grid .flow-support{grid-column:1/-1}}
@media(max-width:480px){body{padding:12px}header{gap:8px}h1{font-size:18px}#return-settings,.extension-actions button{padding:8px;font-size:13px}fieldset,.field-grid,.calibration-config-grid,#panel-pitchers>fieldset:first-child{grid-template-columns:1fr}.pitcher-field{grid-template-columns:65px minmax(60px,1fr)}.pitcher-field .capture-button{grid-column:2;grid-row:auto}.pitcher-field small{grid-column:1/-1}.saved-calibration-row{align-items:stretch;flex-wrap:wrap}.saved-calibration-row>span{flex-basis:100%}.editor-header{align-items:stretch;flex-wrap:wrap}.editor-flow{width:100%}}
</style></head><body>
<header><a id="return-settings" href="/api/v1/plugins/settings.reaplugin/ui">← Settings</a><div class="extension-title"><h1>Auto Steam Calculator</h1><span id="extension-version">Version …</span></div><div class="extension-actions"><button id="check-extension-update" type="button" disabled>Check &amp; Update</button><button id="approve-extension-update" type="button" hidden>Approve Update</button></div></header>
<p id="extension-update-status" class="visually-hidden" role="status" aria-live="polite">Loading update status…</p>
<div id="extension-update-dialog" class="update-dialog" hidden><section class="update-dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="extension-update-dialog-title" aria-describedby="extension-update-dialog-message"><h2 id="extension-update-dialog-title">Extension update</h2><p id="extension-update-dialog-message"></p><button id="extension-update-dialog-close" type="button">OK</button></section></div>
<div id="settings-toolbar"><nav id="settings-tabs" role="tablist" aria-label="Auto Steam settings"></nav><p id="configuration-summary" role="status" aria-live="polite">Loading configuration…</p></div>
<form id="settings" novalidate></form>
<div class="save-row"><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save calibration</button></div>
<footer>Calculation and automatic pitcher detection inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. Implementation for Decaid by pponce.</footer>
<script>{const FLOW_MINIMUM=0.4,FLOW_MAXIMUM=2.5,MAX_READINGS=100;const close=(a,b)=>Math.abs(Number(a)-Number(b))<0.000001;const targetFor=settings=>Number(settings.targetTemperatureC)>0?Number(settings.targetTemperatureC):60;${temperatureToC.toString()}\n${temperatureFromC.toString()}\n${formatTemperature.toString()}\n${readFlowReadings.toString()}\n${validFlowReading.toString()}\n${calibrationKey.toString()}\n${calibrationLibrary.toString()}\n${partitionFlowReadings.toString()}\n${multipleCalibrationRequirements.toString()}\n${validateFlowCalibration.toString()}\n${configuredPitchers.toString()}\n${availablePitchers.toString()}\n${validateSettings.toString()}\n(${settingsBrowser.toString()})(${settingsReturnUrl.toString()},${mountCalibrationPage.toString()},${captureScaleWeight.toString()},availablePitchers,validateSettings,${mountFlowCalibrationPage.toString()});}</script></body></html>`;
}
