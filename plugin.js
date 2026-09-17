/* Calibrated Steam Timer. GPL-3.0-only. Inspired by Damian / Damian-AU, DSx2. */
(function () {
"use strict";
const MANIFEST = {"id":"calibrated-steam.reaplugin","name":"Auto Steam Calculator","author":"pponce; calculation and pitcher heuristic inspired by Damian / Damian-AU (DSx2)","description":"Estimate steam duration from milk weight using your calibration. Inspired by Damian's DSx2 calculator. This estimates temperature through time; it does not measure milk temperature.","version":"0.12.2","apiVersion":1,"permissions":["api","events.machine"],"settings":{"smallPitcherGrams":{"type":"number","label":"Small empty pitcher (g)","description":"Untared weight of the empty small pitcher. Leave blank or 0 if not configured.","default":0},"mediumPitcherGrams":{"type":"number","label":"Medium empty pitcher (g)","description":"Untared weight of the empty medium pitcher. Leave blank or 0 if not configured.","default":0},"largePitcherGrams":{"type":"number","label":"Large empty pitcher (g)","description":"Untared weight of the empty large pitcher. Leave blank or 0 if not configured.","default":0},"singleDrinkGrams":{"type":"number","label":"Usual milk per drink (g)","description":"Milk only for one drink; used to infer pitcher size in Auto. This can differ from your calibration milk weight.","default":0},"singleDrinkPitcher":{"type":"enum","label":"Pitcher normally used for one drink","description":"Select small or medium to choose the pitcher-detection thresholds.","values":["","small","medium"],"default":""},"weightMode":{"type":"enum","label":"Scale weight mode","description":"One global choice for single- and multiple-flow calculations. Gross includes the empty pitcher. Tared is milk only: pitcher size cannot be inferred and no pitcher weight is subtracted.","values":["gross","tared"],"default":"gross"},"temperatureUnit":{"type":"enum","label":"Temperature unit","description":"Display preference for calibration targets. Saved calibration temperatures remain stored internally in Celsius.","values":["F","C"],"default":"F"},"targetTemperatureC":{"type":"number","label":"Target temp (°F) — required","description":"Required target milk temperature for this calibration set. Readings are matched by target temperature and flow.","default":60},"referenceMilkGrams":{"type":"number","label":"Calibration milk weight (g)","description":"Actual measured milk weight for this reading, excluding the pitcher. Enter it manually or capture it from the scale during guided calibration. Each reading uses its own measured weight.","default":0},"referenceSeconds":{"type":"number","label":"Time to your desired milk temperature (s)","description":"Actual steaming time in the calibration run. Use similar milk, starting temperature and steaming technique for subsequent drinks.","default":0},"referenceFlow":{"type":"number","label":"Calibration flow / default (ml/s)","description":"Fixed flow for single calibration, or default flow within the multiple-calibration range (0.4–2.5 ml/s).","default":0.4},"minimumFlow":{"type":"number","label":"Minimum flow (ml/s)","description":"Lowest flow used by Multiple flow support. A saved reading is required at this exact flow.","default":0.4},"maximumFlow":{"type":"number","label":"Maximum flow (ml/s)","description":"Highest flow used by Multiple flow support. A saved reading is required at this exact flow.","default":2.5},"autoDetect":{"type":"boolean","label":"Offer Auto pitcher selection","description":"Enable automatic detection using Damian’s heuristic. Requires all three pitcher weights, gross scale weight, usual milk per drink and the pitcher normally used for one drink.","default":false},"calibrationMode":{"type":"enum","label":"Calibration type","values":["single","multiple"],"default":"single","description":"Single uses one selected default. Multiple uses every matching saved calibration within the selected flow range."},"flowReadings":{"type":"string","label":"Measured flow calibrations","default":"[]","description":"Managed by the Calibration page. Saved readings include flow, targetTemperatureC, milkGrams and seconds."}},"api":[{"id":"status","type":"http","data":{}},{"id":"calculate","type":"http","data":{}},{"id":"validate","type":"http","data":{}},{"id":"ui","type":"http","data":{}},{"id":"calibration","type":"http","data":{}}]};
const FLOW_MINIMUM = 0.4;
const FLOW_MAXIMUM = 2.5;
const MAX_READINGS = 100;

const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
const targetFor = settings => Number(settings.targetTemperatureC) > 0 ? Number(settings.targetTemperatureC) : 60;

function temperatureToC(value, unit = 'F') {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  const celsius = unit === 'F' ? (number - 32) * 5 / 9 : number;
  return Math.round(celsius * 10) / 10;
}

function temperatureFromC(value, unit = 'F') {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  const display = unit === 'F' ? number * 9 / 5 + 32 : number;
  return Math.round(display * 10) / 10;
}

function formatTemperature(valueC, unit = 'F') {
  const value = temperatureFromC(valueC, unit);
  return Number.isFinite(value) ? value.toFixed(1) + ' °' + unit : '—';
}

function readFlowReadings(settings) {
  try {
    if (settings.flowReadings === undefined || settings.flowReadings === '') return [];
    if (typeof settings.flowReadings !== 'string' || settings.flowReadings.length > 65536) return null;
    const readings = JSON.parse(settings.flowReadings);
    return Array.isArray(readings) && readings.length <= MAX_READINGS ? readings : null;
  } catch { return null; }
}

function validFlowReading(reading) {
  return reading && Number.isFinite(reading.flow) && reading.flow >= FLOW_MINIMUM && reading.flow <= FLOW_MAXIMUM &&
    Number.isFinite(reading.targetTemperatureC) && reading.targetTemperatureC > 0 && reading.targetTemperatureC <= 100 &&
    Number.isFinite(reading.milkGrams) && reading.milkGrams >= 10 && reading.milkGrams <= 1500 &&
    Number.isFinite(reading.seconds) && reading.seconds >= 1 && reading.seconds <= 255;
}

function calibrationKey(reading) {
  return Number(reading.flow).toFixed(3) + '@' + Number(reading.targetTemperatureC).toFixed(3);
}

function calibrationLibrary(settings) {
  const sharedTarget = targetFor(settings);
  const parsed = readFlowReadings(settings);
  if (!parsed) return null;
  const readings = parsed.map(reading => ({
    ...reading,
    targetTemperatureC: Number.isFinite(Number(reading?.targetTemperatureC)) && Number(reading.targetTemperatureC) > 0
      ? Number(reading.targetTemperatureC) : sharedTarget,
  }));
  if (!readings.length && Number.isFinite(settings.referenceFlow) && Number.isFinite(settings.referenceMilkGrams) &&
      Number.isFinite(settings.referenceSeconds) && settings.referenceMilkGrams >= 10 && settings.referenceSeconds >= 1 && sharedTarget > 0) {
    readings.push({ flow: settings.referenceFlow, targetTemperatureC: sharedTarget,
      milkGrams: settings.referenceMilkGrams, seconds: settings.referenceSeconds });
  }
  return readings.sort((a, b) => a.targetTemperatureC - b.targetTemperatureC || a.flow - b.flow);
}

function partitionFlowReadings(settings) {
  const readings = calibrationLibrary(settings);
  if (!readings) return { active: [], other: [], invalid: true };
  const target = targetFor(settings), minimum = Number(settings.minimumFlow ?? 0.4), maximum = Number(settings.maximumFlow ?? 2.5);
  const active = [], other = [];
  for (const reading of readings) {
    if (validFlowReading(reading) && close(reading.targetTemperatureC, target) && reading.flow >= minimum && reading.flow <= maximum) active.push(reading);
    else other.push(reading);
  }
  return { active: active.sort((a, b) => a.flow - b.flow), other, invalid: false };
}

function multipleCalibrationRequirements(settings) {
  const minimum = Number(settings.minimumFlow ?? 0.4), maximum = Number(settings.maximumFlow ?? 2.5);
  const { active } = partitionFlowReadings(settings);
  return { active,
    hasMinimum: active.some(reading => close(reading.flow, minimum)),
    hasMaximum: active.some(reading => close(reading.flow, maximum)),
    hasInterior: active.some(reading => reading.flow > minimum && reading.flow < maximum) };
}

function validateFlowCalibration(settings) {
  const mode = settings.calibrationMode ?? 'single';
  if (!['single', 'multiple'].includes(mode)) return [{ field: 'calibrationMode', message: 'Choose Single or Multiple flow support.' }];
  const target = targetFor(settings);
  if (!Number.isFinite(target) || target <= 0 || target > 100) return [{ field: 'targetTemperatureC', message: 'Enter a required target milk temperature between 0 and 100 °C.' }];
  const readings = calibrationLibrary(settings);
  if (!readings || readings.some(reading => !validFlowReading(reading))) return [{ field: 'flowReadings', message: 'Every saved calibration needs a flow, target temperature, milk weight and steaming time.' }];
  const keys = readings.map(calibrationKey);
  if (new Set(keys).size !== keys.length) return [{ field: 'flowReadings', message: 'Only one saved calibration may use the same flow and target temperature.' }];
  if (mode === 'single') {
    const selected = readings.find(reading => close(reading.flow, settings.referenceFlow) && close(reading.targetTemperatureC, target));
    return selected ? [] : [{ field: 'referenceFlow', message: 'Choose a saved calibration as the Single-flow default.' }];
  }
  const minimum = Number(settings.minimumFlow ?? 0.4), maximum = Number(settings.maximumFlow ?? 2.5);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < FLOW_MINIMUM || maximum > FLOW_MAXIMUM || maximum - minimum < 0.1) return [{ field: 'minimumFlow', message: 'Choose a flow range of at least 0.1 ml/s between 0.4 and 2.5 ml/s.' }];
  const required = multipleCalibrationRequirements(settings);
  if (required.active.length < 3 || !required.hasMinimum || !required.hasMaximum || !required.hasInterior) return [{ field: 'flowReadings', message: 'Multiple flow needs the selected minimum, maximum, and at least one interior calibration at the target temperature.' }];
  if (!required.active.some(reading => close(reading.flow, settings.referenceFlow))) return [{ field: 'referenceFlow', message: 'Choose one of the active calibrations as the default flow.' }];
  return [];
}

function flowCalibration(settings) {
  if (validateFlowCalibration(settings).length) return null;
  const multiple = settings.calibrationMode === 'multiple';
  const library = calibrationLibrary(settings);
  const readings = multiple ? partitionFlowReadings(settings).active : library.filter(reading => close(reading.flow, settings.referenceFlow) && close(reading.targetTemperatureC, targetFor(settings)));
  return { mode: multiple ? 'multiple' : 'single', adjustable: multiple, minimum: readings[0].flow,
    maximum: readings[readings.length - 1].flow, defaultFlow: settings.referenceFlow, readings };
}

function secondsPerGram(settings, flow) {
  const calibration = flowCalibration(settings);
  if (!calibration) return NaN;
  const readings = calibration.readings;
  if (!calibration.adjustable) return readings[0].seconds / readings[0].milkGrams;
  if (flow < calibration.minimum || flow > calibration.maximum) return NaN;
  const exact = readings.find(reading => close(reading.flow, flow));
  if (exact) return exact.seconds / exact.milkGrams;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1], b = readings[i];
    if (flow < b.flow) {
      const position = (flow - a.flow) / (b.flow - a.flow);
      return (1 - position) * a.seconds / a.milkGrams + position * b.seconds / b.milkGrams;
    }
  }
  return NaN;
}


class CalculationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function configuredPitchers(settings) {
  return ['small', 'medium', 'large'].filter(size => {
    const weight = settings[`${size}PitcherGrams`];
    return Number.isFinite(weight) && weight >= 1 && weight <= 3000;
  });
}

function availablePitchers(settings) {
  const choices = configuredPitchers(settings);
  if (settings.autoDetect === true && settings.weightMode === 'gross' && choices.length === 3 &&
      Number.isFinite(settings.singleDrinkGrams) && settings.singleDrinkGrams >= 10 && settings.singleDrinkGrams <= 1000 &&
      ['small', 'medium'].includes(settings.singleDrinkPitcher)) choices.push('auto');
  return choices;
}

function validateSettings(settings) {
  const errors = [];
  const names = {
    referenceMilkGrams: 'Calibration milk weight', referenceSeconds: 'Calibration time',
    referenceFlow: 'Calibration flow', singleDrinkGrams: 'Usual milk per drink',
    smallPitcherGrams: 'Small pitcher weight', mediumPitcherGrams: 'Medium pitcher weight', largePitcherGrams: 'Large pitcher weight',
  };
  const range = (key, minimum, maximum, integer = false) => {
    const value = settings[key];
    if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
      errors.push({ field: key, message: `${names[key]} must be ${integer ? 'a whole number ' : ''}between ${minimum} and ${maximum}.` });
    }
  };
  if (settings.calibrationMode !== 'multiple') {
    range('referenceMilkGrams', 10, 1500);
    range('referenceSeconds', 1, 255);
  }
  errors.push(...validateFlowCalibration(settings));
  range('referenceFlow', 0.4, 2.5);
  for (const key of ['smallPitcherGrams', 'mediumPitcherGrams', 'largePitcherGrams']) range(key, settings[key] === 0 ? 0 : 1, 3000);
  if (!configuredPitchers(settings).length) errors.push({ field: 'pitchers', message: 'Enter at least one empty pitcher weight (1–3000 g).' });
  if (!['gross', 'tared'].includes(settings.weightMode)) errors.push({ field: 'weightMode', message: 'Choose gross or tared scale weight.' });
  if (!['F', 'C'].includes(settings.temperatureUnit ?? 'F')) errors.push({ field: 'temperatureUnit', message: 'Choose Fahrenheit or Celsius.' });
  if (typeof settings.autoDetect !== 'boolean') errors.push({ field: 'autoDetect', message: 'Choose whether to offer automatic pitcher detection.' });
  if (settings.autoDetect === true) {
    range('singleDrinkGrams', 10, 1000);
    if (!['small', 'medium'].includes(settings.singleDrinkPitcher)) errors.push({ field: 'singleDrinkPitcher', message: 'Choose the small or medium pitcher normally used for one drink.' });
    if (configuredPitchers(settings).length !== 3) errors.push({ field: 'pitchers', message: 'Automatic detection requires all three pitcher weights for Damian’s detection thresholds.' });
    if (settings.weightMode !== 'gross') errors.push({ field: 'weightMode', message: 'Automatic pitcher detection requires gross weight (pitcher plus milk).' });
  }
  return errors;
}

function fail(code, message) {
  throw new CalculationError(code, message);
}

