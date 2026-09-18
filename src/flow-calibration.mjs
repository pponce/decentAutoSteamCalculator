const FLOW_MINIMUM = 0.4;
const FLOW_MAXIMUM = 2.5;
const MAX_READINGS = 100;

const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
const selectedTarget = settings => Number(settings.targetTemperatureC) > 0 ? Number(settings.targetTemperatureC) : 0;

export function normalizeCurveFitTargets(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(Number).filter(target => Number.isFinite(target) && target > 0 && target <= 100))].sort((a, b) => a - b);
  } catch { return []; }
}

export function temperatureToC(value, unit = 'F') {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  const celsius = unit === 'F' ? (number - 32) * 5 / 9 : number;
  return Math.round(celsius * 10) / 10;
}

export function temperatureFromC(value, unit = 'F') {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  const display = unit === 'F' ? number * 9 / 5 + 32 : number;
  return Math.round(display * 10) / 10;
}

export function formatTemperature(valueC, unit = 'F') {
  const value = temperatureFromC(valueC, unit);
  return Number.isFinite(value) ? value.toFixed(1) + ' °' + unit : '—';
}

export function readFlowReadings(settings) {
  try {
    if (settings.flowReadings === undefined || settings.flowReadings === '') return [];
    if (typeof settings.flowReadings !== 'string' || settings.flowReadings.length > 65536) return null;
    const readings = JSON.parse(settings.flowReadings);
    return Array.isArray(readings) && readings.length <= MAX_READINGS ? readings : null;
  } catch { return null; }
}

export function validFlowReading(reading) {
  return reading && Number.isFinite(reading.flow) && reading.flow >= FLOW_MINIMUM && reading.flow <= FLOW_MAXIMUM &&
    Number.isFinite(reading.targetTemperatureC) && reading.targetTemperatureC > 0 && reading.targetTemperatureC <= 100 &&
    Number.isFinite(reading.milkGrams) && reading.milkGrams >= 10 && reading.milkGrams <= 1500 &&
    Number.isFinite(reading.seconds) && reading.seconds >= 1 && reading.seconds <= 255;
}

export function calibrationKey(reading) {
  return Number(reading.flow).toFixed(3) + '@' + Number(reading.targetTemperatureC).toFixed(3);
}

export function calibrationLibrary(settings) {
  const parsed = readFlowReadings(settings);
  if (!parsed) return null;
  return parsed.map(reading => ({ ...reading })).sort((a, b) => a.targetTemperatureC - b.targetTemperatureC || a.flow - b.flow);
}

export function availableTargets(settings) {
  const readings = calibrationLibrary(settings);
  if (!readings) return [];
  return [...new Set(readings.filter(validFlowReading).map(reading => Number(reading.targetTemperatureC)))].sort((a, b) => a - b);
}

export function partitionFlowReadings(settings) {
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

export function interpolationRequirements(settings) {
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

export function smoothCurveModel(readings) {
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

export function interpolationModel(settings, target = selectedTarget(settings)) {
  const interpolationSettings = { ...settings, interpolate: true, targetTemperatureC: target };
  const readings = partitionFlowReadings(interpolationSettings).active;
  const requested = normalizeCurveFitTargets(settings.curveFitTargets).some(value => close(value, target));
  const smooth = requested ? smoothCurveModel(readings) : null;
  return {
    kind: smooth?.kind || 'linear', requested,
    predict: flow => smooth && smooth.kind !== 'linear' ? smooth.predict(flow) : piecewiseRate(readings, flow),
  };
}

export function validateCalibrationLibrary(settings) {
  const readings = calibrationLibrary(settings);
  if (!readings || readings.some(reading => !validFlowReading(reading))) return [{ field: 'flowReadings', message: 'Every saved calibration needs a flow, milk target, milk weight and steaming time.' }];
  const keys = readings.map(calibrationKey);
  if (new Set(keys).size !== keys.length) return [{ field: 'flowReadings', message: 'Only one saved calibration may use the same flow and milk target.' }];
  return [];
}

export function validateFlowCalibration(settings) {
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

export function flowCalibration(settings) {
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

export function selectedCalibration(settings, key) {
  const calibration = flowCalibration(settings);
  if (!calibration || calibration.mode !== 'saved') return null;
  return calibration.readings.find(reading => calibrationKey(reading) === key) || null;
}

export function secondsPerGram(settings, flow, key) {
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
