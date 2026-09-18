import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validateSettings } from '../src/core.mjs';
import { availableTargets, calibrationKey, calibrationLibrary, flowCalibration, formatTemperature,
  interpolationModel, interpolationRequirements, normalizeCurveFitTargets, partitionFlowReadings, secondsPerGram,
  smoothCurveModel, temperatureFromC, temperatureToC
} from '../src/flow-calibration.mjs';

const reading = (flow, seconds, targetTemperatureC = 60) => ({ flow, targetTemperatureC, milkGrams: 200, seconds });
const baseReading = reading(1.5, 40);
const base = { smallPitcherGrams: 150, mediumPitcherGrams: 0, largePitcherGrams: 0, autoDetect: false,
  weightMode: 'gross', temperatureUnit: 'F', interpolate: false, targetTemperatureC: 0,
  referenceFlow: 0.4, referenceMilkGrams: 0, referenceSeconds: 0, minimumFlow: 0.4, maximumFlow: 2.5,
  flowReadings: JSON.stringify([baseReading]) };
const input = extra => ({ pitcher: 'small', machineState: 'idle', stopAtTemperature: 0,
  samples: [800, 400, 0].map(ageMs => ({ ageMs, weightGrams: 350 })), ...extra });
const interpolated = readings => ({ ...base, interpolate: true, targetTemperatureC: 60,
  flowReadings: JSON.stringify(readings) });

test('saved mode exposes every filtered calibration as an exact choice', () => {
  const readings = [reading(0.8, 55), reading(1.5, 40), reading(2.2, 25, 65)];
  const settings = { ...base, flowReadings: JSON.stringify(readings) };
  const calibration = flowCalibration(settings);
  assert.equal(calibration.mode, 'saved');
  assert.equal(calibration.adjustable, true);
  assert.deepEqual(calibration.choices.map(choice => choice.key), readings.map(calibrationKey));
  assert.equal(calculate(settings, input({ calibrationKey: calibrationKey(readings[1]) })).durationSeconds, 40);
  assert.equal(calculate(settings, input({ calibrationKey: calibrationKey(readings[2]) })).targetTemperatureC, 65);
  assert.throws(() => calculate(settings, input({ calibrationKey: 'missing' })), error => error.code === 'calibration_required');
});

test('milk target filters exact choices and All targets includes every target', () => {
  const readings = [reading(0.8, 55, 55), reading(1.5, 40, 60), reading(2.2, 25, 65)];
  const all = { ...base, targetTemperatureC: 0, flowReadings: JSON.stringify(readings) };
  assert.deepEqual(partitionFlowReadings(all).active, calibrationLibrary(all));
  const filtered = { ...all, targetTemperatureC: 60 };
  assert.deepEqual(partitionFlowReadings(filtered).active.map(calibrationKey), [calibrationKey(readings[1])]);
  assert.deepEqual(partitionFlowReadings(filtered).other.map(calibrationKey), [calibrationKey(readings[0]), calibrationKey(readings[2])]);
  assert.deepEqual(availableTargets(all), [55, 60, 65]);
});

test('temperature display conversion round-trips while storage stays Celsius', () => {
  assert.equal(temperatureFromC(60, 'F'), 140);
  assert.equal(temperatureToC(140, 'F'), 60);
  assert.equal(formatTemperature(60, 'F'), '140.0 °F');
  assert.equal(formatTemperature(60, 'C'), '60.0 °C');
  assert.equal(temperatureToC(temperatureFromC(60.1, 'F'), 'F'), 60.1);
});

test('old scalar calibration fields no longer synthesize a saved reading', () => {
  const old = { ...base, flowReadings: '[]', referenceFlow: 1.5, referenceMilkGrams: 200, referenceSeconds: 40 };
  assert.deepEqual(calibrationLibrary(old), []);
  assert.ok(validateSettings(old).some(error => error.field === 'flowReadings'));
});

test('interpolation filters by target and range', () => {
  const settings = { ...interpolated([
    reading(0.4, 60), reading(0.8, 50), reading(1.5, 40), reading(2.5, 20),
    reading(0.6, 70, 55), reading(2.4, 25, 65),
  ]), minimumFlow: 0.8, maximumFlow: 2.0 };
  const { active, other } = partitionFlowReadings(settings);
  assert.deepEqual(active.map(item => item.flow), [0.8, 1.5]);
  assert.deepEqual(other.map(item => [item.flow, item.targetTemperatureC]), [[0.6, 55], [0.4, 60], [2.5, 60], [2.4, 65]]);
});

