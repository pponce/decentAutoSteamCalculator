export const CALIBRATION_STORAGE_KEY = 'calibration-library.v2';

function validSerializedLibrary(value) {
  if (typeof value !== 'string' || value.length > 65536) return false;
  try {
    const readings = JSON.parse(value);
    return Array.isArray(readings) && readings.length <= 100;
  } catch {
    return false;
  }
}

export function calibrationStorageRecord(flowReadings) {
  if (!validSerializedLibrary(flowReadings)) return null;
  return { schemaVersion: 2, flowReadings };
}

export function reconcileCalibrationStorage({ legacyPresent, legacyValue, storedValue }) {
  const storedValid = storedValue && storedValue.schemaVersion === 2 &&
    validSerializedLibrary(storedValue.flowReadings);

  if (!storedValid) {
    const flowReadings = '[]';
    return {
      flowReadings,
      source: 'reset',
      write: calibrationStorageRecord(flowReadings),
      warning: storedValue == null ? null : 'invalid_storage',
    };
  }

  return {
    flowReadings: storedValue.flowReadings,
    source: 'storage',
    write: null,
    warning: null,
  };
}