function stableWeight(samples) {
  const message = 'Place the filled pitcher on the scale and wait for a fresh, stable reading.';
  if (!Array.isArray(samples) || samples.length < 3 || samples.length > 64) fail('scale_not_ready', message);
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    if (!sample || !Number.isFinite(sample.weightGrams) || !Number.isFinite(sample.ageMs) || sample.ageMs < 0 || sample.ageMs > 2500) fail('scale_not_ready', message);
    if (index > 0 && sample.ageMs >= samples[index - 1].ageMs) fail('scale_not_ready', message);
  }
  const latest = samples[samples.length - 1];
  if (latest.ageMs > 1500 || samples[0].ageMs - latest.ageMs < 500) fail('scale_not_ready', message);
  const weights = samples.map(sample => sample.weightGrams).sort((a, b) => a - b);
  if (weights[weights.length - 1] - weights[0] > 2) fail('scale_not_ready', message);
  const middle = Math.floor(weights.length / 2);
  return weights.length % 2 ? weights[middle] : (weights[middle - 1] + weights[middle]) / 2;
}

function inferredPitcher(settings, weight) {
  const singleIsSmall = settings.singleDrinkPitcher === 'small';
  const mediumThreshold = (singleIsSmall ? 1.7 : 0.7) * settings.singleDrinkGrams + settings.smallPitcherGrams;
  const largeThreshold = (singleIsSmall ? 2.7 : 1.7) * settings.singleDrinkGrams + settings.mediumPitcherGrams;
  let pitcher = 'small';
  if (weight > mediumThreshold) pitcher = 'medium';
  if (weight > largeThreshold) pitcher = 'large';
  return pitcher;
}

function calculate(settings, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_request', 'A calculation request is required.');
  if (validateSettings(settings).length) fail('configuration_required', 'Complete the calibration settings before calculating.');
  const choice = input.pitcher ?? 'auto';
  if (!['auto', 'small', 'medium', 'large'].includes(choice)) fail('invalid_request', 'Choose Auto, Small, Medium or Large pitcher.');
  if (!availablePitchers(settings).includes(choice)) fail('pitcher_not_configured', 'Configure this pitcher selection in Settings before calculating.');
  if (input.machineState !== 'idle') fail('machine_not_idle', 'Wait until the machine is idle before setting a steam time.');
  if (!Number.isFinite(input.stopAtTemperature) || input.stopAtTemperature !== 0) fail('probe_stop_active', 'Turn off milk-probe stopping before using the calibrated timer.');
  const scaleGrams = stableWeight(input.samples);
  const tared = settings.weightMode === 'tared';
  const pitcher = choice !== 'auto' ? choice : (tared ? null : inferredPitcher(settings, scaleGrams));
  const pitcherGrams = tared ? 0 : settings[`${pitcher}PitcherGrams`];
  const milkGrams = Math.round((scaleGrams - pitcherGrams) * 10) / 10;
  const pitcherLabel = tared ? 'milk only' : pitcher[0].toUpperCase() + pitcher.slice(1) + ' pitcher';
  if (milkGrams < 10) fail('invalid_milk_weight', 'Milk < 10 g · ' + pitcherLabel);
  if (milkGrams > 1500) fail('invalid_milk_weight', 'Milk > 1500 g · ' + pitcherLabel);
  const calibration = flowCalibration(settings);
  const flow = input.flow === undefined ? settings.referenceFlow : input.flow;
  if (!Number.isFinite(flow) || flow < calibration.minimum || flow > calibration.maximum) fail('flow_out_of_range', 'Choose a flow within the calibrated range.');
  const durationSeconds = Math.round(secondsPerGram(settings, flow) * milkGrams);
  if (durationSeconds < 1 || durationSeconds > 255) fail('duration_out_of_range', `Calculated time ${durationSeconds}s is outside the supported timer range of 1–255 seconds. Check the calibration and milk amount.`);
  return {
    apiVersion: 4, pitcher, pitcherSource: tared ? 'tared' : (choice === 'auto' ? 'heuristic' : 'manual'),
    scaleGrams, pitcherGrams, milkGrams, durationSeconds,
    workflowPatch: { steamSettings: { duration: durationSeconds, flow } },
  };
}

function settingsReturnUrl(currentUrl, referrer = '') {
  const current = new URL(currentUrl);
  const fallback = new URL('/api/v1/plugins/settings.reaplugin/ui', current).href;
  const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  for (const candidate of [current.searchParams.get('returnTo'), referrer]) {
    if (!candidate) continue;
    try {
      const target = new URL(candidate, current);
      const sameHost = target.hostname === current.hostname || (loopback(target.hostname) && loopback(current.hostname));
      if (sameHost && ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password &&
          !(target.origin === current.origin && target.pathname === current.pathname)) return target.href;
    } catch {}
  }
  return fallback;
}


function captureScaleWeight(samples, now) {
  const recent = samples.filter(sample => Number.isFinite(sample.weight) && now - sample.at >= 0 && now - sample.at <= 2500);
  if (!recent.length || now - recent.at(-1).at > 1500) throw new Error('Wait for a fresh scale reading.');
  if (recent.length < 3 || recent.at(-1).at - recent[0].at < 500 ||
      Math.max(...recent.map(s => s.weight)) - Math.min(...recent.map(s => s.weight)) > 2) {
    throw new Error('Wait for the scale weight to become stable.');
  }
  const values = recent.map(sample => sample.weight).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return Math.round((values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2) * 10) / 10;
}