test('interpolation requires exact endpoints and at least one interior reading', () => {
  const valid = interpolated([reading(0.4, 60), reading(1.3, 42), reading(2.5, 20)]);
  assert.deepEqual(interpolationRequirements(valid), { active: calibrationLibrary(valid), hasMinimum: true, hasMaximum: true, hasInterior: true });
  assert.deepEqual(validateSettings(valid), []);
  for (const readings of [
    [reading(0.4, 60), reading(2.5, 20)],
    [reading(0.5, 58), reading(1.3, 42), reading(2.5, 20)],
    [reading(0.4, 60), reading(1.3, 42), reading(2.4, 22)],
  ]) assert.ok(validateSettings(interpolated(readings)).some(error => error.field === 'flowReadings'));
});

test('interpolation requires a specific milk target', () => {
  const settings = { ...interpolated([reading(0.4, 60), reading(1.3, 42), reading(2.5, 20)]), targetTemperatureC: 0 };
  assert.ok(validateSettings(settings).some(error => error.field === 'targetTemperatureC'));
});

test('all matching readings are used for adjacent piecewise interpolation', () => {
  const settings = interpolated([
    reading(0.4, 80), reading(0.8, 64), reading(1.2, 52), reading(1.5, 40),
    reading(1.8, 34), reading(2.1, 28), reading(2.5, 20), reading(1.4, 200, 55),
  ]);
  assert.equal(flowCalibration(settings).readings.length, 7);
  assert.equal(secondsPerGram(settings, 1.2), 52 / 200);
  assert.ok(Math.abs(secondsPerGram(settings, 1.35) - (52 / 200 + 40 / 200) / 2) < 1e-12);
  assert.equal(calculate(settings, input({ flow: 1.35 })).durationSeconds, 46);
});

test('Smooth curve fit automatically selects a safe inverse curve when it predicts better', () => {
  const readings = [reading(0.5, 80), reading(1.5, 40), reading(2.5, 32)];
  const settings = { ...interpolated(readings), minimumFlow: 0.5, maximumFlow: 2.5, curveFitTargets: [60] };
  const model = interpolationModel(settings);
  assert.equal(model.requested, true);
  assert.equal(model.kind, 'inverse');
  assert.ok(Math.abs(model.predict(1) - 0.25) < 1e-12);
  assert.ok(Math.abs(secondsPerGram(settings, 1) - 0.25) < 1e-12);
  assert.equal(flowCalibration(settings).interpolationMethod, 'smooth');
});

test('Smooth curve fit falls back to straight lines when a curve is not better', () => {
  const readings = [reading(0.5, 60), reading(1.5, 40), reading(2.5, 20)];
  const settings = { ...interpolated(readings), minimumFlow: 0.5, maximumFlow: 2.5, curveFitTargets: [60] };
  assert.equal(smoothCurveModel(readings).kind, 'linear');
  assert.equal(interpolationModel(settings).kind, 'linear');
  assert.equal(secondsPerGram(settings, 1), 50 / 200);
});

test('Smooth curve preferences are normalized per milk target', () => {
  assert.deepEqual(normalizeCurveFitTargets('[60,55,60,0,101]'), [55, 60]);
  assert.deepEqual(normalizeCurveFitTargets('bad'), []);
});

test('library can retain more than nine readings while interpolation never extrapolates', () => {
  const readings = Array.from({ length: 22 }, (_, index) => reading(Number((0.4 + index * 0.1).toFixed(1)), 80 - index * 2));
  const settings = interpolated(readings);
  assert.equal(flowCalibration(settings).readings.length, 22);
  assert.throws(() => calculate(settings, input({ flow: 0.3 })), error => error.code === 'flow_out_of_range');
  assert.throws(() => calculate(settings, input({ flow: 2.6 })), error => error.code === 'flow_out_of_range');
});

test('duplicate flow and target pairs and malformed saved readings are rejected', () => {
  for (const flowReadings of [
    JSON.stringify([reading(0.4, 60), reading(0.4, 55), reading(2.5, 20)]),
    JSON.stringify([reading(0.4, 60), { ...reading(1.5, 40), milkGrams: 0 }, reading(2.5, 20)]),
    '{bad',
  ]) assert.ok(validateSettings({ ...interpolated([]), flowReadings }).length);
});
