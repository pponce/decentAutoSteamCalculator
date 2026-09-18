/* Calibrated Steam Timer. GPL-3.0-only. Inspired by Damian / Damian-AU, DSx2. */
(function () {
"use strict";
const MANIFEST = {"id":"calibrated-steam.reaplugin","name":"Auto Steam Calculator","author":"pponce; calculation and pitcher heuristic inspired by Damian / Damian-AU (DSx2)","description":"Estimate steam duration from milk weight using your calibration. Inspired by Damian's DSx2 calculator. This estimates temperature through time; it does not measure milk temperature.","version":"0.13.2-beta.8","apiVersion":1,"permissions":["api","events.machine","pluginStorage"],"settings":{"smallPitcherGrams":{"type":"number","label":"Small empty pitcher (g)","description":"Untared weight of the empty small pitcher. Leave blank or 0 if not configured.","default":0},"mediumPitcherGrams":{"type":"number","label":"Medium empty pitcher (g)","description":"Untared weight of the empty medium pitcher. Leave blank or 0 if not configured.","default":0},"largePitcherGrams":{"type":"number","label":"Large empty pitcher (g)","description":"Untared weight of the empty large pitcher. Leave blank or 0 if not configured.","default":0},"singleDrinkGrams":{"type":"number","label":"Usual milk per drink (g)","description":"Milk only for one drink; used to infer pitcher size in Auto. This can differ from your calibration milk weight.","default":0},"singleDrinkPitcher":{"type":"enum","label":"Pitcher normally used for one drink","description":"Select small or medium to choose the pitcher-detection thresholds.","values":["","small","medium"],"default":""},"weightMode":{"type":"enum","label":"Scale weight mode","description":"One global choice for every calibration. Gross includes the empty pitcher. Tared is milk only: pitcher size cannot be inferred and no pitcher weight is subtracted.","values":["gross","tared"],"default":"gross"},"temperatureUnit":{"type":"enum","label":"Temperature unit","description":"Display preference for calibration targets. Saved calibration temperatures remain stored internally in Celsius.","values":["F","C"],"default":"F"},"targetTemperatureC":{"type":"number","label":"Milk target","description":"Filters which saved calibrations are available. All targets is available when Interpolate is off.","default":0},"referenceMilkGrams":{"type":"number","label":"Calibration milk weight (g)","description":"Actual measured milk weight for this reading, excluding the pitcher. Enter it manually or capture it from the scale during guided calibration. Each reading uses its own measured weight.","default":0},"referenceSeconds":{"type":"number","label":"Time to your desired milk temperature (s)","description":"Actual steaming time in the calibration run. Use similar milk, starting temperature and steaming technique for subsequent drinks.","default":0},"referenceFlow":{"type":"number","label":"Calibration flow (ml/s)","description":"Flow used while creating or editing a saved calibration (0.4–2.5 ml/s).","default":0.4},"minimumFlow":{"type":"number","label":"Minimum flow (ml/s)","description":"Lowest flow used by Interpolate. A saved reading is required at this exact flow.","default":0.4},"maximumFlow":{"type":"number","label":"Maximum flow (ml/s)","description":"Highest flow used by Interpolate. A saved reading is required at this exact flow.","default":2.5},"autoDetect":{"type":"boolean","label":"Offer Auto pitcher selection","description":"Enable automatic detection using Damian’s heuristic. Requires all three pitcher weights, gross scale weight, usual milk per drink and the pitcher normally used for one drink.","default":false},"interpolate":{"type":"boolean","label":"Interpolate","default":false,"description":"Use piecewise interpolation between at least three saved readings at one milk target."},"flowReadings":{"type":"string","label":"Measured flow calibrations","default":"[]","description":"Compatibility shadow managed by the Calibration page while saved readings migrate to Decaid plugin storage. Do not edit this JSON directly."}},"api":[{"id":"status","type":"http","data":{}},{"id":"calculate","type":"http","data":{}},{"id":"validate","type":"http","data":{}},{"id":"ui","type":"http","data":{}},{"id":"calibration","type":"http","data":{}},{"id":"library","type":"http","data":{}}]};
const FLOW_MINIMUM = 0.4;
const FLOW_MAXIMUM = 2.5;
const MAX_READINGS = 100;

const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
const selectedTarget = settings => Number(settings.targetTemperatureC) > 0 ? Number(settings.targetTemperatureC) : 0;

function normalizeCurveFitTargets(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(Number).filter(target => Number.isFinite(target) && target > 0 && target <= 100))].sort((a, b) => a - b);
  } catch { return []; }
}

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
  const parsed = readFlowReadings(settings);
  if (!parsed) return null;
  return parsed.map(reading => ({ ...reading })).sort((a, b) => a.targetTemperatureC - b.targetTemperatureC || a.flow - b.flow);
}

function availableTargets(settings) {
  const readings = calibrationLibrary(settings);
  if (!readings) return [];
  return [...new Set(readings.filter(validFlowReading).map(reading => Number(reading.targetTemperatureC)))].sort((a, b) => a - b);
}

function partitionFlowReadings(settings) {
  const readings = calibrationLibrary(settings);
  if (!readings) return { active: [], other: [], invalid: true };
  const target = selectedTarget(settings), interpolate = settings.interpolate === true;
  const minimum = Number(settings.minimumFlow ?? FLOW_MINIMUM), maximum = Number(settings.maximumFlow ?? FLOW_MAXIMUM);
  const active = [], other = [];
  for (const reading of readings) {
    const targetMatches = target === 0 || close(reading.targetTemperatureC, target);
    const rangeMatches = !interpolate || reading.flow >= minimum && reading.flow <= maximum;
    if (validFlowReading(reading) && targetMatches && rangeMatches) active.push(reading);
    else other.push(reading);
  }
  return { active: active.sort((a, b) => a.targetTemperatureC - b.targetTemperatureC || a.flow - b.flow), other, invalid: false };
}

function interpolationRequirements(settings) {
  const minimum = Number(settings.minimumFlow ?? FLOW_MINIMUM), maximum = Number(settings.maximumFlow ?? FLOW_MAXIMUM);
  const { active } = partitionFlowReadings({ ...settings, interpolate: true });
  return { active,
    hasMinimum: active.some(reading => close(reading.flow, minimum)),
    hasMaximum: active.some(reading => close(reading.flow, maximum)),
    hasInterior: active.some(reading => reading.flow > minimum && reading.flow < maximum) };
}

function piecewiseRate(readings, flow) {
  const exact = readings.find(reading => close(reading.flow, flow));
  if (exact) return exact.seconds / exact.milkGrams;
  for (let index = 1; index < readings.length; index += 1) {
    const left = readings[index - 1], right = readings[index];
    if (flow < right.flow) {
      const position = (flow - left.flow) / (right.flow - left.flow);
      return (1 - position) * left.seconds / left.milkGrams + position * right.seconds / right.milkGrams;
    }
  }
  return NaN;
}

function linearFit(points) {
  const count = points.length;
  if (count < 2) return null;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const denominator = count * sumXX - sumX * sumX;
  if (Math.abs(denominator) < 1e-12) return null;
  const slope = (count * sumXY - sumX * sumY) / denominator;
  return { intercept: (sumY - slope * sumX) / count, slope };
}