function createCalibrationSession({ now = () => Date.now(), readWorkflow, writeSteam, requestState }) {
  let phase = 'idle', message = '', result = null, measurement = null, original = null;
  let active = false, busy = false, lastSeen = 0, lastStamp = null, state = null;
  let lease = 0, seconds = 0, previousPouring = false, seenSteam = false;
  let invalid = false, finishing = false, startRequested = false, stopRequested = false;
  let stopSentAt = -Infinity, frameSerial = 0, restoreAfterFrame = -1;
  const snapshot = () => ({ active, phase, message, seconds: Math.round(seconds * 10) / 10, result, measurement });
  const fresh = () => state && now() - lastSeen <= 3000;
  function fail(reason) {
    invalid = true;
    finishing = true;
    result = null;
    message = reason;
  }
  async function sendStop(force = false) {
    if (fresh() && !['idle', 'steam'].includes(state) && !startRequested) return;
    if (!force && now() - stopSentAt < 1000) return;
    stopSentAt = now();
    restoreAfterFrame = frameSerial;
    try { await requestState('idle'); }
    catch { message = 'Unable to confirm stop. Use the machine’s stop control; restoration will retry.'; }
  }
  async function tick() {
    if (!active || busy) return;
    if (!finishing && now() - lease > 6000) fail('Calibration cancelled because the settings page stopped responding.');
    if (!finishing && !fresh()) fail('Machine telemetry was interrupted. Repeat calibration.');
    if (finishing || stopRequested) {
      if (!fresh() || state === 'steam' || startRequested) await sendStop();
      if (!finishing || !fresh() || state !== 'idle' || startRequested || frameSerial <= restoreAfterFrame) return;
      if (busy || !active) return;
      busy = true;
      phase = 'restoring';
      try {
        await writeSteam(original);
        active = false;
        phase = invalid ? 'failed' : 'complete';
        if (!invalid) {
          result = { ...measurement, seconds: Math.round(seconds * 10) / 10 };
          message = 'Calibration complete. Review the measured values, then save.';
        }
      } catch {
        message = 'Restoring previous steam settings failed. Retrying; keep the machine connected.';
      } finally { busy = false; }
    }
  }
  return {
    snapshot,
    heartbeat() { lease = now(); return snapshot(); },
    observe(frame) {
      const stamp = Date.parse(frame?.timestamp);
      const next = frame?.state?.state;
      if (!Number.isFinite(stamp) || typeof next !== 'string') return;
      if (lastStamp !== null && stamp <= lastStamp) return;
      frameSerial++;
      if (active && !finishing && lastStamp !== null && (now() - lastSeen > 3000 || stamp - lastStamp > 3000)) {
        fail('Machine telemetry was interrupted. Repeat calibration.');
      }
      if (active && !finishing) {
        if (previousPouring && lastStamp !== null) seconds += (stamp - lastStamp) / 1000;
        if (next === 'steam') {
          seenSteam = true;
          if (frame.state.substate === 'pouring') phase = 'steaming';
          else if (frame.state.substate === 'preparingForShot') phase = 'heating';
          else if (seconds > 0 && frame.state.substate === 'pausedSteam') {
            fail('Steam was paused or interrupted. Repeat with one continuous run.');
          }
        } else if (seenSteam) {
          finishing = true;
          if (next !== 'idle' || seconds < 1 || seconds >= 254) fail('Calibration was interrupted or reached the machine timer limit. Repeat calibration.');
        } else if (next !== 'idle' && !busy) fail('Machine left idle before calibration started.');
      }
      previousPouring = next === 'steam' && frame.state.substate === 'pouring';
      state = next;
      lastSeen = now();
      lastStamp = stamp;
    },
    async begin(options) {
      if (active) throw new Error('A calibration is already active.');
      if (!fresh() || state !== 'idle') throw new Error('Wait for a connected, idle machine.');
      const { milkGrams, pitcher, pitcherGrams, flow, heaterTemperature } = options;
      const tared = pitcher === null && pitcherGrams === 0;
      const gross = ['small', 'medium', 'large'].includes(pitcher) && Number.isFinite(pitcherGrams) && pitcherGrams >= 1 && pitcherGrams <= 3000;
      if ((!tared && !gross) ||
          !Number.isFinite(milkGrams) || milkGrams < 10 || milkGrams > 1500) throw new Error('Capture a configured pitcher containing 10–1500 g of milk.');
      if (!Number.isFinite(flow) || flow < 0.4 || flow > 2.5) throw new Error('Set a calibration flow from 0.4 to 2.5 ml/s.');
      active = true; busy = true; phase = 'preparing'; message = ''; result = null; original = null;
      seconds = 0; previousPouring = false; seenSteam = false; invalid = false; finishing = false;
      startRequested = false; stopRequested = false; stopSentAt = -Infinity; restoreAfterFrame = -1; lease = now();
      measurement = { milkGrams, pitcher, pitcherGrams, flow };
      try {
        const workflow = await readWorkflow();
        const steam = workflow?.steamSettings;
        const targetTemperature = steam?.targetTemperature > 0 ? steam.targetTemperature : heaterTemperature;
        if (!Number.isInteger(targetTemperature) || targetTemperature < 135 || targetTemperature > 165) throw new Error('Enable the normal steam heater in your skin settings, then return to calibrate.');
        if (!steam || !Number.isFinite(steam.duration) || !Number.isFinite(steam.flow)) throw new Error('Previous steam settings are unavailable.');
        if (!fresh() || state !== 'idle' || finishing) throw new Error('Calibration preparation was cancelled; wait for idle.');
        original = { ...steam };
        await writeSteam({ duration: 255, flow, targetTemperature, stopAtTemperature: 0 });
        if (!finishing && !seenSteam) {
          phase = 'armed';
          message = '';
        }
      } catch (error) {
        fail(error.message);
        if (!original) { active = false; phase = 'failed'; }
        throw error;
      } finally { busy = false; }
      await tick();
      return snapshot();
    },
    async start() {
      if (!active || busy || phase !== 'armed' || !fresh() || state !== 'idle' || startRequested || finishing) throw new Error('Prepare calibration with an idle machine before starting.');
      startRequested = true;
      busy = true;
      phase = 'starting';
      try {
        const workflow = await readWorkflow();
        if (workflow?.steamSettings?.flow !== measurement.flow || workflow?.steamSettings?.duration !== 255 || workflow?.steamSettings?.stopAtTemperature !== 0) {
          throw new Error('Calibration steam settings changed. Prepare this reading again.');
        }
        if (!fresh() || state !== 'idle' || finishing || stopRequested) throw new Error('Calibration start cancelled; wait for idle.');
        await requestState('steam');
      }
      catch (error) { fail(error.message || 'Steam start could not be confirmed. Repeat calibration.'); throw error; }
      finally { busy = false; startRequested = false; }
      if (finishing || stopRequested) await sendStop(true);
      return snapshot();
    },
    async stop() {
      if (!active) return snapshot();
      stopRequested = true;
      if (phase === 'armed' && !seenSteam) fail('Calibration cancelled before steam started.');
      await sendStop();
      return snapshot();
    },
    async cancel(reason = 'Calibration cancelled. Previous steam settings restored.') {
      if (!active) return snapshot();
      fail(reason);
      await sendStop();
      await tick();
      return snapshot();
    },
    tick,
  };
}

