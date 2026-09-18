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
  const updateDialogConfirm = document.getElementById('extension-update-dialog-confirm');
  const extensionRepo = 'pponce/decentAutoSteamCalculator';
  const stableBranch = 'main';
  const betaBranch = 'beta';
  back.href = resolveReturnUrl(window.location.href, document.referrer);
  form.noValidate = true;
  let schema = {}, guided = null, loaded = false, flowValue = null, flowPlan = null, installedVersion = '';
  let currentPlugin = null, updateCandidate = null, updateDialogAction = null;
  let betaChannelStatus = null, betaChannelButton = null, betaChannelAction = null;
  const panels = {}, tabButtons = {}, labels = {}, fieldPanels = {};
  const tabDefinitions = [['pitchers', 'Pitchers & Auto'], ['calibration', 'Calibration'], ['instructions', 'Instructions'], ['glossary', 'Glossary']];
  const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  const field = key => form.elements.namedItem(key);
  const values = () => Object.fromEntries(Object.entries(schema).map(([key, item]) => {
    const input = field(key);
    const number = input.value.trim() === '' ? 0 : Number(input.value);
    return [key, item.type === 'boolean' ? input.checked : item.type === 'number'
      ? number
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
  function showUpdateDialog(title, message, confirmLabel = '', action = null) {
    updateDialogTitle.textContent = title;
    updateDialogMessage.textContent = message;
    updateStatus.textContent = title + ': ' + message;
    updateDialogAction = action;
    updateDialogConfirm.hidden = !action;
    updateDialogConfirm.textContent = confirmLabel;
    updateDialogClose.textContent = action ? 'Cancel' : 'OK';
    updateDialog.hidden = false;
    (action ? updateDialogConfirm : updateDialogClose).focus();
  }
  function closeUpdateDialog() { updateDialog.hidden = true; updateDialogAction = null; }
  updateDialogClose.addEventListener('click', closeUpdateDialog);
  updateDialog.addEventListener('click', event => { if (event.target === updateDialog) closeUpdateDialog(); });
  updateDialogConfirm.addEventListener('click', async () => {
    const action = updateDialogAction;
    closeUpdateDialog();
    if (action) await action();
  });
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
  function compareVersions(left, right) {
    const parse = value => {
      const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
      return match ? { core: match.slice(1, 4).map(Number), prerelease: match[4] || '' } : null;
    };
    const a = parse(left), b = parse(right);
    if (!a || !b) throw new Error('The extension returned an invalid version.');
    for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
    if (a.prerelease === b.prerelease) return 0;
    if (!a.prerelease || !b.prerelease) return a.prerelease ? -1 : 1;
    const aParts = a.prerelease.split('.'), bParts = b.prerelease.split('.');
    for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
      if (aParts[index] === undefined) return -1;
      if (bParts[index] === undefined) return 1;
      if (aParts[index] === bParts[index]) continue;
      const aNumber = /^\d+$/.test(aParts[index]), bNumber = /^\d+$/.test(bParts[index]);
      if (aNumber && bNumber) return Number(aParts[index]) < Number(bParts[index]) ? -1 : 1;
      if (aNumber !== bNumber) return aNumber ? -1 : 1;
      return aParts[index] < bParts[index] ? -1 : 1;
    }
    return 0;
  }
  function branchManifestUrl(repo, branch) {
    repo = String(repo || ''); branch = String(branch || '');
    const parts = repo.split('/');
    if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part)) || !/^[A-Za-z0-9_.\/-]+$/.test(branch)) return null;
    return 'https://raw.githubusercontent.com/' + parts.map(encodeURIComponent).join('/') + '/' + branch.split('/').map(encodeURIComponent).join('/') + '/manifest.json';
  }
  async function repositoryManifest(repo, branch) {
    const url = branchManifestUrl(repo, branch);
    if (!url) throw new Error('Automatic update checks require a GitHub branch installation.');
    const response = await fetch(url, { cache: 'no-store' });
    const text = await response.text();
    let manifest;
    try { manifest = text ? JSON.parse(text) : {}; } catch { manifest = {}; }
    if (!response.ok) throw new Error('GitHub returned ' + response.status + ' ' + response.statusText + '.');
    if (manifest.id !== 'calibrated-steam.reaplugin' || !manifest.version) throw new Error('GitHub returned an invalid Auto Steam Calculator manifest.');
    return manifest;
  }
  function branchManifest(plugin) {
    const source = plugin?.source;
    if (source?.kind !== 'github_branch') throw new Error('Automatic update checks require a GitHub branch installation.');
    return repositoryManifest(source.repo, source.branch);
  }
  function paintBetaChannel(plugin, { manifest = null, error = null, checking = false } = {}) {
    if (!betaChannelStatus || !betaChannelButton) return;
    betaChannelAction = null;
    betaChannelButton.hidden = false;
    betaChannelButton.disabled = true;
    const source = plugin?.source;
    const version = plugin?.version || installedVersion;
    if (!plugin || source?.kind !== 'github_branch' || source.repo !== extensionRepo || ![stableBranch, betaBranch].includes(source.branch)) {
      betaChannelButton.hidden = true;
      betaChannelStatus.textContent = 'Beta enrollment is available after installing this extension from its official main or beta GitHub branch.';
      return;
    }
    const onBeta = source.branch === betaBranch;
    betaChannelButton.textContent = onBeta ? 'Return to stable' : 'Join beta';
    if (plugin.pendingUpdate) {
      betaChannelStatus.textContent = 'Finish the pending extension update before changing release channels.';
      return;
    }
    if (checking) {
      betaChannelStatus.textContent = 'Checking the ' + (onBeta ? 'stable' : 'beta') + ' channel…';
      return;
    }
    if (error) {
      betaChannelButton.textContent = 'Unable to check · Retry';
      betaChannelButton.disabled = false;
      betaChannelAction = { retry: true };
      betaChannelStatus.textContent = 'Unable to check the ' + (onBeta ? 'stable' : 'beta') + ' channel: ' + (error.message || error);
      return;
    }
    if (!manifest) return;
    if (onBeta) {
      const canReturn = compareVersions(manifest.version, version) >= 0;
      betaChannelStatus.textContent = canReturn
        ? 'Beta channel · Version ' + version + '. Stable ' + manifest.version + ' is available.'
        : 'Beta channel · Version ' + version + '. Stable is currently ' + manifest.version + '. Decaid does not allow downgrades, so you can return when a stable release is equal to or newer than this beta.';
      betaChannelButton.disabled = !canReturn;
      if (canReturn) betaChannelAction = { branch: stableBranch, manifest, addedPermissions: [] };
      return;
    }
    const betaAvailable = compareVersions(version, manifest.version) < 0;
    betaChannelStatus.textContent = betaAvailable
      ? 'Stable channel · Version ' + version + '. Beta ' + manifest.version + ' is available for testing.'
      : 'Stable channel · Version ' + version + '. No newer beta is currently available.';
    betaChannelButton.disabled = !betaAvailable;
    if (betaAvailable) {
      const installedPermissions = new Set(plugin.permissions || []);
      const addedPermissions = (manifest.permissions || []).filter(permission => !installedPermissions.has(permission));
      betaChannelAction = { branch: betaBranch, manifest, addedPermissions };
    }
  }
  async function refreshBetaChannel(plugin = currentPlugin, showFailure = false) {
    if (!plugin) { paintBetaChannel(null); return; }
    const onBeta = plugin.source?.branch === betaBranch;
    paintBetaChannel(plugin, { checking: true });
    try {
      const manifest = await repositoryManifest(extensionRepo, onBeta ? stableBranch : betaBranch);
      paintBetaChannel(plugin, { manifest });
    } catch (error) {
      paintBetaChannel(plugin, { error });
      if (showFailure) showUpdateDialog('Unable to check release channels', await updateFailureMessage(error));
    }
  }
  async function installReleaseChannel(action) {
    betaChannelButton.disabled = true;
    betaChannelStatus.textContent = 'Installing the ' + (action.branch === betaBranch ? 'beta' : 'stable') + ' version…';
    try {
      await request('/api/v1/plugins/install/github-branch', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo: extensionRepo, branch: action.branch })
      });
      const plugin = await pluginRecord();
      if (!plugin || plugin.source?.repo !== extensionRepo || plugin.source?.branch !== action.branch) throw new Error('Decaid did not switch the extension release channel.');
      installedVersion = plugin.version;
      currentPlugin = plugin;
      await refreshUpdateState();
      await refreshBetaChannel(plugin);
      showUpdateDialog(action.branch === betaBranch ? 'Beta installed' : 'Stable installed', 'Installed version ' + plugin.version + ' from the ' + (action.branch === betaBranch ? 'beta' : 'stable') + ' channel. Reopen this page to load the updated interface.');
    } catch (error) {
      showUpdateDialog('Channel change failed', await updateFailureMessage(error));
      await refreshBetaChannel(currentPlugin);
    }
  }
  function confirmReleaseChannel(action) {
    const added = action.addedPermissions.length ? ' It also requests: ' + action.addedPermissions.join(', ') + '.' : '';
    if (action.branch === betaBranch) {
      showUpdateDialog('Join the beta?', 'Install beta version ' + action.manifest.version + '? Beta versions may be less stable.' + added + ' Decaid does not currently allow downgrades, so you can return to stable only after a stable release is equal to or newer than this beta. Saved settings are preserved.', 'Join beta', () => installReleaseChannel(action));
    } else {
      showUpdateDialog('Return to stable?', 'Install stable version ' + action.manifest.version + ' and leave the beta channel? Saved settings are preserved.', 'Return to stable', () => installReleaseChannel(action));
    }
  }
  function paintUpdateState(plugin, { manifest = null, error = null, checking = false } = {}) {
    currentPlugin = plugin;
    const version = plugin?.version || installedVersion;
    extensionVersion.textContent = 'Version ' + version;
    checkUpdate.hidden = true; approveUpdate.hidden = true;
    checkUpdate.disabled = false; approveUpdate.disabled = false;
    updateCandidate = null;
    if (!plugin) {
      checkUpdate.textContent = 'Unable to check · Retry'; checkUpdate.hidden = false;
      updateStatus.textContent = 'Unable to check for extension updates. Select Retry.';
      return;
    }
    if (plugin.source?.kind !== 'github_branch') {
      updateStatus.textContent = 'Install this extension from its GitHub branch to enable updates.';
      return;
    }
    if (plugin.pendingUpdate) {
      const added = plugin.pendingUpdate.addedPermissions || [];
      updateCandidate = { pending: true, version: plugin.pendingUpdate.version, addedPermissions: added };
      extensionVersion.textContent = 'Current ' + version + ' → New ' + plugin.pendingUpdate.version;
      updateStatus.textContent = 'Version ' + plugin.pendingUpdate.version + ' needs approval' + (added.length ? ' because it adds: ' + added.join(', ') : '') + '.';
      approveUpdate.textContent = 'Approve & Update'; approveUpdate.hidden = false;
      return;
    }
    if (checking) {
      updateStatus.textContent = 'Checking for extension updates…';
      return;
    }
    if (error) {
      checkUpdate.textContent = 'Unable to check · Retry'; checkUpdate.hidden = false;
      updateStatus.textContent = 'Unable to check for extension updates: ' + (error.message || error) + ' Select Retry.';
      return;
    }
    if (manifest && compareVersions(version, manifest.version) < 0) {
      const installedPermissions = new Set(plugin.permissions || []);
      const addedPermissions = (manifest.permissions || []).filter(permission => !installedPermissions.has(permission));
      updateCandidate = { pending: false, version: manifest.version, addedPermissions };
      extensionVersion.textContent = 'Current ' + version + ' → New ' + manifest.version;
      updateStatus.textContent = 'Version ' + manifest.version + ' is available' + (addedPermissions.length ? ' and adds: ' + addedPermissions.join(', ') : '') + '.';
      const button = addedPermissions.length ? approveUpdate : checkUpdate;
      button.textContent = addedPermissions.length ? 'Approve & Update' : 'Update';
      button.hidden = false;
      return;
    }
    updateStatus.textContent = 'Version ' + version + ' is up to date.';
  }
  async function refreshUpdateState(showFailure = false) {
    try {
      const plugin = await pluginRecord();
      if (!plugin) { paintUpdateState(null); return null; }
      paintUpdateState(plugin, { checking: !plugin.pendingUpdate });
      if (plugin.pendingUpdate) return plugin;
      try { paintUpdateState(plugin, { manifest: await branchManifest(plugin) }); }
      catch (error) {
        paintUpdateState(plugin, { error });
        if (showFailure) showUpdateDialog('Unable to check for updates', await updateFailureMessage(error));
      }
      return plugin;
    } catch (error) {
      paintUpdateState(null, { error });
      if (showFailure) showUpdateDialog('Unable to check for updates', await updateFailureMessage(error));
      return null;
    }
  }
  async function installAvailableUpdate() {
    if (!updateCandidate || !currentPlugin) return;
    checkUpdate.disabled = true; approveUpdate.disabled = true;
    updateStatus.textContent = 'Updating Auto Steam Calculator…';
    try {
      const before = installedVersion;
      if (updateCandidate.pending) {
        await request('/api/v1/plugins/calibrated-steam.reaplugin/update/approve', { method: 'POST' });
      } else {
        await request('/api/v1/plugins/install/github-branch', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repo: currentPlugin.source.repo, branch: currentPlugin.source.branch || 'main' })
        });
      }
      const plugin = await pluginRecord();
      if (plugin?.version && plugin.version !== before) {
        installedVersion = plugin.version;
        paintUpdateState(plugin, { manifest: { id: plugin.id, version: plugin.version, permissions: plugin.permissions || [] } });
        showUpdateDialog('Extension updated', 'Updated to version ' + plugin.version + '. Reopen this page to load the updated interface.');
      } else {
        throw new Error('Decaid did not install the available version.');
      }
    } catch (error) {
      showUpdateDialog('Update failed', await updateFailureMessage(error));
      paintUpdateState(currentPlugin, { manifest: updateCandidate.pending ? null : { id: 'calibrated-steam.reaplugin', version: updateCandidate.version, permissions: [...(currentPlugin.permissions || []), ...updateCandidate.addedPermissions] } });
    } finally {
      checkUpdate.disabled = false; approveUpdate.disabled = false;
    }
  }
  checkUpdate.addEventListener('click', async () => updateCandidate ? installAvailableUpdate() : refreshUpdateState(true));
  approveUpdate.addEventListener('click', () => {
    if (!updateCandidate) return;
    const permissions = updateCandidate.addedPermissions.length ? updateCandidate.addedPermissions.join(', ') : 'permissions listed by Decaid';
    showUpdateDialog('Approve new permissions', 'Version ' + updateCandidate.version + ' requests: ' + permissions + '. Approve only if you trust this update.', 'Approve & Update', installAvailableUpdate);
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
  }
  function syncFlow(value, measured = false) {
    const changed = Number(value) !== Number(flowValue);
    field('referenceFlow').value = value;
    const mirror = document.getElementById('calibration-flow');
    if (mirror) mirror.value = value;
    flowValue = String(value);
    if (changed && !measured && !field('interpolate')?.checked) {
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
        const panel = make('section'); panel.id = 'panel-' + name; panel.className = 'settings-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
        form.append(panel); panels[name] = panel;
      }
      const groups = [
        ['pitchers', 'Empty pitcher weights', ['smallPitcherGrams', 'mediumPitcherGrams', 'largePitcherGrams']],
        ['pitchers', 'Automatic pitcher selection', ['autoDetect', 'singleDrinkGrams', 'singleDrinkPitcher']],
        ['calibration', '', ['interpolate', 'weightMode', 'temperatureUnit', 'targetTemperatureC', 'minimumFlow', 'maximumFlow', 'referenceMilkGrams', 'referenceSeconds']],
      ];
      panels.pitchers.append(Object.assign(make('p', 'Configure empty pitcher weights manually or capture each one from the connected scale.'), { className: 'panel-intro' }));
      panels.calibration.append(Object.assign(make('p', 'Create saved calibrations, or interpolate between several readings at one milk target.'), { className: 'panel-intro' }));
      const captions = { smallPitcherGrams: 'Small', mediumPitcherGrams: 'Medium', largePitcherGrams: 'Large', weightMode: 'Scale weight Mode' };
      const hints = { smallPitcherGrams: 'Empty pitcher · grams', mediumPitcherGrams: 'Empty pitcher · grams', largePitcherGrams: 'Empty pitcher · grams', weightMode: 'One global choice for every calibration. Gross: pitcher + milk. Tared: milk only.' };
      const noInlineHelp = new Set(['interpolate', 'weightMode', 'temperatureUnit', 'targetTemperatureC', 'autoDetect']);
      for (const [panelName, heading, keys] of groups) {
        const pitcherWeights = keys.includes('smallPitcherGrams'), automatic = keys.includes('autoDetect');
        const section = make('fieldset'); section.className = 'settings-section' + (pitcherWeights ? ' pitcher-weights-section' : automatic ? ' automatic-section' : ' measured-values');
        if (heading && !pitcherWeights && !automatic) section.append(make('legend', heading));
        panels[panelName].append(section);
        let automaticFields;
        if (automatic) {
          automaticFields = make('div'); automaticFields.id = 'automatic-fields'; automaticFields.className = 'field-grid automatic-fields';
        }
        for (const key of keys) {
          const item = schema[key]; if (!item) continue;
          const pitcherField = key.endsWith('PitcherGrams');
          const wrapper = make(automatic && key === 'autoDetect' ? 'label' : 'div');
          wrapper.className = pitcherField ? 'field pitcher-field pitcher-card' : key === 'autoDetect' ? 'automatic-switch' : 'field';
          const label = make(key === 'autoDetect' ? 'span' : 'label'); if (key !== 'autoDetect') label.htmlFor = 'setting-' + key;
          if (pitcherField) {
            const badge = make('span', captions[key][0]); badge.className = 'pitcher-card-badge';
            label.append(badge, make('span', captions[key])); label.className = 'pitcher-card-name';
          } else label.textContent = captions[key] || item.label;
          if (key !== 'autoDetect') wrapper.append(label);
          const input = make(item.type === 'enum' || key === 'targetTemperatureC' ? 'select' : 'input'); input.name = key; input.id = 'setting-' + key;
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
              : savedValue;
          }
          if (key === 'autoDetect') wrapper.append(input, label); else wrapper.append(input);
          if (!noInlineHelp.has(key)) wrapper.append(make('small', hints[key] || item.description));
          if (automaticFields && key !== 'autoDetect') automaticFields.append(wrapper); else section.append(wrapper);
          labels[key] = wrapper; fieldPanels[key] = panelName;
        }
        if (automaticFields) {
          const help = make('p', 'Optional. Requires Gross mode, all three pitcher weights, and the two values below.'); help.className = 'section-help';
          section.append(help, automaticFields);
        }
      }
      const gettingStarted = make('section'); gettingStarted.className = 'getting-started';
      const gettingStartedText = make('p');
      gettingStartedText.append(make('strong', 'Getting started:'), make('span', ' Leave Interpolate off and create one calibration reading. That is enough to use Auto Steam at the saved flow. Later, turn on Interpolate if you want 0.1 ml/s flow adjustment, then save at least three readings—the minimum, maximum, and one in between—at the same milk target.'));
      gettingStarted.append(gettingStartedText); panels.instructions.append(gettingStarted);
      const instructions = [
        ['1 · Configure pitchers', 'Enter at least one empty pitcher weight. To measure one, tare the empty scale, wait for stable zero, place the pitcher on the scale, then select its Set from scale button.'],
        ['2 · Scale weight mode', 'Gross captures pitcher plus milk and subtracts the selected empty-pitcher weight. Tared captures milk only after taring with the empty pitcher already on the scale. One choice applies to every calibration.'],
        ['3 · Choose the milk target filter', 'Choose Fahrenheit or Celsius for display. With Interpolate off, Milk target can show All targets or one saved target. The preference is remembered, while calibration temperatures remain stored internally in Celsius.'],
        ['4 · Build a calibration library', 'Each flow and milk-target combination is saved independently until deleted. With Interpolate off, the shot page cycles through every calibration allowed by the Milk target filter.'],
        ['5 · How Interpolate chooses readings', 'Interpolate uses every saved reading at the selected milk target inside the selected range. Other targets and out-of-range flows remain under Other saved calibrations.'],
        ['6 · Range, preview and accuracy', 'Interpolate requires exact minimum and maximum readings plus at least one interior reading. Preview interpolation graphs the selected milk target and lets you compare other complete targets. More matching readings improve accuracy.'],
        ['7 · Measure manually or with guidance', 'Manual entry uses actual milk-only weight and steaming time. Guided capture arms timing; start and stop steam with the machine controls. The counter excludes warm-up and stops when the machine stops steaming.'],
        ['8 · Review, save and make a drink', 'Edit opens a calibration beneath its row; Update saved calibration stores it immediately. Save settings activates the complete setup, then select Auto on the shot page, weigh the filled pitcher and tap S, M, L or Auto to calculate.'],
      ];
      const helpList = make('div'); helpList.className = 'help-list';
      for (const [heading, text] of instructions) {
        const section = make('section'); section.className = 'help-section';
        section.append(make('h3', heading), make('p', text)); helpList.append(section);
      }
      panels.instructions.append(helpList);
      const betaSection = make('section'); betaSection.className = 'beta-channel';
      const betaCopy = make('div'); betaCopy.className = 'beta-channel-copy';
      betaCopy.append(make('h3', 'Test beta versions'));
      betaChannelStatus = make('p', 'Checking your release channel…'); betaChannelStatus.id = 'beta-channel-status';
      betaCopy.append(betaChannelStatus);
      betaChannelButton = make('button', 'Checking…'); betaChannelButton.id = 'beta-channel-action'; betaChannelButton.type = 'button'; betaChannelButton.disabled = true;
      betaChannelButton.addEventListener('click', async () => {
        if (betaChannelAction?.retry) { await refreshBetaChannel(currentPlugin, true); return; }
        if (betaChannelAction) confirmReleaseChannel(betaChannelAction);
      });
      betaSection.append(betaCopy, betaChannelButton); panels.instructions.append(betaSection);
      panels.glossary.append(Object.assign(make('p', 'Definitions for the settings and calibration controls.'), { className: 'panel-intro' }));
      const glossary = make('dl'); glossary.className = 'glossary';
      for (const [term, meaning] of [
        ['Interpolate', 'Off cycles through exact saved calibrations. On interpolates at one milk target and keeps 0.1 ml/s shot-page flow steps.'],
        ['Smooth curve fit', 'Selected separately for each milk target in Preview interpolation. The extension automatically chooses a safe simple curve only when it predicts the readings better; otherwise it uses straight lines. It never extrapolates outside the calibrated flow range.'],
        ['Temperature unit', 'Display preference for calibration targets in Fahrenheit or Celsius. Changing it converts every displayed target without changing the calibration stored internally in Celsius.'],
        ['Milk target', 'Filters the calibrations shown here and offered on the shot page. All targets is available when Interpolate is off.'],
        ['All targets', 'Includes saved calibrations across every milk target. Each calibration still keeps its own target temperature.'],
        ['Scale weight mode', schema.weightMode.description],
        ['Empty pitcher weight', 'The untared pitcher weight used to subtract the pitcher from a Gross scale reading. Blank means that pitcher is not configured.'],
        ['Automatic pitcher selection', 'Damian’s heuristic infers S, M or L from gross weight and typical drink size. It is off by default, and some skins will not benefit from enabling it.'],
        ['Minimum / maximum flow', 'The active range where Interpolate may calculate. Readings outside the range are kept under Other saved calibrations until deleted.'],
        ['Available calibrations', 'With Interpolate off, these exact saved readings are offered on the shot page in flow and milk-target order.'],
        ['Other saved calibrations', 'Readings excluded by the current milk target or interpolation range. They remain available for later configurations until deleted.'],
        ['S / M / L / Auto', 'Green means that choice is configured; red means it is not. Some skins do not use Auto pitcher selection, so it is off by default.'],
        ['Tare / capture', 'In Gross mode, tare with the scale empty. In Tared mode, tare with the empty pitcher on the scale. Capture derives the milk weight and arms timing for the next physical steam run.'],
        ['Update saved calibration / Save settings', 'Update stores one reading immediately, including an incomplete interpolation set. Save settings activates only a complete valid setup.'],
      ]) {
        const item = make('div'); item.className = 'glossary-term'; item.append(make('dt', term), make('dd', meaning)); glossary.append(item);
      }
      panels.glossary.append(glossary);
      for (const key of ['referenceFlow', 'flowReadings']) {
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
      status.textContent = data.ready
        ? 'Auto Steam is ready to use.'
        : 'Complete the pitcher and calibration setup before using Auto Steam.';
      const persistLibrary = (flowReadings, curveFitTargets) => request(base + '/library', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flowReadings, curveFitTargets }),
      });
      flowPlan = mountFlowPlan({ form, labels, field, updateChoices, syncFlow, persistLibrary }, {
        calibrationLibrary, partitionFlowReadings, interpolationRequirements, availableTargets, calibrationKey,
        validFlowReading, temperatureToC, temperatureFromC, formatTemperature, interpolationModel,
        normalizeCurveFitTargets, initialCurveFitTargets: data.settings.curveFitTargets,
      });
      guided = mountCalibration({ form, labels, save, back, status, request, base, field, updateChoices, syncFlow, flowPlan }, captureWeight);
      const plugin = await refreshUpdateState();
      await refreshBetaChannel(plugin);
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!loaded) return;
    if (flowPlan?.isEditing()) {
      document.activeElement?.blur?.();
      status.textContent = 'Update or close the open calibration before saving.';
      return;
    }
    save.disabled = true;
    try {
      guided?.assertCanSave();
      await flowPlan?.assertCanSave();
      const errors = validateConfiguration(values());
      if (errors.length) {
        reveal(errors[0].field);
        const message = errors.map(error => error.message).join(' ');
        if (field('interpolate')?.checked && errors.some(error => error.field === 'flowReadings' || error.field === 'targetTemperatureC')) {
          showUpdateDialog('Interpolation setup incomplete', message);
        }
        throw new Error(message);
      }
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
:root{color-scheme:light dark;--bg:#eef2f7;--surface:#fff;--soft:#f7f9fc;--text:#1f2a3d;--muted:#5c6b81;--border:#d2dae6;--accent:#326eb9;--notice:#e9f1fb;--green:#1c7a45;--configured-bg:#e4f5ea;--configured-text:#1c7a45;--unconfigured-bg:#fde8e8;--unconfigured-text:#8f2929;--danger:#b23a3a;font:14px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media(prefers-color-scheme:dark){:root{--bg:#111827;--surface:#1d293b;--soft:#253247;--text:#edf3fb;--muted:#adbbcf;--border:#43516a;--accent:#70aaf0;--notice:#263d5d;--green:#65d796;--configured-bg:#1c402e;--configured-text:#65d796;--unconfigured-bg:#512d32;--unconfigured-text:#ffc2c2;--danger:#ff8c8c}}
*{box-sizing:border-box}[hidden]{display:none!important}body{max-width:1024px;min-height:690px;margin:auto;padding:18px;background:var(--bg);color:var(--text)}h1,h2,h3,p{margin-top:0}h1{margin-bottom:2px;font-size:21px;font-weight:500}h2{margin-bottom:3px;font-size:17px;font-weight:500}h3{margin-bottom:7px;font-size:14px;font-weight:500}p{margin-bottom:10px}button,a,input,select{touch-action:manipulation}button,input,select{min-height:40px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit}button{padding:7px 11px;font-weight:500;cursor:pointer}button:disabled{opacity:.48;cursor:default}input,select{width:100%;height:40px;min-width:0;padding:7px 9px;font-size:16px}input[type=checkbox]{width:22px;height:22px;min-height:22px;margin:0;accent-color:var(--accent)}a{color:var(--accent)}
header{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"header";align-items:center;min-height:40px}.extension-title{grid-area:header;justify-self:center;min-width:0;text-align:center}.extension-title h1{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#extension-version{display:block;color:var(--muted);font-size:12px;white-space:nowrap}.extension-actions{grid-area:header;z-index:1;display:flex;align-items:center;justify-self:end;justify-content:flex-end;gap:8px;min-width:0}.extension-actions button{width:max-content;white-space:nowrap;border-color:var(--accent);background:var(--accent);color:#fff}#return-settings{grid-area:header;z-index:1;justify-self:start;display:inline-block;min-height:40px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);text-decoration:none}
.visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.update-dialog{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.55)}.update-dialog-card{width:min(460px,100%);padding:16px;border:1px solid var(--border);border-radius:11px;background:var(--surface);box-shadow:0 18px 45px rgba(0,0,0,.3)}.update-dialog-card p{color:var(--muted);overflow-wrap:anywhere}.update-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.update-dialog-card button{min-width:80px;border-color:var(--accent)}#extension-update-dialog-close{background:var(--surface);color:var(--text)}#extension-update-dialog-confirm{background:var(--accent);color:#fff}
#settings-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;margin:10px 0 12px}#settings-tabs{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px}#settings-tabs button{min-height:38px;padding:6px 11px;color:var(--muted)}#settings-tabs [aria-selected=true],button[aria-pressed=true],#save{border-color:var(--accent);background:var(--accent);color:#fff}#configuration-summary{display:flex;align-items:center;justify-self:end;gap:6px;margin:0;color:var(--muted);font-size:12px;white-space:nowrap}.configured-pitcher,.unconfigured-pitcher{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 6px;border-radius:999px;font-weight:500}.configured-pitcher{background:var(--configured-bg);color:var(--configured-text)}.unconfigured-pitcher{background:var(--unconfigured-bg);color:var(--unconfigured-text)}.configuration-flow{margin-left:5px;color:var(--text);font-weight:500}
.settings-panel{padding:14px;border:1px solid var(--border);border-radius:11px;background:var(--surface);box-shadow:0 5px 17px rgba(43,62,90,.07)}.panel-intro{margin-bottom:11px;color:var(--muted);font-size:12px}.settings-section{min-width:0;margin:0 0 11px;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--soft)}.settings-section:last-child{margin-bottom:0}fieldset.settings-section{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.field{display:grid;align-content:start;gap:4px;color:var(--muted);font-size:12px}.field label{color:var(--text);font-weight:500}.field small,.section-help{color:var(--muted);font-size:12px}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;grid-column:1/-1}.full-width{grid-column:1/-1}.local-status{margin:8px 0 0;padding:7px 9px;border-radius:7px;background:var(--notice);color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.pitcher-weights-section,.automatic-section{display:block!important}.pitcher-section-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.pitcher-section-header h3{margin:0}.scale-reading{color:var(--muted);font-size:12px}.scale-tools{display:flex;align-items:center;gap:8px}.pitcher-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.pitcher-card{display:grid;grid-template-columns:1fr;grid-template-rows:auto auto auto auto;align-content:start;gap:6px;min-width:0}.pitcher-card+.pitcher-card{padding-left:12px;border-left:1px solid var(--border)}.pitcher-card-name{display:flex;align-items:center;gap:7px;color:var(--text)!important}.pitcher-card-badge{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 6px;border-radius:999px;background:var(--configured-bg);color:var(--configured-text);font-weight:500}.pitcher-card button{width:100%}.pitcher-card .capture-result{margin:0;color:var(--muted);font-size:12px}.automatic-switch{display:flex;align-items:center;gap:10px;min-height:40px;font-weight:500}.automatic-switch>span{color:var(--text)}#setting-autoDetect{flex:0 0 30px;width:30px;height:30px;min-height:30px}.section-help{margin:4px 0 9px}.automatic-fields{margin-top:0}
.flow-setup{display:block!important}.calibration-config-grid{display:grid;grid-template-columns:1.05fr .9fr .68fr 1.15fr;align-items:end;gap:9px}.interpolate-control{display:flex;align-items:center;gap:8px;min-width:0}.interpolate-switch{display:flex;align-items:center;gap:10px;min-height:40px;color:var(--text);font-weight:500}.interpolate-switch input{flex:0 0 30px;width:30px;height:30px;min-height:30px}.preview-interpolation{min-height:36px;padding:5px 9px;white-space:nowrap}.calibration-actions{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:8px 0}.calibration-actions button{min-height:36px;padding:5px 9px}.flow-setup>.field-grid{margin-top:10px}.flow-setup>.local-status{margin-top:9px}.calibration-library-header{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:4px}.calibration-library-header h3{margin:0}.calibration-library-help{color:var(--muted);font-size:12px}.calibration-library-actions{display:flex;align-items:center;gap:8px}.calibration-validation{color:var(--green);font-size:12px}.calibration-validation.invalid{color:var(--danger)}.new-calibration{min-height:36px;padding:5px 9px}.empty-calibrations{margin:8px 0;color:var(--muted);font-size:12px}.saved-calibration{border-top:1px solid var(--border)}.calibration-library-header+.saved-calibration{border-top:0}.saved-calibration-row{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;align-items:center;gap:7px;padding:7px 0}.saved-calibration-details{min-width:0}.saved-calibration-flow{display:block;font-weight:500}.saved-calibration-meta{display:block;color:var(--muted);font-size:12px}.saved-calibration-row button{min-height:36px;padding:5px 9px}.missing-calibration{border-top-style:dashed}.saved-calibration-row.editing{margin:0 -7px;padding-right:7px;padding-left:7px;border-radius:8px 8px 0 0;background:var(--notice)}.calibration-editor{margin:0 -7px 8px;padding:10px;border-radius:0 0 8px 8px;background:var(--notice)}.editor-header{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px}.editor-heading{min-width:0}.editor-title-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.editor-title-row h3{margin:0}.editor-identity-help{color:var(--muted);font-size:12px}.reading-navigation{display:flex;gap:5px}.reading-navigation button{min-width:40px;min-height:36px;padding:4px 9px;font-size:17px}.entry-methods{margin:0;flex-wrap:nowrap}.editor-identity-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-bottom:8px}.editor-flow{width:auto}.inline-editor-flow{display:flex;align-items:center;grid-template-columns:none;flex-wrap:wrap;gap:7px;color:var(--text);font-weight:500}.inline-editor-flow input{width:92px;height:36px;min-height:36px}.inline-editor-flow small{font-weight:400}.manual-workspace,.guided-workspace{display:block}.manual-fields,.calibration-workspace-block{margin:0 0 8px!important;padding:10px!important;border:1px solid var(--border)!important;border-radius:8px!important;background:var(--surface)!important}.manual-fields{grid-template-columns:repeat(2,minmax(0,1fr))!important}.editor-save-row{justify-content:space-between;margin:8px 0 0}.primary-action,#save{border-color:var(--accent);background:var(--accent);color:#fff}#other-calibrations{margin:10px 0 11px;border:1px solid var(--border);border-radius:9px;background:var(--surface)}#other-calibrations summary{min-height:40px;padding:9px 11px;cursor:pointer;font-weight:500}#other-calibrations[open]{padding-bottom:7px}#other-calibrations[open] summary{border-bottom:1px solid var(--border)}#other-calibrations>div,#other-calibrations>.other-calibrations-help{margin-right:11px;margin-left:11px}.other-calibrations-help{margin-top:7px;margin-bottom:4px;color:var(--muted);font-size:12px}
.interpolation-dialog{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:18px;overscroll-behavior:contain;background:rgba(0,0,0,.58)}.interpolation-dialog-card{width:min(860px,100%);max-height:calc(100vh - 36px);overflow:auto;padding:12px;border:1px solid var(--border);border-radius:11px;background:var(--surface);box-shadow:0 18px 45px rgba(0,0,0,.35)}.interpolation-dialog-header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin-bottom:8px}.interpolation-dialog-header h2{justify-self:start;margin:0;white-space:nowrap}.interpolation-dialog-header>button{justify-self:end}.interpolation-preview-navigation{display:flex;align-items:center;justify-content:center;gap:8px}.interpolation-preview-navigation button{min-width:40px;min-height:36px;padding:4px 9px;font-size:20px}.interpolation-preview-navigation span{min-width:190px;text-align:center;font-weight:500}.interpolation-preview-graph{width:100%;overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--soft)}.interpolation-preview-graph svg{display:block;width:100%;min-width:600px;height:auto}.interpolation-preview-graph text{fill:var(--muted);font:12px Inter,ui-sans-serif,system-ui,sans-serif}.interpolation-preview-graph .graph-grid{stroke:var(--border);stroke-width:1}.interpolation-preview-graph .graph-axis{stroke:var(--text);stroke-width:1.5}.interpolation-preview-graph .graph-reading{fill:var(--text);stroke:var(--surface);stroke-width:1.5}.interpolation-preview-graph .graph-label{fill:var(--text);font-weight:500}.interpolation-preview-options{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:10px}.interpolation-preview-method{margin:0 auto 0 0;color:var(--muted);font-size:12px;white-space:nowrap}.smooth-curve-option{display:flex;align-items:center;gap:9px;font-weight:500}.smooth-curve-option input{flex:0 0 24px;width:24px;height:24px;min-height:24px}.interpolation-preview-method{margin-top:7px}
.guided-overview{display:grid;grid-template-columns:minmax(130px,.58fr) minmax(205px,.92fr) minmax(245px,1.1fr);align-items:stretch;gap:9px;margin-bottom:8px}.guided-overview.is-tared{grid-template-columns:minmax(225px,.95fr) minmax(245px,1.05fr)}.guided-overview>*{min-width:0}.guided-readouts{display:grid;grid-template-rows:repeat(2,minmax(0,1fr));gap:4px;width:100%}.guided-metric{display:flex;align-items:center;justify-content:space-between;gap:9px;min-height:0;padding:4px 9px;border-radius:7px;background:var(--soft)}.guided-metric b{font-weight:500}.guided-metric span{font-variant-numeric:tabular-nums}.guided-actions{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;margin:0}.guided-actions button{width:100%}.guided-steam-controls{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:8px}.timer-readout{margin-right:auto;font-weight:500;font-variant-numeric:tabular-nums}.calibration-timer{font:inherit}.machine-state{color:var(--muted);font-size:12px}.guided-steam-controls .calibration-actions{margin:0}.calibration-flow{max-width:220px;margin-bottom:8px}
.getting-started{margin-bottom:9px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--soft)}.getting-started p{margin:0;color:var(--muted);font-size:12px}.getting-started strong{color:var(--text);font-weight:600}.help-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.help-section{padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--soft)}.help-section h3{margin-bottom:4px}.help-section p{margin-bottom:0;color:var(--muted);font-size:12px}.beta-channel{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:9px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--soft)}.beta-channel-copy{min-width:0}.beta-channel h3{margin-bottom:4px}.beta-channel p{margin:0;color:var(--muted);font-size:12px}.beta-channel button{flex:0 0 auto;white-space:nowrap}.glossary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px;margin:0}.glossary-term{padding:9px 0;border-bottom:1px solid var(--border)}.glossary-term dt{margin-bottom:3px;font-weight:500}.glossary-term dd{margin:0;color:var(--muted);font-size:12px}
#status{min-height:1.5em;margin:0;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.save-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;min-height:40px;margin-top:11px}footer{margin-top:11px;color:var(--muted);font-size:12px}
@media(pointer:coarse){button,input,select{min-height:44px}input,select{height:44px}#settings-tabs button{min-height:44px}.calibration-actions button,.saved-calibration-row button{min-height:44px}#setting-autoDetect{width:32px;height:32px;min-height:32px;flex-basis:32px}}
@media(max-width:790px){.calibration-config-grid{grid-template-columns:1fr .9fr .7fr 1.1fr}}
@media(max-width:680px){#settings-toolbar{grid-template-columns:1fr}#configuration-summary{justify-self:end}.calibration-config-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.interpolate-control{align-items:flex-start;flex-direction:column}}
@media(max-width:560px){body{padding:12px}.extension-title h1{font-size:18px}.extension-actions{gap:5px}#extension-version{font-size:11px}.extension-actions button{padding:6px 8px}#configuration-summary{justify-self:stretch;flex-wrap:wrap}.field-grid,.calibration-config-grid,.pitcher-grid,.help-list,.glossary,.editor-identity-fields,.guided-overview,.guided-overview.is-tared{grid-template-columns:1fr}.beta-channel{align-items:stretch;flex-direction:column}.beta-channel button{align-self:flex-end}.pitcher-card+.pitcher-card{padding-top:10px;padding-left:0;border-top:1px solid var(--border);border-left:0}.calibration-library-header{align-items:stretch;flex-direction:column}.calibration-library-actions{justify-content:space-between}.saved-calibration-row{grid-template-columns:minmax(0,1fr) auto auto}.saved-calibration-details{grid-column:1/-1}.default-choice{grid-column:1/-1;justify-self:end}.editor-header{align-items:stretch}.entry-methods{justify-content:flex-start}.editor-save-row{align-items:stretch}.editor-save-row button{flex:1}}
</style></head><body>
<header><a id="return-settings" href="/api/v1/plugins/settings.reaplugin/ui">← Settings</a><div class="extension-title"><h1>Auto Steam Calculator</h1></div><div class="extension-actions"><span id="extension-version">Version …</span><button id="check-extension-update" type="button" hidden>Update</button><button id="approve-extension-update" type="button" hidden>Approve &amp; Update</button></div></header>
<p id="extension-update-status" class="visually-hidden" role="status" aria-live="polite">Loading update status…</p>
<div id="extension-update-dialog" class="update-dialog" hidden><section class="update-dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="extension-update-dialog-title" aria-describedby="extension-update-dialog-message"><h2 id="extension-update-dialog-title">Extension update</h2><p id="extension-update-dialog-message"></p><div class="update-dialog-actions"><button id="extension-update-dialog-close" type="button">OK</button><button id="extension-update-dialog-confirm" type="button" hidden></button></div></section></div>
<div id="settings-toolbar"><nav id="settings-tabs" role="tablist" aria-label="Auto Steam settings"></nav><p id="configuration-summary" role="status" aria-live="polite">Loading configuration…</p></div>
<form id="settings" novalidate></form>
<div class="save-row"><p id="status" role="status" aria-live="polite">Loading settings…</p><button id="save" form="settings" type="submit" disabled>Save settings</button></div>
<footer>Calculation and automatic pitcher detection inspired by <a href="https://github.com/Damian-AU/DSx2">Damian / Damian-AU’s DSx2</a>. Implementation for Decaid by pponce.</footer>
<script>{const FLOW_MINIMUM=0.4,FLOW_MAXIMUM=2.5,MAX_READINGS=100;const close=(a,b)=>Math.abs(Number(a)-Number(b))<0.000001;const selectedTarget=settings=>Number(settings.targetTemperatureC)>0?Number(settings.targetTemperatureC):0;${normalizeCurveFitTargets.toString()}\n${temperatureToC.toString()}\n${temperatureFromC.toString()}\n${formatTemperature.toString()}\n${readFlowReadings.toString()}\n${validFlowReading.toString()}\n${calibrationKey.toString()}\n${calibrationLibrary.toString()}\n${availableTargets.toString()}\n${partitionFlowReadings.toString()}\n${interpolationRequirements.toString()}\n${piecewiseRate.toString()}\n${linearFit.toString()}\n${solveThree.toString()}\n${fitCurve.toString()}\n${safeCurve.toString()}\n${crossValidationError.toString()}\n${smoothCurveModel.toString()}\n${interpolationModel.toString()}\n${validateCalibrationLibrary.toString()}\n${validateFlowCalibration.toString()}\n${configuredPitchers.toString()}\n${availablePitchers.toString()}\n${validateSettings.toString()}\n(${settingsBrowser.toString()})(${settingsReturnUrl.toString()},${mountCalibrationPage.toString()},${captureScaleWeight.toString()},availablePitchers,validateSettings,${mountFlowCalibrationPage.toString()});}</script></body></html>`;
}