function solveThree(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let item = column; item < 4; item += 1) rows[column][item] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const multiplier = rows[row][column];
      for (let item = column; item < 4; item += 1) rows[row][item] -= multiplier * rows[column][item];
    }
  }
  return rows.map(row => row[3]);
}

function fitCurve(kind, readings) {
  const points = readings.map(reading => ({ x: reading.flow, y: reading.seconds / reading.milkGrams }));
  if (kind === 'quadratic') {
    if (points.length < 3) return null;
    const sums = power => points.reduce((sum, point) => sum + point.x ** power, 0);
    const coefficients = solveThree(
      [[sums(4), sums(3), sums(2)], [sums(3), sums(2), sums(1)], [sums(2), sums(1), points.length]],
      [points.reduce((sum, point) => sum + point.x * point.x * point.y, 0), points.reduce((sum, point) => sum + point.x * point.y, 0), points.reduce((sum, point) => sum + point.y, 0)],
    );
    return coefficients && { kind, predict: flow => coefficients[0] * flow * flow + coefficients[1] * flow + coefficients[2] };
  }
  const transformed = points.map(point => {
    if (kind === 'inverse') return { x: 1 / point.x, y: point.y };
    if (kind === 'exponential') return { x: point.x, y: Math.log(point.y) };
    return { x: Math.log(point.x), y: Math.log(point.y) };
  });
  const fit = linearFit(transformed);
  if (!fit) return null;
  if (kind === 'inverse') return { kind, predict: flow => fit.intercept + fit.slope / flow };
  if (kind === 'exponential') return { kind, predict: flow => Math.exp(fit.intercept + fit.slope * flow) };
  return { kind, predict: flow => Math.exp(fit.intercept + fit.slope * Math.log(flow)) };
}

function safeCurve(model, readings) {
  if (!model || readings.length < 2) return false;
  const minimum = readings[0].flow, maximum = readings.at(-1).flow;
  const observed = readings.map(reading => reading.seconds / reading.milkGrams);
  const lower = Math.min(...observed) * 0.95, upper = Math.max(...observed) * 1.05;
  for (const reading of readings) {
    const predicted = model.predict(reading.flow), actual = reading.seconds / reading.milkGrams;
    if (!Number.isFinite(predicted) || predicted <= 0 || Math.abs(predicted - actual) / actual > 0.3) return false;
  }
  let previous = Infinity;
  for (let index = 0; index <= 100; index += 1) {
    const value = model.predict(minimum + (maximum - minimum) * index / 100);
    if (!Number.isFinite(value) || value <= 0 || value < lower || value > upper || value > previous + 1e-9) return false;
    previous = value;
  }
  return true;
}

function crossValidationError(kind, readings) {
  const errors = [];
  for (let index = 1; index < readings.length - 1; index += 1) {
    const held = readings[index], training = readings.filter((_, item) => item !== index);
    const model = fitCurve(kind, training);
    if (!model || !safeCurve(model, training)) return Infinity;
    const predicted = model.predict(held.flow), actual = held.seconds / held.milkGrams;
    if (!Number.isFinite(predicted) || predicted <= 0) return Infinity;
    errors.push(((predicted - actual) / actual) ** 2);
  }
  return errors.length ? Math.sqrt(errors.reduce((sum, error) => sum + error, 0) / errors.length) : Infinity;
}

function smoothCurveModel(readings) {
  const sorted = readings.filter(validFlowReading).slice().sort((a, b) => a.flow - b.flow);
  if (sorted.length < 3) return { kind: 'linear', predict: flow => piecewiseRate(sorted, flow) };
  const baselineErrors = [];
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const left = sorted[index - 1], held = sorted[index], right = sorted[index + 1];
    const position = (held.flow - left.flow) / (right.flow - left.flow);
    const predicted = (1 - position) * left.seconds / left.milkGrams + position * right.seconds / right.milkGrams;
    baselineErrors.push(((predicted - held.seconds / held.milkGrams) / (held.seconds / held.milkGrams)) ** 2);
  }
  const baseline = Math.sqrt(baselineErrors.reduce((sum, error) => sum + error, 0) / baselineErrors.length);
  const candidates = ['inverse', 'exponential', 'power', ...(sorted.length >= 5 ? ['quadratic'] : [])]
    .map(kind => ({ kind, model: fitCurve(kind, sorted), error: crossValidationError(kind, sorted) }))
    .filter(candidate => safeCurve(candidate.model, sorted) && Number.isFinite(candidate.error))
    .sort((a, b) => a.error - b.error);
  const best = candidates[0];
  if (!best || baseline < 1e-9 || best.error >= baseline * 0.9) return { kind: 'linear', predict: flow => piecewiseRate(sorted, flow) };
  return best.model;
}

function interpolationModel(settings, target = selectedTarget(settings)) {
  const interpolationSettings = { ...settings, interpolate: true, targetTemperatureC: target };
  const readings = partitionFlowReadings(interpolationSettings).active;
  const requested = normalizeCurveFitTargets(settings.curveFitTargets).some(value => close(value, target));
  const smooth = requested ? smoothCurveModel(readings) : null;
  return {
    kind: smooth?.kind || 'linear', requested,
    predict: flow => smooth && smooth.kind !== 'linear' ? smooth.predict(flow) : piecewiseRate(readings, flow),
  };
}

function validateCalibrationLibrary(settings) {
  const readings = calibrationLibrary(settings);
  if (!readings || readings.some(reading => !validFlowReading(reading))) return [{ field: 'flowReadings', message: 'Every saved calibration needs a flow, milk target, milk weight and steaming time.' }];
  const keys = readings.map(calibrationKey);
  if (new Set(keys).size !== keys.length) return [{ field: 'flowReadings', message: 'Only one saved calibration may use the same flow and milk target.' }];
  return [];
}

function validateFlowCalibration(settings) {
  const libraryErrors = validateCalibrationLibrary(settings);
  if (libraryErrors.length) return libraryErrors;
  const target = selectedTarget(settings);
  if (settings.interpolate !== true) {
    return partitionFlowReadings(settings).active.length
      ? []
      : [{ field: 'flowReadings', message: 'Create at least one calibration for the selected milk target, or choose All targets.' }];
  }
  if (!Number.isFinite(target) || target <= 0 || target > 100) return [{ field: 'targetTemperatureC', message: 'Choose a milk target with saved calibration readings before using Interpolate.' }];
  const minimum = Number(settings.minimumFlow ?? FLOW_MINIMUM), maximum = Number(settings.maximumFlow ?? FLOW_MAXIMUM);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < FLOW_MINIMUM || maximum > FLOW_MAXIMUM || maximum - minimum < 0.1) return [{ field: 'minimumFlow', message: 'Choose a flow range of at least 0.1 ml/s between 0.4 and 2.5 ml/s.' }];
  const required = interpolationRequirements(settings);
  if (required.active.length < 3 || !required.hasMinimum || !required.hasMaximum || !required.hasInterior) return [{ field: 'flowReadings', message: 'Interpolate needs at least three calibrations at this milk target: the exact minimum, exact maximum, and one interior flow.' }];
  return [];
}