function mountFlowCalibrationPage({ form, labels, field, updateChoices, syncFlow }, model) {
  const { calibrationLibrary, partitionFlowReadings, multipleCalibrationRequirements, calibrationKey, validFlowReading,
    temperatureToC, temperatureFromC, formatTemperature } = model;
  const make = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const panel = labels.referenceMilkGrams.closest('fieldset').parentElement;
  const manual = labels.referenceMilkGrams.closest('fieldset');
  const config = make('fieldset'); config.className = 'flow-setup';
  const configGrid = make('div'); configGrid.className = 'calibration-config-grid full-width'; config.append(configGrid);
  const support = make('div'); support.className = 'field flow-support'; support.append(make('label', 'Flow support:'));
  const supportButtons = make('div'); supportButtons.className = 'calibration-actions'; support.append(supportButtons); configGrid.append(support);
  configGrid.append(labels.weightMode, labels.temperatureUnit, labels.targetTemperatureC);
  const single = make('button', 'Single'), multipleButton = make('button', 'Multiple');
  single.type = multipleButton.type = 'button'; single.id = 'flow-mode-single'; multipleButton.id = 'flow-mode-multiple';
  supportButtons.append(single, multipleButton);
  const range = make('div'); range.className = 'field-grid full-width'; range.append(labels.minimumFlow, labels.maximumFlow); config.append(range);
  const note = make('p'); note.className = 'local-status full-width'; note.setAttribute('role', 'status'); config.append(note);
  panel.insertBefore(config, manual);

  const main = make('section'); main.id = 'active-calibrations'; panel.insertBefore(main, manual);
  const others = make('details'); others.id = 'other-calibrations';
  others.append(make('summary', 'Other saved calibrations'));
  const otherRows = make('div'); others.append(otherRows); panel.insertBefore(others, manual);
  const editor = make('section'); editor.id = 'calibration-editor'; editor.className = 'calibration-editor'; editor.hidden = true;
  const editorHome = make('div'); editorHome.hidden = true; panel.insertBefore(editorHome, manual); editorHome.append(editor);
  const editorHeader = make('div'); editorHeader.className = 'editor-header';
  const editorTitle = make('h2'); const editorCancel = make('button', 'Cancel'); editorCancel.type = 'button';
  const editorFlowLabel = make('label', 'Flow (ml/s)'); editorFlowLabel.className = 'field editor-flow';
  const editorFlow = make('input'); editorFlow.type = 'number'; editorFlow.min = '0.4'; editorFlow.max = '2.5'; editorFlow.step = '0.1'; editorFlowLabel.append(editorFlow);
  editorHeader.append(editorTitle, editorFlowLabel, editorCancel); editor.append(editorHeader);
  const methods = make('div'); methods.className = 'calibration-actions';
  const guidedButton = make('button', 'Guided calibration'), manualButton = make('button', 'Enter measured time');
  guidedButton.type = manualButton.type = 'button'; methods.append(guidedButton, manualButton); editor.append(methods);
  const methodHost = make('div'); editor.append(methodHost);
  const editorActions = make('div'); editorActions.className = 'calibration-actions';
  const update = make('button', 'Update saved flow'), close = make('button', 'Close without update');
  update.type = close.type = 'button'; editorActions.append(update, close); editor.append(editorActions);
  const newRow = make('div'); newRow.className = 'calibration-actions'; panel.insertBefore(newRow, manual);
  const newCalibration = make('button', 'New calibration'); newCalibration.type = 'button'; newRow.append(newCalibration);

  let displayedUnit = field('temperatureUnit').value || 'F';
  let readings = calibrationLibrary(settings()) || [];
  let openKey = null, draftFlow = NaN, draftTarget = NaN, guidedMode = true, locked = false;
  let guide = null, review = null, clearGuided = () => {}, measurementReady = false;

  function settings() {
    return {
      flowReadings: field('flowReadings').value,
      calibrationMode: field('calibrationMode').value,
      targetTemperatureC: temperatureToC(field('targetTemperatureC').value, field('temperatureUnit').value || 'F'),
      minimumFlow: Number(field('minimumFlow').value), maximumFlow: Number(field('maximumFlow').value),
      referenceFlow: Number(field('referenceFlow').value), referenceMilkGrams: Number(field('referenceMilkGrams').value),
      referenceSeconds: Number(field('referenceSeconds').value),
    };
  }
  const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
  function activeAndOther() {
    return partitionFlowReadings({ ...settings(), flowReadings: JSON.stringify(readings) });
  }
  function defaultReading() {
    const current = settings();
    return readings.find(reading => same(reading.flow, current.referenceFlow) && same(reading.targetTemperatureC, current.targetTemperatureC));
  }
  function syncStored() {
    readings.sort((a, b) => a.targetTemperatureC - b.targetTemperatureC || a.flow - b.flow);
    field('flowReadings').value = JSON.stringify(readings);
    const selected = defaultReading();
    if (selected) {
      field('referenceMilkGrams').value = selected.milkGrams;
      field('referenceSeconds').value = selected.seconds;
    }
    updateChoices();
  }
  function setDefault(reading) {
    field('targetTemperatureC').value = temperatureFromC(reading.targetTemperatureC, displayedUnit);
    field('referenceFlow').value = reading.flow;
    field('referenceMilkGrams').value = reading.milkGrams;
    field('referenceSeconds').value = reading.seconds;
    syncFlow(reading.flow, true); syncStored(); render();
  }
  function readingLabel(reading) {
    return reading.flow.toFixed(1) + ' ml/s · ' + formatTemperature(reading.targetTemperatureC, displayedUnit) + ' · ' + reading.milkGrams + ' g · ' + reading.seconds + ' s';
  }
  function rowFor(reading, allowDefault = true) {
    const wrapper = make('div'); wrapper.className = 'saved-calibration';
    const row = make('div'); row.className = 'saved-calibration-row'; row.append(make('span', readingLabel(reading)));
    const edit = make('button', openKey === calibrationKey(reading) ? 'Cancel' : 'Edit'); edit.type = 'button';
    edit.addEventListener('click', () => openKey === calibrationKey(reading) ? cancelEditor() : openEditor(reading)); row.append(edit);
    const remove = make('button', 'Delete'); remove.type = 'button'; remove.addEventListener('click', () => {
      if (locked) return; readings = readings.filter(item => calibrationKey(item) !== calibrationKey(reading));
      if (openKey === calibrationKey(reading)) cancelEditor();
      const remaining = readings.filter(item => same(item.targetTemperatureC, settings().targetTemperatureC));
      if (!defaultReading() && remaining.length) setDefault(remaining.sort((a, b) => a.flow - b.flow)[0]);
      else { syncStored(); render(); }
    }); row.append(remove);
    if (allowDefault) {
      const label = make('label'); label.className = 'default-choice';
      const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = calibrationKey(defaultReading() || {}) === calibrationKey(reading);
      checkbox.addEventListener('change', () => { if (checkbox.checked) setDefault(reading); }); label.append(checkbox, make('span', 'Default')); row.append(label);
    }
    wrapper.append(row);
    if (openKey === calibrationKey(reading)) wrapper.append(editor);
    return wrapper;
  }
  function missingRow(kind, flow) {
    const wrapper = make('div'); wrapper.className = 'saved-calibration missing-calibration';
    const row = make('div'); row.className = 'saved-calibration-row';
    row.append(make('span', kind + ' reading · ' + flow.toFixed(1) + ' ml/s · required'));
    const key = 'new:' + kind;
    const button = make('button', openKey === key ? 'Cancel' : 'Create reading'); button.type = 'button';
    button.addEventListener('click', () => openKey === key ? cancelEditor() : openEditor(null, flow, key)); row.append(button);
    wrapper.append(row); if (openKey === key) wrapper.append(editor); return wrapper;
  }
  function openEditor(reading, flow, key) {
    if (locked) return;
    openKey = key || calibrationKey(reading); draftFlow = Number(reading?.flow ?? flow ?? field('referenceFlow').value);
    draftTarget = Number(reading?.targetTemperatureC ?? settings().targetTemperatureC);
    field('referenceMilkGrams').value = reading?.milkGrams || '';
    field('referenceSeconds').value = reading?.seconds || '';
    editorFlow.value = draftFlow; measurementReady = false; clearGuided(); editor.hidden = false; render();
  }
  function cancelEditor() { openKey = null; editor.hidden = true; measurementReady = false; clearGuided(); syncStored(); render(); }
  function setMethod(guidedSelected) { guidedMode = guidedSelected; paintEditor(); }
  function paintEditor() {
    if (!openKey) return;
    editorTitle.textContent = (openKey.startsWith('new:') ? 'New calibration · ' : 'Edit calibration · ') + draftFlow.toFixed(1) + ' ml/s · ' + formatTemperature(draftTarget, displayedUnit);
    editorFlowLabel.hidden = !openKey.startsWith('new:'); editorFlow.disabled = locked;
    guidedButton.setAttribute('aria-pressed', String(guidedMode)); manualButton.setAttribute('aria-pressed', String(!guidedMode));
    if (guide && review) { guide.hidden = !guidedMode; review.hidden = guidedMode; review.open = true; }
    update.disabled = locked || (guidedMode && !measurementReady && !validFlowReading({ flow: draftFlow, targetTemperatureC: draftTarget, milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) }));
  }
  function saveEditor() {
    const reading = { flow: draftFlow, targetTemperatureC: draftTarget, milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) };
    if (!validFlowReading(reading)) { note.textContent = 'Enter 10–1500 g of milk and 1–255 seconds.'; return; }
    const oldKey = openKey.startsWith('new:') ? null : openKey;
    const duplicate = readings.find(item => calibrationKey(item) === calibrationKey(reading) && calibrationKey(item) !== oldKey);
    if (duplicate) { note.textContent = 'A calibration at this flow and target temperature already exists.'; return; }
    readings = readings.filter(item => calibrationKey(item) !== oldKey); readings.push(reading);
    if (!defaultReading() || field('calibrationMode').value === 'single' && readings.length === 1) setDefault(reading);
    openKey = null; editor.hidden = true; syncStored(); render();
  }
  function render() {
    if (!openKey) { editor.hidden = true; editorHome.append(editor); }
    const isMultiple = field('calibrationMode').value === 'multiple';
    single.setAttribute('aria-pressed', String(!isMultiple)); multipleButton.setAttribute('aria-pressed', String(isMultiple));
    range.hidden = !isMultiple; newCalibration.hidden = isMultiple;
    main.replaceChildren(); otherRows.replaceChildren();
    const { active, other } = activeAndOther();
    if (!isMultiple) {
      main.append(make('p', readings.length ? 'Saved calibrations' : 'No saved calibrations yet. Create the first calibration.'));
      readings.forEach(reading => main.append(rowFor(reading, true)));
      newCalibration.textContent = openKey === 'new:single' ? 'Cancel' : (readings.length ? 'New calibration' : 'Create first calibration');
      others.hidden = true;
      note.textContent = 'Single uses only the calibration checked as Default.';
    } else {
      main.append(make('p', 'Calibrations used for ' + formatTemperature(settings().targetTemperatureC, displayedUnit) + ' within the selected range'));
      active.forEach((reading, index) => { main.append(rowFor(reading, true)); if (index < active.length - 1) { const arrow = make('div', '↓'); arrow.className = 'reading-arrow'; main.append(arrow); } });
      const required = multipleCalibrationRequirements({ ...settings(), flowReadings: JSON.stringify(readings) });
      const min = Number(field('minimumFlow').value), max = Number(field('maximumFlow').value);
      if (!required.hasMinimum) main.append(missingRow('Minimum', min));
      if (!required.hasInterior) main.append(missingRow('Interior', Math.round(((min + max) / 2) * 10) / 10));
      if (!required.hasMaximum) main.append(missingRow('Maximum', max));
      other.forEach(reading => otherRows.append(rowFor(reading, false)));
      others.hidden = !other.length;
      note.textContent = required.active.length >= 3 && required.hasMinimum && required.hasMaximum && required.hasInterior
        ? 'All ' + required.active.length + ' matching calibrations will be used for piecewise interpolation.'
        : 'Add the exact minimum, exact maximum, and at least one interior reading. A reading near the middle is recommended.';
    }
    if (openKey && openKey === 'new:single') newRow.append(editor);
    paintEditor(); updateChoices();
  }
  function mode(value) {
    if (locked) return; field('calibrationMode').value = value;
    if (value === 'multiple') {
      const active = activeAndOther().active;
      if (active.length && !active.some(item => same(item.flow, field('referenceFlow').value))) setDefault(active[0]);
    }
    cancelEditor();
  }
  single.addEventListener('click', () => mode('single')); multipleButton.addEventListener('click', () => mode('multiple'));
  newCalibration.addEventListener('click', () => openKey === 'new:single' ? cancelEditor() : openEditor(null, Number(field('referenceFlow').value), 'new:single'));
  editorCancel.addEventListener('click', cancelEditor); close.addEventListener('click', cancelEditor);
  guidedButton.addEventListener('click', () => setMethod(true)); manualButton.addEventListener('click', () => setMethod(false)); update.addEventListener('click', saveEditor);
  editorFlow.addEventListener('input', () => { draftFlow = Number(editorFlow.value); measurementReady = false; clearGuided(); paintEditor(); });
  function applyTemperaturePresentation() {
    labels.targetTemperatureC.children[0].textContent = 'Target temp (°' + displayedUnit + ') — required';
    field('targetTemperatureC').min = displayedUnit === 'F' ? '32.2' : '0.1';
    field('targetTemperatureC').max = displayedUnit === 'F' ? '212' : '100';
    field('targetTemperatureC').step = '0.1';
  }
  field('temperatureUnit').addEventListener('change', () => {
    const raw = field('targetTemperatureC').value.trim();
    const canonical = raw === '' ? NaN : temperatureToC(raw, displayedUnit);
    displayedUnit = field('temperatureUnit').value || 'F';
    if (Number.isFinite(canonical)) field('targetTemperatureC').value = temperatureFromC(canonical, displayedUnit);
    applyTemperaturePresentation(); render();
  });
  for (const input of [field('targetTemperatureC'), field('minimumFlow'), field('maximumFlow')]) input.addEventListener('change', () => { cancelEditor(); render(); });
  form.addEventListener('input', event => { if (event.target === field('referenceMilkGrams') || event.target === field('referenceSeconds')) { measurementReady = false; paintEditor(); } });
  applyTemperaturePresentation(); syncStored(); render();
  return {
    currentFlow: () => draftFlow,
    currentTargetLabel: () => formatTemperature(draftTarget, displayedUnit),
    attach(guided, measured, flowLabel, clear) {
      guide = guided; review = measured; clearGuided = clear;
      flowLabel.hidden = true; methodHost.append(guided, measured); paintEditor();
    },
    lock(value) { locked = value; for (const button of [single, multipleButton, newCalibration, editorCancel, close, update, guidedButton, manualButton]) button.disabled = value; paintEditor(); },
    acceptMeasurement(result) {
      if (!same(result.flow, draftFlow)) throw new Error('The measurement flow changed. Repeat this reading.');
      field('referenceMilkGrams').value = result.milkGrams; field('referenceSeconds').value = result.seconds;
      measurementReady = true; paintEditor();
    },
    flowChanged() { render(); },
    reveal() { render(); },
    assertCanSave() {
      if (openKey) throw Object.assign(new Error('Update or close the open calibration before saving.'), { field: 'flowReadings' });
      const target = settings().targetTemperatureC;
      if (!Number.isFinite(target) || target <= 0 || target > 100) throw Object.assign(new Error('Enter the required target milk temperature in the selected unit.'), { field: 'targetTemperatureC' });
      syncStored();
    },
  };
}

