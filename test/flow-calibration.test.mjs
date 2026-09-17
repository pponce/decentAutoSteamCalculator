import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validateSettings } from '../src/core.mjs';
import { calibrationLibrary, flowCalibration, formatTemperature, multipleCalibrationRequirements, partitionFlowReadings,
  secondsPerGram, temperatureFromC, temperatureToC } from '../src/flow-calibration.mjs';

const base = { smallPitcherGrams: 150, mediumPitcherGrams: 0, largePitcherGrams: 0, autoDetect: false,
  weightMode: 'gross', calibrationMode: 'single', targetTemperatureC: 60, referenceFlow: 1.5,
  referenceMilkGrams: 200, referenceSeconds: 40, minimumFlow: 0.4, maximumFlow: 2.5,
  flowReadings: JSON.stringify([{ flow: 1.5, targetTemperatureC: 60, milkGrams: 200, seconds: 40 }]) };
const input = flow => ({ pitcher: 'small', flow, machineState: 'idle', stopAtTemperature: 0,
  samples: [800, 400, 0].map(ageMs => ({ ageMs, weightGrams: 350 })) });
const reading = (flow, seconds, targetTemperatureC = 60) => ({ flow, targetTemperatureC, milkGrams: 200, seconds });
const multiple = readings => ({ ...base, calibrationMode: 'multiple', referenceFlow: 1.5,
  flowReadings: JSON.stringify(readings) });

test('single flow uses only the selected saved calibration', () => {
  const settings = { ...base, flowReadings: JSON.stringify([reading(0.8, 55), reading(1.5, 40), reading(2.2, 25)]) };
  assert.equal(calculate(settings, input(undefined)).durationSeconds, 40);
  assert.equal(flowCalibration(settings).adjustable, false);
  assert.throws(() => calculate(settings, input(0.8)), error => error.code === 'flow_out_of_range');
});

test('temperature display conversion round-trips while calibration storage stays Celsius', () => {
  assert.equal(temperatureFromC(60, 'F'), 140);
  assert.equal(temperatureToC(140, 'F'), 60);
  assert.equal(temperatureFromC(60, 'C'), 60);
  assert.equal(temperatureToC(60, 'C'), 60);
  assert.equal(formatTemperature(60, 'F'), '140.0 °F');
  assert.equal(formatTemperature(60, 'C'), '60.0 °C');
  assert.equal(temperatureToC(temperatureFromC(60.1, 'F'), 'F'), 60.1);
});

test('legacy single settings become a preserved library reading at the migration target', () => {
  const legacy = { ...base, targetTemperatureC: 0, flowReadings: '[]' };
  assert.deepEqual(calibrationLibrary(legacy), [{ flow: 1.5, targetTemperatureC: 60, milkGrams: 200, seconds: 40 }]);
  assert.equal(calculate(legacy, input(undefined)).durationSeconds, 40);
});

test('active readings match both target temperature and the selected flow range', () => {
  const settings = { ...multiple([
    reading(0.4, 60), reading(0.8, 50), reading(1.5, 40), reading(2.5, 20),
    reading(0.6, 70, 55), reading(2.4, 25, 65),
  ]), minimumFlow: 0.8, maximumFlow: 2.0, referenceFlow: 1.5 };
  const { active, other } = partitionFlowReadings(settings);
  assert.deepEqual(active.map(item => item.flow), [0.8, 1.5]);
  assert.deepEqual(other.map(item => [item.flow, item.targetTemperatureC]), [[0.6, 55], [0.4, 60], [2.5, 60], [2.4, 65]]);
});

test('multiple flow requires exact endpoints and at least one interior reading', () => {
  const valid = { ...multiple([reading(0.4, 60), reading(1.3, 42), reading(2.5, 20)]), referenceFlow: 1.3 };
  assert.deepEqual(multipleCalibrationRequirements(valid), { active: calibrationLibrary(valid), hasMinimum: true, hasMaximum: true, hasInterior: true });
  assert.deepEqual(validateSettings(valid), []);
  for (const readings of [
    [reading(0.4, 60), reading(2.5, 20)],
    [reading(0.5, 58), reading(1.3, 42), reading(2.5, 20)],
    [reading(0.4, 60), reading(1.3, 42), reading(2.4, 22)],
  ]) assert.ok(validateSettings(multiple(readings)).some(error => error.field === 'flowReadings'));
});

test('all matching readings are used for adjacent piecewise interpolation', () => {
  const settings = multiple([
    reading(0.4, 80), reading(0.8, 64), reading(1.2, 52), reading(1.5, 40),
    reading(1.8, 34), reading(2.1, 28), reading(2.5, 20),
    reading(1.4, 200, 55),
  ]);
  assert.equal(flowCalibration(settings).readings.length, 7);
  assert.equal(secondsPerGram(settings, 1.2), 52 / 200);
  assert.ok(Math.abs(secondsPerGram(settings, 1.35) - (52 / 200 + 40 / 200) / 2) < 1e-12);
  assert.equal(calculate(settings, input(1.35)).durationSeconds, 46);
});

test('library can retain more than nine readings while runtime never extrapolates', () => {
  const readings = Array.from({ length: 22 }, (_, index) => reading(Number((0.4 + index * 0.1).toFixed(1)), 80 - index * 2));
  const settings = multiple(readings);
  assert.equal(flowCalibration(settings).readings.length, 22);
  assert.throws(() => calculate(settings, input(0.3)), error => error.code === 'flow_out_of_range');
  assert.throws(() => calculate(settings, input(2.6)), error => error.code === 'flow_out_of_range');
});

test('duplicate flow and target pairs and malformed saved readings are rejected', () => {
  for (const flowReadings of [
    JSON.stringify([reading(0.4, 60), reading(0.4, 55), reading(2.5, 20)]),
    JSON.stringify([reading(0.4, 60), { ...reading(1.5, 40), milkGrams: 0 }, reading(2.5, 20)]),
    '{bad',
  ]) assert.ok(validateSettings({ ...multiple([]), flowReadings }).length);
});