function flowCalibration(settings) {
  if (validateFlowCalibration(settings).length) return null;
  const readings = partitionFlowReadings(settings).active;
  if (settings.interpolate === true) {
    const minimum = Number(settings.minimumFlow), maximum = Number(settings.maximumFlow);
    return { mode: 'interpolate', adjustable: true, minimum, maximum, step: 0.1, defaultFlow: minimum,
      interpolationMethod: interpolationModel(settings).kind === 'linear' ? 'linear' : 'smooth', readings };
  }
  return {
    mode: 'saved', adjustable: readings.length > 1,
    defaultCalibrationKey: calibrationKey(readings[0]),
    choices: readings.map(reading => ({ key: calibrationKey(reading), flow: reading.flow,
      targetTemperatureC: reading.targetTemperatureC, targetLabel: formatTemperature(reading.targetTemperatureC, settings.temperatureUnit || 'F') })),
    readings,
  };
}

function selectedCalibration(settings, key) {
  const calibration = flowCalibration(settings);
  if (!calibration || calibration.mode !== 'saved') return null;
  return calibration.readings.find(reading => calibrationKey(reading) === key) || null;
}

function secondsPerGram(settings, flow, key) {
  const calibration = flowCalibration(settings);
  if (!calibration) return NaN;
  if (calibration.mode === 'saved') {
    const reading = selectedCalibration(settings, key);
    return reading ? reading.seconds / reading.milkGrams : NaN;
  }
  const readings = calibration.readings;
  if (flow < calibration.minimum || flow > calibration.maximum) return NaN;
  return interpolationModel(settings).predict(flow);
}

const CALIBRATION_STORAGE_KEY = 'calibration-library.v2';

function validCurveFitTargets(value) {
  return Array.isArray(value) && value.length <= 100 && value.every(target =>
    Number.isFinite(target) && target > 0 && target <= 100);
}

function validSerializedLibrary(value) {
  if (typeof value !== 'string' || value.length > 65536) return false;
  try {
    const readings = JSON.parse(value);
    return Array.isArray(readings) && readings.length <= 100;
  } catch {
    return false;
  }
}

function calibrationStorageRecord(flowReadings, curveFitTargets = []) {
  if (!validSerializedLibrary(flowReadings)) return null;
  if (!validCurveFitTargets(curveFitTargets)) return null;
  return { schemaVersion: 2, flowReadings, curveFitTargets: [...new Set(curveFitTargets)].sort((a, b) => a - b) };
}