function mountCalibrationPage({ form, labels, save, back, status, request, base, field, updateChoices, syncFlow, flowPlan }, captureWeight) {
  const sizes = ['small', 'medium', 'large'];
  let samples = [], zeroConfirmed = false, awaitingZero = false, tarePending = false;
  let captured = null, token = null, active = false, pending = false, timer = null, closed = false;
  let sessionPhase = 'idle';
  let returnAfterRestore = false, appliedResult = false, scaleSocket = null;
  const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
  const button = (text, parent, action, feedback) => {
    const element = make('button', text); element.type = 'button'; parent.append(element);
    element.addEventListener('click', async () => {
      try { await action(); } catch (error) { (feedback || runStatus).textContent = error.message; }
    });
    return element;
  };
  const weights = labels.smallPitcherGrams.closest('fieldset');
  const scaleBox = make('div'); scaleBox.className = 'full-width';
  const scaleTools = make('div'); scaleTools.className = 'scale-tools';
  const scaleValue = make('p', 'Scale disconnected. Manual entry is available.');
  const scaleHelp = make('p', 'Tare with nothing on the scale. Wait for zero, then place an empty pitcher.');
  scaleHelp.className = 'local-status'; scaleHelp.setAttribute('role', 'status');
  scaleTools.append(scaleValue); scaleBox.append(scaleTools, scaleHelp);
  weights.insertBefore(scaleBox, labels.smallPitcherGrams);
  const guided = make('fieldset'); guided.className = 'guided-calibration';
  const flowLabel = make('label', 'Auto flow / default (ml/s)'); flowLabel.className = 'field calibration-flow';
  const flow = make('input'); flow.id = 'calibration-flow'; flow.type = 'number'; flow.min = '0.4'; flow.max = '2.5'; flow.step = '0.1'; flow.value = field('referenceFlow').value;
  flow.addEventListener('input', () => syncFlow(flow.value)); flowLabel.append(flow); guided.append(flowLabel);
  const weighStep = make('div'); weighStep.className = 'guided-step';
  const pitcherLabel = make('label', 'Calibration pitcher'); pitcherLabel.className = 'field';
  const pitcher = make('select'); pitcher.setAttribute('aria-label', 'Calibration pitcher'); pitcherLabel.append(pitcher); weighStep.append(pitcherLabel);
  const milkTools = make('div'); milkTools.className = 'scale-tools';
  const readings = make('div');
  const calibrationScaleValue = make('p', 'Scale reading: disconnected');
  const derivedMilk = make('p', 'Derived milk weight (g): —'); readings.append(calibrationScaleValue, derivedMilk); milkTools.append(readings); weighStep.append(milkTools);
  const milkActions = make('div'); milkActions.className = 'calibration-actions'; weighStep.append(milkActions);
  const milk = make('p', 'Tare, then capture a fresh stable milk weight.'); milk.className = 'local-status'; milk.setAttribute('role', 'status'); milk.setAttribute('aria-live', 'polite');
  weighStep.append(milk); guided.append(weighStep);
  const steamStep = make('div'); steamStep.className = 'guided-step';
  const elapsed = make('p', 'Steaming: 0.0 s'); elapsed.className = 'calibration-timer'; steamStep.append(elapsed);
  const actions = make('div'); actions.className = 'calibration-actions'; steamStep.append(actions);
  const runStatus = make('p', 'Capture the milk weight to arm calibration.'); runStatus.className = 'local-status';
  runStatus.setAttribute('role', 'status'); runStatus.setAttribute('aria-live', 'polite'); steamStep.append(runStatus); guided.append(steamStep);
  const help = make('details'); help.append(make('summary', 'Calibration tips'));
  help.append(make('p', 'Use similar milk, starting temperature, heater setting and technique. Gross mode subtracts the selected empty pitcher. Tared mode expects the empty pitcher to be on the scale when you tare. Capture applies the selected flow and arms timing; use the physical machine controls to start and stop steam. Warm-up is excluded.'));
  guided.append(help);
  const manual = labels.referenceMilkGrams.closest('fieldset');
  const calibrationPanel = manual.parentElement;
  calibrationPanel.insertBefore(guided, manual);
  const review = make('details');
  calibrationPanel.insertBefore(review, manual); review.append(manual);
  function setScaleMessage(text) { scaleValue.textContent = text; calibrationScaleValue.textContent = text; }
  const captureButtons = [];
  function weight() {
    if (!zeroConfirmed || tarePending || awaitingZero) throw new Error('Tare the empty scale and wait for a stable zero first.');
    return captureWeight(samples, Date.now());
  }
  function clearCapture() {
    captured = null;
    milk.textContent = 'Tare, then capture a fresh stable milk weight.';
    derivedMilk.textContent = 'Derived milk weight (g): —';
    if (!active && !pending) runStatus.textContent = 'Capture the milk weight to arm calibration.';
  }
  async function tare() {
    if (active || pending) throw new Error('Finish or cancel calibration before taring.');
    zeroConfirmed = false; awaitingZero = false; tarePending = true; samples = []; clearCapture(); paint();
    try {
      await request('/api/v1/scale/tare', { method: 'PUT' });
      samples = []; awaitingZero = true;
      setScaleMessage('Keep the scale empty. Waiting for a stable zero…');
      scaleHelp.textContent = milk.textContent = 'Wait for a stable zero before placing the pitcher.';
    } finally { tarePending = false; paint(); }
  }
  const tarePitchers = button('Tare empty scale', scaleTools, tare, scaleHelp);
  for (const size of sizes) {
    const result = make('p'); result.className = 'capture-result'; result.setAttribute('role', 'status');
    const capture = button('Set from scale', labels[size + 'PitcherGrams'], () => {
      const value = weight();
      if (value < 1 || value > 3000) throw new Error('Place an empty pitcher on the scale (1–3000 g).');
      field(size + 'PitcherGrams').value = value;
      clearCapture(); updateChoices(); updatePitchers();
      result.textContent = size[0].toUpperCase() + size.slice(1) + ' pitcher set to ' + value + ' g.';
    }, result);
    capture.className = 'capture-button'; labels[size + 'PitcherGrams'].append(result); captureButtons.push(capture);
  }
  const tareMilk = button('Tare', milkActions, tare, milk);
  const captureMilk = button('Capture pitcher + milk (g)', milkActions, async () => {
    const tared = field('weightMode').value === 'tared';
    const size = pitcher.value, pitcherGrams = tared ? 0 : Number(field(size + 'PitcherGrams')?.value);
    if (!tared && (!sizes.includes(size) || !(pitcherGrams >= 1 && pitcherGrams <= 3000))) throw new Error('Configure and choose a pitcher first.');
    const total = weight(), milkGrams = Math.round((total - pitcherGrams) * 10) / 10;
    const name = tared ? 'Tared' : size[0].toUpperCase() + size.slice(1);
    if (milkGrams < 10) throw new Error('Milk < 10 g · ' + name + ' pitcher');
    if (milkGrams > 1500) throw new Error('Milk > 1500 g · ' + name + ' pitcher');
    captured = { pitcher: tared ? null : size, pitcherGrams, milkGrams };
    derivedMilk.textContent = 'Derived milk weight (g): ' + milkGrams;
    milk.textContent = 'Milk weight captured. Start steam now, then stop steam when the milk reaches ' + flowPlan.currentTargetLabel() + '.';
    pending = true; appliedResult = false; paint();
    try {
      const heaterTemperature = Number(new URL(window.location.href).searchParams.get('steamHeaterTemperature'));
      await command('begin', { ...captured, flow: flowPlan.currentFlow(),
        ...(Number.isInteger(heaterTemperature) && heaterTemperature >= 135 && heaterTemperature <= 165 ? { heaterTemperature } : {}) });
    } finally {
      pending = false; paint();
      if (returnAfterRestore && active) await command('cancel');
    }
  }, milk);
  async function command(action, values = {}) {
    try {
      const result = await request(base + '/calibration', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, token, ...values }) });
      accept(result);
      return result;
    } catch (error) {
      if (error.data?.token) accept(error.data);
      throw error;
    }
  }
  function schedule() {
    if (timer !== null || !active || closed) return;
    timer = setTimeout(async () => {
      timer = null;
      try { await command('heartbeat'); }
      catch (error) { runStatus.textContent = error.message + ' If steaming, use the machine’s stop control.'; }
      finally { schedule(); }
    }, 500);
  }
  function accept(value) {
    sessionPhase = value.phase;
    token = value.token ?? token; active = value.active === true;
    runStatus.textContent = value.message || ({ armed: 'Ready to start.', starting: 'Waiting for steam to start…', heating: 'Heating — counter will start when steam flows.', steaming: 'Stop when the milk reaches your desired temperature.', restoring: 'Restoring previous steam settings…' }[value.phase] ?? value.phase);
    elapsed.textContent = 'Steaming: ' + Number(value.seconds || 0).toFixed(1) + ' s';
    if (value.result && !appliedResult) {
      appliedResult = true; captured = null;
      flowPlan.acceptMeasurement(value.result);
      review.open = true;
      runStatus.textContent = 'Measured ' + value.result.milkGrams + ' g milk in ' + value.result.seconds + ' s at ' + value.result.flow + ' ml/s.';
      milk.textContent = 'Need to try again? Capture pitcher + milk weight again to start a new timer.';
    }
    paint(); schedule();
    if (returnAfterRestore && !active) { closed = true; window.location.assign(back.href); }
  }
  const cancel = button('Cancel calibration', actions, () => command('cancel'));
  function paint() {
    const locked = active || pending;
    for (const key of Object.keys(labels)) field(key).disabled = locked;
    flow.disabled = locked;
    flowPlan.lock(locked);
    if (!locked) updateChoices();
    for (const control of [tarePitchers, tareMilk, ...captureButtons, captureMilk, pitcher]) control.disabled = locked || tarePending;
    cancel.disabled = !active;
    save.disabled = locked;
    const tared = field('weightMode').value === 'tared';
    pitcherLabel.hidden = tared;
    captureMilk.textContent = tared ? 'Capture milk only (g)' : 'Capture pitcher + milk (g)';
    scaleHelp.textContent = zeroConfirmed ? (tared ? 'Zero confirmed with the empty pitcher. Add milk, then capture.' : 'Zero confirmed. Place pitcher plus milk, then capture.') : (tared ? 'Place the empty pitcher on the scale, then tare.' : 'Tare with nothing on the scale.');
  }
  function updatePitchers() {
    const previous = pitcher.value;
    pitcher.replaceChildren();
    for (const size of sizes) {
      const grams = Number(field(size + 'PitcherGrams').value);
      if (!(grams >= 1 && grams <= 3000)) continue;
      const option = make('option', size[0].toUpperCase() + size.slice(1)); option.value = size; pitcher.append(option);
    }
    if (sizes.includes(previous) && Number(field(previous + 'PitcherGrams').value) >= 1) pitcher.value = previous;
    paint();
  }
  form.addEventListener('input', event => {
    if (event.target === pitcher || event.target?.name?.endsWith('PitcherGrams')) { clearCapture(); updatePitchers(); }

  });
  pitcher.addEventListener('change', () => { clearCapture(); paint(); });
  field('weightMode').addEventListener('change', () => { clearCapture(); zeroConfirmed = false; paint(); });
  back.addEventListener('click', async event => {
    if (!active && !pending) return;
    event.preventDefault(); returnAfterRestore = true;
    if (pending) return;
    try { await command('cancel'); } catch (error) { status.textContent = error.message; }
  });
  function connectScale() {
    if (closed) return;
    const url = new URL('/ws/v1/scale/snapshot', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    scaleSocket = new WebSocket(url.href);
    scaleSocket.onmessage = event => {
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (data.status === 'disconnected' || data.status === 'connected') {
        samples = []; zeroConfirmed = false; awaitingZero = false;
        if (!active) clearCapture();
        setScaleMessage(data.status === 'connected' ? 'Scale connected. Tare the empty scale before capture.' : 'Scale disconnected. Reconnect and tare the empty scale before capture.'); paint(); return;
      }
      if (!Number.isFinite(data.weight) || tarePending) return;
      const now = Date.now();
      samples.push({ weight: data.weight, at: now }); samples = samples.filter(s => now - s.at <= 2500).slice(-64);
      if (awaitingZero) {
        try {
          if (Math.abs(captureWeight(samples, now)) <= 0.5) {
            awaitingZero = false; zeroConfirmed = true; samples = [];
            setScaleMessage('Scale reading: 0.0 g - stable');
            scaleHelp.textContent = milk.textContent = 'Zero confirmed. Now place the pitcher on the scale.';
          }
        } catch {}
      } else {
        let stable = false;
        try { captureWeight(samples, now); stable = true; } catch {}
        setScaleMessage('Scale: ' + data.weight.toFixed(1) + ' g · ' + (stable ? 'Stable' : 'Settling…'));
        if (!zeroConfirmed) scaleHelp.textContent = milk.textContent = 'Tare the empty scale before capture.';
      }
    };
    scaleSocket.onclose = () => {
      samples = []; zeroConfirmed = false; awaitingZero = false;
      if (!active) clearCapture();
      setScaleMessage('Scale connection lost. Reopen settings to reconnect, or enter weights manually.'); paint();
    };
  }
  window.addEventListener('pagehide', () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    scaleSocket?.close();
    if (active && token) fetch(base + '/calibration', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel', token }) }).catch(() => {});
  });
  flowPlan.attach(guided, review, flowLabel, () => { clearCapture(); zeroConfirmed = false; samples = []; appliedResult = false; elapsed.textContent = 'Steaming: 0.0 s'; paint(); });
  updatePitchers();
  connectScale();
  return { isActive: () => active || pending, flowChanged() { appliedResult = false; runStatus.textContent = 'Flow changed. Repeat calibration or enter a time measured at this flow.'; }, assertCanSave() { if (active || pending) throw new Error('Finish or cancel calibration before saving.'); } };
}

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

