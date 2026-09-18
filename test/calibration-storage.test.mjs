import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationStorageRecord, reconcileCalibrationStorage } from '../src/calibration-storage.mjs';

const oldLibrary = JSON.stringify([{ flow: 1.2, targetTemperatureC: 60, milkGrams: 160, seconds: 25 }]);
const newLibrary = JSON.stringify([{ flow: 1.5, targetTemperatureC: 60, milkGrams: 160, seconds: 22 }]);

test('first v2 load intentionally resets old settings calibrations', () => {
  const result = reconcileCalibrationStorage({ legacyPresent: true, legacyValue: oldLibrary, storedValue: null });
  assert.equal(result.flowReadings, '[]');
  assert.equal(result.source, 'reset');
  assert.deepEqual(result.write, calibrationStorageRecord('[]'));
});

test('stored v2 library wins when the settings shadow is unchanged', () => {
  const storedValue = calibrationStorageRecord(newLibrary);
  const result = reconcileCalibrationStorage({ legacyPresent: true, legacyValue: oldLibrary, storedValue });
  assert.equal(result.flowReadings, newLibrary);
  assert.equal(result.source, 'storage');
  assert.equal(result.write, null);
});

test('stored v2 library remains canonical when the manifest shadow is stale', () => {
  const result = reconcileCalibrationStorage({
    legacyPresent: true, legacyValue: newLibrary, storedValue: calibrationStorageRecord(oldLibrary),
  });
  assert.equal(result.flowReadings, oldLibrary);
  assert.equal(result.source, 'storage');
  assert.equal(result.write, null);
});

test('invalid v2 data resets instead of reviving old calibration semantics', () => {
  const result = reconcileCalibrationStorage({ legacyPresent: true, legacyValue: oldLibrary,
    storedValue: { schemaVersion: 2, flowReadings: '{bad' } });
  assert.equal(result.flowReadings, '[]');
  assert.equal(result.warning, 'invalid_storage');
});
