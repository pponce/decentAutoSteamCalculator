const FLOW_MINIMUM = 0.4;
const FLOW_MAXIMUM = 2.5;
const MAX_READINGS = 100;

const close = (a, b) => Math.abs(Number(a) - Number(b)) < 0.000001;
const targetFor = settings => Number(settings.targetTemperatureC) > 0 ? Number(settings.targetTemperatureC) : 60;

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

export function partitionFlowReadings(settings) {
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

export function multipleCalibrationRequirements(settings) {
  const minimum = Number(settings.minimumFlow ?? 0.4), maximum = Number(settings.maximumFlow ?? 2.5);
  const { active } = partitionFlowReadings(settings);
  return { active,
    hasMinimum: active.some(reading => close(reading.flow, minimum)),
    hasMaximum: active.some(reading => close(reading.flow, maximum)),
    hasInterior: active.some(reading => reading.flow > minimum && reading.flow < maximum) };
}

export function validateFlowCalibration(settings) {
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

export function flowCalibration(settings) {
  if (validateFlowCalibration(settings).length) return null;
  const multiple = settings.calibrationMode === 'multiple';
  const library = calibrationLibrary(settings);
  const readings = multiple ? partitionFlowReadings(settings).active : library.filter(reading => close(reading.flow, settings.referenceFlow) && close(reading.targetTemperatureC, targetFor(settings)));
  return { mode: multiple ? 'multiple' : 'single', adjustable: multiple, minimum: readings[0].flow,
    maximum: readings[readings.length - 1].flow, defaultFlow: settings.referenceFlow, readings };
}

export function secondsPerGram(settings, flow) {
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