globalThis.createPlugin = function createPlugin() {
  let settings = {};
  let loaded = false;
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

  return {
    id: MANIFEST.id,
    version: MANIFEST.version,
    onLoad(values = {}) {
      settings = configured(values);
      if (settings.referenceFlow === 0) settings.referenceFlow = defaults.referenceFlow;
      loaded = true;
    },
    onUnload() {
      loaded = false; settings = {};
      if (calibrationTimer !== null) clearTimeout(calibrationTimer);
      calibrationTimer = null;
      if (calibrationActive()) calibration.cancel('Extension unloaded; calibration is incomplete.');
    },
    onEvent(event) {
      if (event.name !== 'stateUpdate') return;
      latestMachine = event.payload;
      latestMachineAt = Date.now();
      calibration?.observe(event.payload);
    },
    __httpRequestHandler(request) {
      if (!loaded) return json(503, { code: 'plugin_disabled', message: 'Enable the calibrated steam plugin.' });
      const { endpoint, method, body } = request;
      const methods = { status: 'GET', calculate: 'POST', validate: 'POST', ui: 'GET', calibration: 'POST' };
      if (!methods[endpoint]) return json(404, { code: 'not_found', message: 'Unknown endpoint.' });
      if (method !== methods[endpoint]) return json(405, { code: 'method_not_allowed', message: `Use ${methods[endpoint]}.` });
      if (endpoint === 'calibration') return calibrationRequest(body);
      if (endpoint === 'status') return json(200, { apiVersion: 4, version: MANIFEST.version, calibrationActive: calibrationActive(), ready: validateSettings(settings).length === 0, settings, flowCalibration: flowCalibration(settings), availablePitchers: availablePitchers(settings), errors: validateSettings(settings), schema: MANIFEST.settings });
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


})();