function reconcileCalibrationStorage({ legacyPresent, legacyValue, storedValue }) {
  const storedValid = storedValue && storedValue.schemaVersion === 2 &&
    validSerializedLibrary(storedValue.flowReadings) &&
    (storedValue.curveFitTargets === undefined || validCurveFitTargets(storedValue.curveFitTargets));

  if (!storedValid) {
    const flowReadings = '[]';
    return {
      flowReadings,
      curveFitTargets: [],
      source: 'reset',
      write: calibrationStorageRecord(flowReadings),
      warning: storedValue == null ? null : 'invalid_storage',
    };
  }

  return {
    flowReadings: storedValue.flowReadings,
    curveFitTargets: storedValue.curveFitTargets || [],
    source: 'storage',
    write: null,
    warning: null,
  };
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
  errors.push(...validateFlowCalibration(settings));
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
  let flow, calibrationKey = null, targetTemperatureC;
  if (calibration.mode === 'saved') {
    if (typeof input.calibrationKey !== 'string') fail('calibration_required', 'Choose a saved calibration before calculating.');
    const reading = selectedCalibration(settings, input.calibrationKey);
    if (!reading) fail('calibration_required', 'The selected calibration is no longer available.');
    calibrationKey = input.calibrationKey;
    flow = reading.flow;
    targetTemperatureC = reading.targetTemperatureC;
  } else {
    flow = input.flow === undefined ? calibration.defaultFlow : input.flow;
    if (!Number.isFinite(flow) || flow < calibration.minimum || flow > calibration.maximum) fail('flow_out_of_range', 'Choose a flow within the calibrated range.');
    targetTemperatureC = Number(settings.targetTemperatureC);
  }
  const durationSeconds = Math.round(secondsPerGram(settings, flow, calibrationKey) * milkGrams);
  if (durationSeconds < 1 || durationSeconds > 255) fail('duration_out_of_range', `Calculated time ${durationSeconds}s is outside the supported timer range of 1–255 seconds. Check the calibration and milk amount.`);
  return {
    apiVersion: 5, pitcher, pitcherSource: tared ? 'tared' : (choice === 'auto' ? 'heuristic' : 'manual'),
    scaleGrams, pitcherGrams, milkGrams, durationSeconds, calibrationKey, targetTemperatureC,
    targetLabel: formatTemperature(targetTemperatureC, settings.temperatureUnit || 'F'),
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
          else if (seconds > 0 && frame.state.substate === 'puffing') phase = 'puffing';
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

function mountFlowCalibrationPage({ form, labels, field, updateChoices, syncFlow, persistLibrary }, model) {
  const { calibrationLibrary, partitionFlowReadings, interpolationRequirements, availableTargets, calibrationKey, validFlowReading,
    temperatureToC, temperatureFromC, formatTemperature, interpolationModel, normalizeCurveFitTargets, initialCurveFitTargets } = model;
  const make = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const panel = labels.referenceMilkGrams.closest('fieldset').parentElement;
  const manual = labels.referenceMilkGrams.closest('fieldset');
  const config = make('fieldset'); config.className = 'flow-setup settings-section';
  const configGrid = make('div'); configGrid.className = 'calibration-config-grid full-width'; config.append(configGrid);
  labels.interpolate.className = 'interpolate-switch';
  const interpolateControl = make('div'); interpolateControl.className = 'interpolate-control';
  const preview = make('button', 'Preview'); preview.type = 'button'; preview.className = 'preview-interpolation'; preview.hidden = true;
  interpolateControl.append(labels.interpolate, preview);
  configGrid.append(interpolateControl, labels.weightMode, labels.temperatureUnit, labels.targetTemperatureC);
  const range = make('div'); range.className = 'field-grid full-width'; range.append(labels.minimumFlow, labels.maximumFlow); config.append(range);
  const note = make('p'); note.className = 'local-status full-width'; note.setAttribute('role', 'status'); config.append(note);
  panel.insertBefore(config, manual);

  const previewDialog = make('div'); previewDialog.id = 'interpolation-preview-dialog'; previewDialog.className = 'interpolation-dialog'; previewDialog.hidden = true;
  const previewCard = make('section'); previewCard.className = 'interpolation-dialog-card'; previewCard.setAttribute('role', 'dialog'); previewCard.setAttribute('aria-modal', 'true');
  const previewHeader = make('div'); previewHeader.className = 'interpolation-dialog-header';
  const previewTitle = make('h2', 'Preview'); previewTitle.id = 'interpolation-preview-title';
  const previewNavigation = make('div'); previewNavigation.className = 'interpolation-preview-navigation';
  const previousTarget = make('button', '‹'); previousTarget.type = 'button'; previousTarget.setAttribute('aria-label', 'Previous milk target');
  const previewPosition = make('span');
  const nextTarget = make('button', '›'); nextTarget.type = 'button'; nextTarget.setAttribute('aria-label', 'Next milk target');
  previewNavigation.append(previousTarget, previewPosition, nextTarget);
  const previewClose = make('button', 'Close'); previewClose.type = 'button';
  previewHeader.append(previewTitle, previewNavigation, previewClose);
  const graph = make('div'); graph.id = 'interpolation-preview-graph'; graph.className = 'interpolation-preview-graph';
  const previewOptions = make('div'); previewOptions.className = 'interpolation-preview-options';
  const smoothLabel = make('label'); smoothLabel.className = 'smooth-curve-option';
  const smoothCurve = make('input'); smoothCurve.type = 'checkbox'; smoothLabel.append(smoothCurve, make('span', 'Smooth curve fit'));
  const useTarget = make('button', 'Use this milk target'); useTarget.type = 'button'; useTarget.className = 'primary-action';
  previewOptions.append(smoothLabel, useTarget);
  const previewMethod = make('span'); previewMethod.className = 'interpolation-preview-method';
  previewOptions.insertBefore(previewMethod, smoothLabel);
  previewCard.append(previewHeader, graph, previewOptions); previewDialog.append(previewCard); panel.append(previewDialog);

  const main = make('section'); main.id = 'active-calibrations'; main.className = 'calibration-library settings-section'; panel.insertBefore(main, manual);
  const others = make('details'); others.id = 'other-calibrations';
  const otherSummary = make('summary', 'Other saved calibrations'); others.append(otherSummary);
  const otherHelp = make('p', 'Readings outside the selected milk target or interpolation range. They remain saved until deleted.');
  otherHelp.className = 'other-calibrations-help';
  const otherRows = make('div'); others.append(otherHelp, otherRows); panel.insertBefore(others, manual);
  const editor = make('section'); editor.id = 'calibration-editor'; editor.className = 'calibration-editor'; editor.hidden = true;
  const editorHome = make('div'); editorHome.hidden = true; panel.insertBefore(editorHome, manual); editorHome.append(editor);
  const editorHeader = make('div'); editorHeader.className = 'editor-header';
  const editorHeading = make('div'); editorHeading.className = 'editor-heading';
  const editorTitleRow = make('div'); editorTitleRow.className = 'editor-title-row';
  const editorTitle = make('h3');
  const editorNavigation = make('div'); editorNavigation.className = 'reading-navigation';
  const previousReading = make('button', '↑'), nextReading = make('button', '↓');
  previousReading.type = nextReading.type = 'button';
  previousReading.setAttribute('aria-label', 'Previous reading above'); nextReading.setAttribute('aria-label', 'Next reading below');
  editorNavigation.append(previousReading, nextReading); editorTitleRow.append(editorTitle, editorNavigation);
  const editorIdentityHelp = make('span'); editorIdentityHelp.className = 'editor-identity-help';
  editorHeading.append(editorTitleRow, editorIdentityHelp);
  const methods = make('div'); methods.className = 'calibration-actions entry-methods';
  const manualButton = make('button', 'Enter measured time'), guidedButton = make('button', 'Guided calibration');
  guidedButton.type = manualButton.type = 'button'; methods.append(manualButton, guidedButton);
  editorHeader.append(editorHeading, methods); editor.append(editorHeader);
  const identityFields = make('div'); identityFields.className = 'editor-identity-fields';
  const editorFlowLabel = make('label', 'Flow (ml/s)'); editorFlowLabel.className = 'field editor-flow';
  const editorFlow = make('input'); editorFlow.type = 'number'; editorFlow.min = '0.4'; editorFlow.max = '2.5'; editorFlow.step = '0.1';
  const editorFlowHelp = make('small', 'ml/s · required'); editorFlowLabel.append(editorFlow, editorFlowHelp);
  const editorTargetLabel = make('label', 'Milk target'); editorTargetLabel.className = 'field editor-target';
  const editorTarget = make('input'); editorTarget.type = 'number'; editorTarget.step = '0.1';
  const editorTargetHelp = make('small'); editorTargetLabel.append(editorTarget, editorTargetHelp);
  identityFields.append(editorFlowLabel, editorTargetLabel); editor.append(identityFields);
  const methodHost = make('div'); editor.append(methodHost);
  const editorActions = make('div'); editorActions.className = 'calibration-actions editor-save-row';
  const update = make('button', 'Update saved calibration'), close = make('button', 'Close without update');
  update.type = close.type = 'button'; update.className = 'primary-action'; editorActions.append(close, update); editor.append(editorActions);
  const newCalibration = make('button', '+ New calibration'); newCalibration.type = 'button'; newCalibration.className = 'new-calibration';

  let displayedUnit = field('temperatureUnit').value || 'F';
  let curveFitTargets = normalizeCurveFitTargets(initialCurveFitTargets);
  let curveFitDirty = false, previewTarget = 0, previewBodyOverflow = null;
  let readings = calibrationLibrary(settings()) || [];
  let openKey = null, draftFlow = NaN, draftTarget = NaN, guidedMode = false, locked = false;
  let guide = null, review = null, clearGuided = () => {}, measurementReady = false;

  function settings() {
    return {
      flowReadings: field('flowReadings').value,
      interpolate: field('interpolate').checked,
      targetTemperatureC: Number(field('targetTemperatureC').value || 0),
      minimumFlow: Number(field('minimumFlow').value), maximumFlow: Number(field('maximumFlow').value),
      referenceFlow: Number(field('referenceFlow').value), referenceMilkGrams: Number(field('referenceMilkGrams').value),
      referenceSeconds: Number(field('referenceSeconds').value),
      curveFitTargets,
    };
  }
  const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
  function activeAndOther() {
    return partitionFlowReadings({ ...settings(), flowReadings: JSON.stringify(readings) });
  }
  function targetList() {
    return availableTargets({ flowReadings: JSON.stringify(readings) });
  }
  function targetComplete(target) {
    const required = interpolationRequirements({ ...settings(), interpolate: true, targetTemperatureC: target, flowReadings: JSON.stringify(readings) });
    return required.active.length >= 3 && required.hasMinimum && required.hasMaximum && required.hasInterior;
  }
  function completeTargets() { return targetList().filter(targetComplete); }
  function graphMarkup(target) {
    const previewSettings = { ...settings(), targetTemperatureC: target, interpolate: true, flowReadings: JSON.stringify(readings), curveFitTargets };
    const active = partitionFlowReadings(previewSettings).active;
    const model = interpolationModel(previewSettings, target);
    const smoothProbe = interpolationModel({ ...previewSettings, curveFitTargets: [target] }, target);
    const smoothAvailable = smoothProbe.kind !== 'linear';
    const minimum = Number(field('minimumFlow').value), maximum = Number(field('maximumFlow').value);
    const weights = [100, 150, 200, 250], width = 760, height = 390, left = 58, top = 20, plotWidth = 560, plotHeight = 300;
    const samples = Array.from({ length: 61 }, (_, index) => minimum + (maximum - minimum) * index / 60);
    const values = weights.flatMap(weight => samples.map(flow => model.predict(flow) * weight)).concat(active.map(reading => reading.seconds));
    const yMaximum = Math.max(10, Math.ceil(Math.max(...values) / 10) * 10);
    const x = flow => left + (flow - minimum) / (maximum - minimum) * plotWidth;
    const y = seconds => top + plotHeight - seconds / yMaximum * plotHeight;
    const colors = ['#326eb9', '#1c7a45', '#c56c1b', '#9a4ab0'];
    const parts = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Calculated steam time by flow for ${formatTemperature(target, displayedUnit)} milk target">`];
    for (let index = 0; index <= 5; index += 1) {
      const seconds = yMaximum * index / 5, py = y(seconds);
      parts.push(`<line x1="${left}" y1="${py}" x2="${left + plotWidth}" y2="${py}" class="graph-grid"/><text x="${left - 9}" y="${py + 4}" text-anchor="end">${Math.round(seconds)}s</text>`);
    }
    for (let index = 0; index <= 4; index += 1) {
      const flow = minimum + (maximum - minimum) * index / 4, px = x(flow);
      parts.push(`<line x1="${px}" y1="${top}" x2="${px}" y2="${top + plotHeight}" class="graph-grid"/><text x="${px}" y="${top + plotHeight + 22}" text-anchor="middle">${flow.toFixed(1)}</text>`);
    }
    parts.push(`<line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" class="graph-axis"/><line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}" class="graph-axis"/>`);
    weights.forEach((weight, index) => {
      const path = samples.map((flow, point) => `${point ? 'L' : 'M'}${x(flow).toFixed(1)},${y(model.predict(flow) * weight).toFixed(1)}`).join(' ');
      parts.push(`<path d="${path}" fill="none" stroke="${colors[index]}" stroke-width="3"/><line x1="640" y1="${47 + index * 28}" x2="666" y2="${47 + index * 28}" stroke="${colors[index]}" stroke-width="3"/><text x="675" y="${51 + index * 28}">${weight} g milk</text>`);
    });
    active.forEach(reading => parts.push(`<circle cx="${x(reading.flow).toFixed(1)}" cy="${y(reading.seconds).toFixed(1)}" r="4" class="graph-reading"><title>${reading.flow.toFixed(1)} ml/s · ${reading.milkGrams} g · ${reading.seconds} s</title></circle>`));
    parts.push(`<circle cx="648" cy="177" r="4" class="graph-reading"/><text x="675" y="174"><tspan x="675" dy="0">Measured</tspan><tspan x="675" dy="14">reading</tspan></text><text x="${left + plotWidth / 2}" y="${height - 12}" text-anchor="middle" class="graph-label">Steam flow (ml/s)</text><text x="16" y="${top + plotHeight / 2}" text-anchor="middle" class="graph-label" transform="rotate(-90 16 ${top + plotHeight / 2})">Calculated time</text></svg>`);
    return { markup: parts.join(''), model, smoothAvailable, active, minimum, maximum };
  }
  function renderPreview() {
    const targets = completeTargets();
    if (!targets.length) { closePreview(); return; }
    if (!targets.some(target => same(target, previewTarget))) previewTarget = targets[0];
    const index = targets.findIndex(target => same(target, previewTarget));
    const result = graphMarkup(previewTarget);
    previewTitle.textContent = 'Preview';
    previewPosition.textContent = 'Milk target ' + formatTemperature(previewTarget, displayedUnit) + (targets.length > 1 ? ' · ' + (index + 1) + ' of ' + targets.length : '');
    previousTarget.disabled = index <= 0; nextTarget.disabled = index >= targets.length - 1;
    smoothLabel.hidden = !result.smoothAvailable;
    smoothCurve.checked = result.smoothAvailable && curveFitTargets.some(target => same(target, previewTarget));
    useTarget.disabled = false; useTarget.textContent = 'Use this milk target';
    graph.innerHTML = result.markup;
    previewMethod.textContent = result.model.kind === 'linear' ? 'Straight-line interpolation' : 'Smooth curve interpolation';
  }
  function openPreview() {
    previewTarget = Number(field('targetTemperatureC').value || 0);
    if (!targetComplete(previewTarget)) return;
    renderPreview(); previewDialog.hidden = false;
    if (document.body) {
      previewBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    previewClose.focus();
  }
  function closePreview() {
    previewDialog.hidden = true;
    if (document.body && previewBodyOverflow !== null) {
      document.body.style.overflow = previewBodyOverflow;
      previewBodyOverflow = null;
    }
  }
  function refreshTargetChoices() {
    const select = field('targetTemperatureC');
    const targets = targetList();
    const current = Number(select.value || 0);
    let chosen;
    if (field('interpolate').checked) {
      chosen = targets.some(target => same(target, current)) ? current : (targets[0] ?? 0);
      const options = targets.map(target => {
        const option = make('option', formatTemperature(target, displayedUnit) + (targetComplete(target) ? '' : ' · incomplete'));
        option.value = target; return option;
      });
      if (!options.length) { const option = make('option', 'No saved targets'); option.value = ''; options.push(option); }
      select.replaceChildren(...options);
    } else {
      chosen = current === 0 || targets.some(target => same(target, current)) ? current : 0;
      const all = make('option', 'All targets'); all.value = 0;
      const options = targets.map(target => { const option = make('option', formatTemperature(target, displayedUnit)); option.value = target; return option; });
      select.replaceChildren(all, ...options);
    }
    select.value = field('interpolate').checked && chosen === 0 ? '' : String(chosen);
  }
  function navigationTargets() {
    if (!field('interpolate').checked) return [];
    const { active } = activeAndOther();
    const required = interpolationRequirements({ ...settings(), flowReadings: JSON.stringify(readings) });
    const targets = active.map(reading => ({ key: calibrationKey(reading), flow: reading.flow, reading }));
    const min = Number(field('minimumFlow').value), max = Number(field('maximumFlow').value);
    if (!required.hasMinimum) targets.push({ key: 'new:Minimum', flow: min });
    if (!required.hasInterior) targets.push({ key: 'new:Interior', flow: Math.round(((min + max) / 2) * 10) / 10 });
    if (!required.hasMaximum) targets.push({ key: 'new:Maximum', flow: max });
    return targets.sort((a, b) => a.flow - b.flow);
  }
  function syncStored() {
    readings.sort((a, b) => a.targetTemperatureC - b.targetTemperatureC || a.flow - b.flow);
    field('flowReadings').value = JSON.stringify(readings);
    updateChoices();
  }
  async function persistStored(successMessage) {
    try {
      await persistLibrary(field('flowReadings').value, curveFitTargets);
      curveFitDirty = false;
      note.textContent = successMessage;
    } catch (error) {
      note.textContent = error.message;
      throw error;
    }
  }
  function readingDetails(reading) {
    const details = make('div'); details.className = 'saved-calibration-details';
    const flow = make('span', reading.flow.toFixed(1) + ' ml/s'); flow.className = 'saved-calibration-flow';
    const meta = make('span', formatTemperature(reading.targetTemperatureC, displayedUnit) + ' · ' + reading.milkGrams + ' g milk · ' + reading.seconds + ' s'); meta.className = 'saved-calibration-meta';
    details.append(flow, meta); return details;
  }
  function rowFor(reading) {
    const wrapper = make('div'); wrapper.className = 'saved-calibration';
    const row = make('div'); row.className = 'saved-calibration-row'; row.append(readingDetails(reading));
    const edit = make('button', openKey === calibrationKey(reading) ? 'Cancel' : 'Edit'); edit.type = 'button';
    edit.addEventListener('click', () => openKey === calibrationKey(reading) ? cancelEditor() : openEditor(reading)); row.append(edit);
    const remove = make('button', 'Delete'); remove.type = 'button'; remove.addEventListener('click', async () => {
      if (locked) return;
      const before = readings;
      readings = readings.filter(item => calibrationKey(item) !== calibrationKey(reading));
      if (openKey === calibrationKey(reading)) cancelEditor();
      refreshTargetChoices(); syncStored(); render();
      try { await persistStored('Calibration deleted.'); } catch { readings = before; refreshTargetChoices(); syncStored(); render(); }
    }); row.append(remove);
    wrapper.append(row);
    if (openKey === calibrationKey(reading)) wrapper.append(editor);
    return wrapper;
  }
  function missingRow(kind, flow) {
    const wrapper = make('div'); wrapper.className = 'saved-calibration missing-calibration';
    const row = make('div'); row.className = 'saved-calibration-row';
    const details = make('div'); details.className = 'saved-calibration-details';
    const title = make('span', kind + ' reading · ' + flow.toFixed(1) + ' ml/s'); title.className = 'saved-calibration-flow';
    const meta = make('span', formatTemperature(settings().targetTemperatureC, displayedUnit) + ' · required'); meta.className = 'saved-calibration-meta';
    details.append(title, meta); row.append(details);
    const key = 'new:' + kind;
    const button = make('button', openKey === key ? 'Cancel' : 'Create reading'); button.type = 'button';
    button.addEventListener('click', () => openKey === key ? cancelEditor() : openEditor(null, flow, key)); row.append(button);
    wrapper.append(row); if (openKey === key) wrapper.append(editor); return wrapper;
  }
  function openEditor(reading, flow, key) {
    if (locked) return;
    const selectedTarget = Number(field('targetTemperatureC').value || 0);
    openKey = key || calibrationKey(reading); draftFlow = Number(reading?.flow ?? flow ?? field('referenceFlow').value);
    draftTarget = Number(reading?.targetTemperatureC ?? (selectedTarget || targetList()[0] || 60));
    field('referenceFlow').value = draftFlow;
    field('referenceMilkGrams').value = reading?.milkGrams || '';
    field('referenceSeconds').value = reading?.seconds || '';
    editorFlow.value = draftFlow; editorTarget.value = temperatureFromC(draftTarget, displayedUnit);
    measurementReady = false; clearGuided(); editor.hidden = false; render();
  }
  function cancelEditor() { openKey = null; editor.hidden = true; measurementReady = false; clearGuided(); syncStored(); render(); }
  function setMethod(guidedSelected) { guidedMode = guidedSelected; paintEditor(); }
  function navigateEditor(direction) {
    const targets = navigationTargets(), index = targets.findIndex(target => target.key === openKey);
    const target = targets[index + direction]; if (!target) return;
    openEditor(target.reading || null, target.flow, target.key);
  }
  function paintEditor() {
    if (!openKey) return;
    const targets = navigationTargets(), readingIndex = targets.findIndex(target => target.key === openKey);
    const navigable = field('interpolate').checked && readingIndex >= 0;
    const interior = openKey === 'new:Interior';
    if (openKey === 'new:saved') editorTitle.textContent = 'New saved calibration';
    else if (interior) editorTitle.textContent = '';
    else if (navigable) editorTitle.textContent = 'Reading ' + (readingIndex + 1) + ' of ' + targets.length + ' · ' + draftFlow.toFixed(1) + ' ml/s · ' + formatTemperature(draftTarget, displayedUnit);
    else editorTitle.textContent = 'Editing ' + draftFlow.toFixed(1) + ' ml/s · ' + formatTemperature(draftTarget, displayedUnit);
    editorIdentityHelp.textContent = interior
      ? 'Target ' + formatTemperature(draftTarget, displayedUnit) + ' · midpoint suggested; choose any interior flow.'
      : 'Flow and milk target uniquely identify this calibration.';
    editorNavigation.hidden = !navigable;
    previousReading.disabled = locked || readingIndex <= 0; nextReading.disabled = locked || readingIndex < 0 || readingIndex >= targets.length - 1;
    const editableFlow = openKey === 'new:saved' || interior;
    editorTitle.hidden = interior;
    if (interior) editorTitleRow.insertBefore(editorFlowLabel, editorNavigation);
    else identityFields.insertBefore(editorFlowLabel, editorTargetLabel);
    editorFlowLabel.className = interior ? 'field editor-flow inline-editor-flow' : 'field editor-flow';
    editorFlowHelp.textContent = interior ? 'ml/s · ' + field('minimumFlow').value + '–' + field('maximumFlow').value : 'ml/s · required';
    editorFlowLabel.hidden = !editableFlow; editorTargetLabel.hidden = !editableFlow; identityFields.hidden = !editableFlow;
    editorFlow.disabled = locked; editorTarget.disabled = locked;
    editorTarget.min = displayedUnit === 'F' ? '32.2' : '0.1'; editorTarget.max = displayedUnit === 'F' ? '212' : '100';
    editorTargetHelp.textContent = '°' + displayedUnit + ' · required';
    guidedButton.setAttribute('aria-pressed', String(guidedMode)); manualButton.setAttribute('aria-pressed', String(!guidedMode));
    if (guide && review) { guide.hidden = !guidedMode; review.hidden = guidedMode; }
    update.disabled = locked || (guidedMode && !measurementReady && !validFlowReading({ flow: draftFlow, targetTemperatureC: draftTarget, milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) }));
    update.textContent = openKey.startsWith('new:') ? 'Create saved calibration' : 'Update saved calibration';
  }
  async function saveEditor() {
    const reading = { flow: draftFlow, targetTemperatureC: draftTarget, milkGrams: Number(field('referenceMilkGrams').value), seconds: Number(field('referenceSeconds').value) };
    if (!validFlowReading(reading)) { note.textContent = 'Enter a flow, milk target, 10–1500 g of milk and 1–255 seconds.'; return; }
    const oldKey = openKey.startsWith('new:') ? null : openKey;
    const duplicate = readings.find(item => calibrationKey(item) === calibrationKey(reading) && calibrationKey(item) !== oldKey);
    if (duplicate) { note.textContent = 'A calibration at this flow and milk target already exists.'; return; }
    const before = readings;
    readings = readings.filter(item => calibrationKey(item) !== oldKey); readings.push(reading);
    if (field('interpolate').checked) field('targetTemperatureC').value = reading.targetTemperatureC;
    openKey = null; editor.hidden = true; refreshTargetChoices(); syncStored(); render();
    try { await persistStored('Calibration saved.'); }
    catch { readings = before; refreshTargetChoices(); syncStored(); render(); }
  }
  function libraryHeader(title, valid) {
    const header = make('div'); header.className = 'calibration-library-header';
    const heading = make('div'); heading.append(make('h3', title));
    const actions = make('div'); actions.className = 'calibration-library-actions';
    const validation = make('span', valid ? 'Ready to save' : 'More readings needed'); validation.className = 'calibration-validation' + (valid ? '' : ' invalid');
    actions.append(validation, newCalibration); header.append(heading, actions); return header;
  }
  function appendNewCalibrationEditor() {
    if (openKey !== 'new:saved') return;
    const wrapper = make('div'); wrapper.className = 'saved-calibration new-calibration-editor';
    const row = make('div'); row.className = 'saved-calibration-row editing';
    const details = make('div'); details.className = 'saved-calibration-details';
    const title = make('span', 'New calibration'); title.className = 'saved-calibration-flow';
    const meta = make('span', 'Milk target ' + formatTemperature(draftTarget, displayedUnit)); meta.className = 'saved-calibration-meta';
    details.append(title, meta); row.append(details); wrapper.append(row, editor); main.append(wrapper);
  }
  function render() {
    if (!openKey) { editor.hidden = true; editorHome.append(editor); }
    const interpolate = field('interpolate').checked;
    range.hidden = !interpolate; newCalibration.hidden = false;
    newCalibration.textContent = openKey === 'new:saved' ? 'Cancel' : (readings.length ? '+ New calibration' : 'Create first calibration');
    main.replaceChildren(); otherRows.replaceChildren();
    const { active, other } = activeAndOther();
    if (!interpolate) {
      main.append(libraryHeader('Available calibrations (' + active.length + ')', active.length > 0));
      if (!active.length) { const empty = make('p', 'No saved calibrations match this milk target. Create the first calibration or choose All targets.'); empty.className = 'empty-calibrations'; main.append(empty); }
      active.forEach(reading => main.append(rowFor(reading)));
      appendNewCalibrationEditor();
      note.textContent = active.length > 1
        ? 'The shot page will cycle through these saved calibrations.'
        : 'Create one calibration to get started.';
    } else {
      const required = interpolationRequirements({ ...settings(), flowReadings: JSON.stringify(readings) });
      const complete = required.active.length >= 3 && required.hasMinimum && required.hasMaximum && required.hasInterior;
      main.append(libraryHeader('Interpolation readings (' + active.length + ')', complete));
      for (const target of navigationTargets()) {
        if (target.reading) main.append(rowFor(target.reading));
        else main.append(missingRow(target.key.slice(4), target.flow));
      }
      appendNewCalibrationEditor();
      note.textContent = complete
        ? 'All ' + required.active.length + ' matching calibrations will be used for interpolation.'
        : 'Add the exact minimum, exact maximum, and at least one interior reading.';
    }
    other.forEach(reading => otherRows.append(rowFor(reading)));
    otherSummary.textContent = 'Other saved calibrations (' + other.length + ')';
    others.hidden = !other.length;
    preview.hidden = !interpolate || !targetComplete(Number(field('targetTemperatureC').value || 0));
    paintEditor(); updateChoices();
  }
  function interpolationChanged() {
    if (locked) return;
    closePreview();
    field('targetTemperatureC').value = field('interpolate').checked ? '' : '0';
    refreshTargetChoices();
    cancelEditor();
  }
  field('interpolate').addEventListener('change', interpolationChanged);
  preview.addEventListener('click', openPreview); previewClose.addEventListener('click', closePreview);
  previousTarget.addEventListener('click', () => { const targets = completeTargets(), index = targets.findIndex(target => same(target, previewTarget)); if (index > 0) { previewTarget = targets[index - 1]; renderPreview(); } });
  nextTarget.addEventListener('click', () => { const targets = completeTargets(), index = targets.findIndex(target => same(target, previewTarget)); if (index >= 0 && index < targets.length - 1) { previewTarget = targets[index + 1]; renderPreview(); } });
  smoothCurve.addEventListener('change', () => {
    curveFitTargets = smoothCurve.checked
      ? normalizeCurveFitTargets([...curveFitTargets, previewTarget])
      : curveFitTargets.filter(target => !same(target, previewTarget));
    curveFitDirty = true; renderPreview();
  });
  useTarget.addEventListener('click', () => {
    field('targetTemperatureC').value = String(previewTarget); cancelEditor(); closePreview(); render();
  });
  newCalibration.addEventListener('click', () => openKey === 'new:saved' ? cancelEditor() : openEditor(null, Number(field('referenceFlow').value), 'new:saved'));
  close.addEventListener('click', cancelEditor); previousReading.addEventListener('click', () => navigateEditor(-1)); nextReading.addEventListener('click', () => navigateEditor(1));
  guidedButton.addEventListener('click', () => setMethod(true)); manualButton.addEventListener('click', () => setMethod(false)); update.addEventListener('click', saveEditor);
  editorFlow.addEventListener('input', () => { draftFlow = Number(editorFlow.value); field('referenceFlow').value = draftFlow; measurementReady = false; clearGuided(); paintEditor(); });
  editorTarget.addEventListener('input', () => { draftTarget = temperatureToC(editorTarget.value, displayedUnit); measurementReady = false; clearGuided(); paintEditor(); });
  function applyTemperaturePresentation() {
    labels.targetTemperatureC.children[0].textContent = 'Milk target';
    refreshTargetChoices();
    if (openKey) editorTarget.value = temperatureFromC(draftTarget, displayedUnit);
  }
  field('temperatureUnit').addEventListener('change', () => {
    displayedUnit = field('temperatureUnit').value || 'F';
    applyTemperaturePresentation(); render(); if (!previewDialog.hidden) renderPreview();
  });
  for (const input of [field('targetTemperatureC'), field('minimumFlow'), field('maximumFlow')]) input.addEventListener('change', () => { closePreview(); cancelEditor(); render(); });
  form.addEventListener('input', event => { if (event.target === field('referenceMilkGrams') || event.target === field('referenceSeconds')) { measurementReady = false; paintEditor(); } });
  applyTemperaturePresentation(); syncStored(); render();
  return {
    currentFlow: () => draftFlow,
    currentTargetLabel: () => formatTemperature(draftTarget, displayedUnit),
    attach(guided, measured, flowLabel, clear) {
      guide = guided; review = measured; clearGuided = clear;
      flowLabel.hidden = true; methodHost.append(guided, measured); paintEditor();
    },
    lock(value) { locked = value; for (const button of [newCalibration, close, update, guidedButton, manualButton, previousReading, nextReading, preview, previewClose, previousTarget, nextTarget, useTarget]) button.disabled = value; smoothCurve.disabled = value; field('interpolate').disabled = value; paintEditor(); },
    acceptMeasurement(result) {
      if (!same(result.flow, draftFlow)) throw new Error('The measurement flow changed. Repeat this reading.');
      field('referenceMilkGrams').value = result.milkGrams; field('referenceSeconds').value = result.seconds;
      measurementReady = true; paintEditor();
    },
    flowChanged() { render(); },
    reveal() { render(); },
    isEditing: () => Boolean(openKey),
    async assertCanSave() {
      if (openKey) throw Object.assign(new Error('Update or close the open calibration before saving.'), { field: 'flowReadings' });
      syncStored();
      if (curveFitDirty) await persistStored('Interpolation preference saved.');
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
  const scaleBox = make('div'); scaleBox.className = 'pitcher-section-header full-width';
  const scaleHeading = make('div');
  const scaleTitle = make('h3', 'Empty pitcher weights');
  const scaleValue = make('span', 'Scale disconnected. Manual entry is available.'); scaleValue.className = 'scale-reading';
  scaleHeading.append(scaleTitle, scaleValue);
  const scaleTools = make('div'); scaleTools.className = 'scale-tools';
  const scaleHelp = make('p', 'Tare with nothing on the scale. Wait for zero, then place an empty pitcher.');
  scaleHelp.className = 'visually-hidden'; scaleHelp.setAttribute('role', 'status');
  scaleBox.append(scaleHeading, scaleTools, scaleHelp);
  weights.insertBefore(scaleBox, labels.smallPitcherGrams);
  const guided = make('div'); guided.className = 'guided-calibration guided-workspace';
  const flowLabel = make('label', 'Calibration flow (ml/s)'); flowLabel.className = 'field calibration-flow';
  const flow = make('input'); flow.id = 'calibration-flow'; flow.type = 'number'; flow.min = '0.4'; flow.max = '2.5'; flow.step = '0.1'; flow.value = field('referenceFlow').value;
  flow.addEventListener('input', () => syncFlow(flow.value)); flowLabel.append(flow); guided.append(flowLabel);
  const guidedBlock = make('div'); guidedBlock.className = 'calibration-workspace-block'; guided.append(guidedBlock);
  const weighStep = make('div'); weighStep.className = 'guided-overview';
  const pitcherLabel = make('label', 'Calibration pitcher'); pitcherLabel.className = 'field';
  const pitcher = make('select'); pitcher.setAttribute('aria-label', 'Calibration pitcher'); pitcherLabel.append(pitcher); weighStep.append(pitcherLabel);
  const readings = make('div'); readings.className = 'guided-readouts';
  const scaleMetric = make('div'); scaleMetric.className = 'guided-metric'; scaleMetric.append(make('b', 'Scale reading:'));
  const calibrationScaleValue = make('span', 'disconnected'); scaleMetric.append(calibrationScaleValue);
  const milkMetric = make('div'); milkMetric.className = 'guided-metric'; milkMetric.append(make('b', 'Derived milk weight (g):'));
  const derivedMilk = make('span', '—'); milkMetric.append(derivedMilk); readings.append(scaleMetric, milkMetric); weighStep.append(readings);
  const milkActions = make('div'); milkActions.className = 'calibration-actions guided-actions'; weighStep.append(milkActions);
  const milk = make('p', 'Tare, then capture a fresh stable milk weight.'); milk.className = 'local-status'; milk.setAttribute('role', 'status'); milk.setAttribute('aria-live', 'polite');
  guidedBlock.append(weighStep, milk);
  const steamStep = make('div'); steamStep.className = 'guided-steam-controls';
  const elapsedLabel = make('span', 'Time elapsed: '); elapsedLabel.className = 'timer-readout';
  const elapsed = make('span', '0.0 s'); elapsed.className = 'calibration-timer'; elapsedLabel.append(elapsed); steamStep.append(elapsedLabel);
  const runStatus = make('span', 'Waiting for milk capture'); runStatus.className = 'machine-state';
  runStatus.setAttribute('role', 'status'); runStatus.setAttribute('aria-live', 'polite'); steamStep.append(runStatus);
  const actions = make('div'); actions.className = 'calibration-actions'; steamStep.append(actions);
  guidedBlock.append(steamStep);
  const manual = labels.referenceMilkGrams.closest('fieldset');
  manual.className += ' manual-fields';
  const calibrationPanel = manual.parentElement;
  calibrationPanel.insertBefore(guided, manual);
  const review = make('div'); review.className = 'manual-workspace';
  calibrationPanel.insertBefore(review, manual); review.append(manual);
  function setScaleMessage(text) {
    scaleValue.textContent = text;
    calibrationScaleValue.textContent = text.replace(/^Scale(?: reading)?:\s*/i, '');
  }
  const captureButtons = [];
  function weight() {
    if (!zeroConfirmed || tarePending || awaitingZero) throw new Error('Tare the empty scale and wait for a stable zero first.');
    return captureWeight(samples, Date.now());
  }
  function clearCapture() {
    captured = null;
    milk.textContent = 'Tare, then capture a fresh stable milk weight.';
    derivedMilk.textContent = '—';
    elapsed.textContent = '0.0 s';
    if (!active && !pending) runStatus.textContent = 'Waiting for milk capture';
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
  const pitcherGrid = make('div'); pitcherGrid.className = 'pitcher-grid full-width';
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
  pitcherGrid.append(...sizes.map(size => labels[size + 'PitcherGrams'])); weights.append(pitcherGrid);
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
    derivedMilk.textContent = String(milkGrams);
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
    runStatus.textContent = value.message || ({ armed: 'Waiting for machine steam', starting: 'Waiting for machine steam', heating: 'Heating · Timer waiting', steaming: 'Machine steam detected · Timing', puffing: 'Steam stopped · finishing purge…', restoring: 'Restoring previous steam settings…' }[value.phase] ?? value.phase);
    elapsed.textContent = Number(value.seconds || 0).toFixed(1) + ' s';
    if (value.result && !appliedResult) {
      appliedResult = true; captured = null;
      flowPlan.acceptMeasurement(value.result);
      review.open = true;
      runStatus.textContent = 'Machine steam stopped';
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
    cancel.hidden = !active;
    save.disabled = locked;
    const tared = field('weightMode').value === 'tared';
    pitcherLabel.hidden = tared;
    weighStep.className = 'guided-overview' + (tared ? ' is-tared' : '');
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
  flowPlan.attach(guided, review, flowLabel, () => { clearCapture(); zeroConfirmed = false; samples = []; appliedResult = false; elapsed.textContent = '0.0 s'; paint(); });
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
    settings.curveFitTargets = [];
    storageState = { state: 'loading', source: 'legacy', warning: null };
    try { host.storage({ type: 'read', key: CALIBRATION_STORAGE_KEY }); }
    catch {
      storageState = { state: 'legacy-only', source: 'legacy', warning: 'plugin_storage_unavailable' };
    }
  }

  function saveCalibrationLibrary(body) {
    if (!body || typeof body.flowReadings !== 'string') return json(400, { code: 'invalid_request', message: 'Supply a calibration library.' });
    const curveFitTargets = body.curveFitTargets === undefined ? normalizeCurveFitTargets(settings.curveFitTargets) : normalizeCurveFitTargets(body.curveFitTargets);
    if (body.curveFitTargets !== undefined && (!Array.isArray(body.curveFitTargets) || curveFitTargets.length !== body.curveFitTargets.length)) {
      return json(422, { code: 'invalid_curve_fit_targets', message: 'Smooth curve targets must be valid saved milk temperatures.' });
    }
    const candidate = { ...settings, flowReadings: body.flowReadings, curveFitTargets };
    const errors = validateCalibrationLibrary(candidate);
    if (errors.length) return json(422, { code: 'invalid_calibration_library', message: errors[0].message, errors });
    const record = calibrationStorageRecord(body.flowReadings, curveFitTargets);
    if (!record || typeof host.storage !== 'function') return json(503, { code: 'plugin_storage_unavailable', message: 'Decaid plugin storage is unavailable.' });
    settings.flowReadings = body.flowReadings;
    settings.curveFitTargets = curveFitTargets;
    try {
      storageState = { state: 'writing', source: 'library-api', warning: null };
      host.storage({ type: 'write', key: CALIBRATION_STORAGE_KEY, data: record });
      return json(200, { saved: true, flowReadings: settings.flowReadings, curveFitTargets: settings.curveFitTargets });
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
    settings.curveFitTargets = result.curveFitTargets;
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

})();
