const FLOW_MINIMUM = 0.4;
const FLOW_MAXIMUM = 2.5;
const MAX_READINGS = 100;

const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
const selectedTarget = settings => Number(settings.targetTemperatureC) > 0 ? Number(settings.targetTemperatureC) : 0;

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
    return { mode: 'interpolate', adjustable: true, minimum, maximum, step: 0.1, defaultFlow: minimum, readings };
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
