globalThis.createPlugin = function createPlugin(host = {}) {
  let settings = {};
  let loaded = false;
  let storageState = { state: 'legacy-only', source: 'legacy', warning: null };
  let pendingLegacy = { present: false, value: '[]' };
  let calibration = null, calibrationToken = null, calibrationTimer = null, latestMachine = null, latestMachineAt = 0;
  const calibrationActive = () => calibration?.snapshot().active === true;
  async function machineRequest(path, method = 'GET', body) {
    const response = await fetch('http://localhost:8080/api/v1/' + path, {
      method, headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('Machine request failed (' + response.status + ').');
    return method === 'GET' ? response.json() : null;
  }
  function scheduleCalibration() {
    if (calibrationTimer !== null || !loaded) return;
    calibrationTimer = setTimeout(async () => {
      calibrationTimer = null;
      try { await calibration?.tick(); }
      finally { if (calibrationActive()) scheduleCalibration(); }
    }, 250);
  }
  async function calibrationRequest(body) {
    if (!body || typeof body !== 'object') return json(400, { message: 'Supply a calibration action.' });
    try {
      if (body.action === 'begin') {
        if (calibrationActive()) return json(409, { message: 'Another calibration is active.' });
        calibration = createCalibrationSession({
          readWorkflow: () => machineRequest('workflow'),
          writeSteam: steamSettings => machineRequest('workflow', 'PUT', { steamSettings }),
          requestState: state => machineRequest('machine/state/' + state, 'PUT'),
        });
        if (latestMachine && Date.now() - latestMachineAt <= 3000) calibration.observe(latestMachine);
        calibrationToken = Date.now().toString(36) + Math.random().toString(36).slice(2);
        scheduleCalibration();
        await calibration.begin(body);
      } else {
        if (!calibration || body.token !== calibrationToken) return json(409, { message: 'This calibration session is no longer available.' });
        if (!['heartbeat', 'start', 'stop', 'cancel'].includes(body.action)) return json(400, { message: 'Unknown calibration action.' });
        calibration.heartbeat();
        await calibration[body.action]();
      }
      return json(200, { ...calibration.snapshot(), token: calibrationToken });
    } catch (error) {
      return json(409, { ...calibration?.snapshot(), token: calibrationToken, message: error.message });
    } finally { if (calibrationActive()) scheduleCalibration(); }
  }
  const defaults = Object.fromEntries(Object.entries(MANIFEST.settings).map(([key, schema]) => [key, schema.default]));
  const json = (status, value) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(value) });

  function configured(values) {
    return Object.fromEntries(Object.keys(defaults).map(key => [key, values[key] ?? defaults[key]]));
  }

  function loadCalibrationStorage(values) {
    const legacyPresent = Object.prototype.hasOwnProperty.call(values, 'flowReadings');
    if (typeof host.storage !== 'function') {
      storageState = { state: 'legacy-only', source: 'legacy', warning: 'plugin_storage_unavailable' };
      return;
    }
    pendingLegacy = { present: legacyPresent, value: settings.flowReadings };
    settings.flowReadings = '[]';
    storageState = { state: 'loading', source: 'legacy', warning: null };
    try { host.storage({ type: 'read', key: CALIBRATION_STORAGE_KEY }); }
    catch {
      storageState = { state: 'legacy-only', source: 'legacy', warning: 'plugin_storage_unavailable' };
    }
  }

  function saveCalibrationLibrary(body) {
    if (!body || typeof body.flowReadings !== 'string') return json(400, { code: 'invalid_request', message: 'Supply a calibration library.' });
    const candidate = { ...settings, flowReadings: body.flowReadings };
    const errors = validateCalibrationLibrary(candidate);
    if (errors.length) return json(422, { code: 'invalid_calibration_library', message: errors[0].message, errors });
    const record = calibrationStorageRecord(body.flowReadings);
    if (!record || typeof host.storage !== 'function') return json(503, { code: 'plugin_storage_unavailable', message: 'Decaid plugin storage is unavailable.' });
    settings.flowReadings = body.flowReadings;
    try {
      storageState = { state: 'writing', source: 'library-api', warning: null };
      host.storage({ type: 'write', key: CALIBRATION_STORAGE_KEY, data: record });
      return json(200, { saved: true, flowReadings: settings.flowReadings });
    } catch {
      storageState = { ...storageState, state: 'write-failed', warning: 'plugin_storage_write_failed' };
      return json(503, { code: 'plugin_storage_write_failed', message: 'The calibration library could not be saved.' });
    }
  }

  function applyStoredCalibration(payload) {
    if (!loaded || payload?.key !== CALIBRATION_STORAGE_KEY) return;
    const result = reconcileCalibrationStorage({
      legacyPresent: pendingLegacy.present,
      legacyValue: pendingLegacy.value,
      storedValue: payload.value,
    });
    settings.flowReadings = result.flowReadings;
    storageState = { state: result.write ? 'writing' : 'ready', source: result.source, warning: result.warning };
    if (result.write) {
      try { host.storage({ type: 'write', key: CALIBRATION_STORAGE_KEY, data: result.write }); }
      catch { storageState = { ...storageState, state: 'write-failed', warning: 'plugin_storage_write_failed' }; }
    }
  }

  return {
    id: MANIFEST.id,
    version: MANIFEST.version,
    onLoad(values = {}) {
      settings = configured(values);
      if (settings.referenceFlow === 0) settings.referenceFlow = defaults.referenceFlow;
      loaded = true;
      loadCalibrationStorage(values);
    },
    onUnload() {
      loaded = false; settings = {};
      if (calibrationTimer !== null) clearTimeout(calibrationTimer);
      calibrationTimer = null;
      if (calibrationActive()) calibration.cancel('Extension unloaded; calibration is incomplete.');
    },
    onEvent(event) {
      if (event.name === 'storageRead') { applyStoredCalibration(event.payload); return; }
      if (event.name === 'storageWrite') {
        if (loaded && storageState.state === 'writing') storageState = { ...storageState, state: 'ready' };
        return;
      }
      if (event.name !== 'stateUpdate') return;
      latestMachine = event.payload;
      latestMachineAt = Date.now();
      calibration?.observe(event.payload);
    },
    __httpRequestHandler(request) {
      if (!loaded) return json(503, { code: 'plugin_disabled', message: 'Enable the calibrated steam plugin.' });
      const { endpoint, method, body } = request;
      const methods = { status: 'GET', calculate: 'POST', validate: 'POST', ui: 'GET', calibration: 'POST', library: 'POST' };
      if (!methods[endpoint]) return json(404, { code: 'not_found', message: 'Unknown endpoint.' });
      if (method !== methods[endpoint]) return json(405, { code: 'method_not_allowed', message: `Use ${methods[endpoint]}.` });
      if (endpoint === 'calibration') return calibrationRequest(body);
      if (endpoint === 'library') return saveCalibrationLibrary(body);
      if (endpoint === 'status') return json(200, { apiVersion: 5, version: MANIFEST.version, calibrationActive: calibrationActive(), ready: validateSettings(settings).length === 0, settings, flowCalibration: flowCalibration(settings), availablePitchers: availablePitchers(settings), errors: validateSettings(settings), schema: MANIFEST.settings, calibrationStorage: { key: CALIBRATION_STORAGE_KEY, ...storageState } });
      if (endpoint === 'ui') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: settingsPage() };
      if (endpoint === 'validate') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { code: 'invalid_request', message: 'Settings must be an object.' });
        const errors = validateSettings(configured(body));
        return json(errors.length ? 422 : 200, { valid: errors.length === 0, errors });
      }
      if (calibrationActive()) return json(409, { code: 'calibration_active', message: 'Finish or cancel guided calibration first.' });
      try {
        return json(200, { ...calculate(settings, body), calibrationRevision: JSON.stringify(settings) });
      } catch (error) {
        if (error instanceof CalculationError) return json(422, { code: error.code, message: error.message });
        return json(500, { code: 'calculation_failed', message: 'Unable to calculate a steam time.' });
      }
    },
  };
};
