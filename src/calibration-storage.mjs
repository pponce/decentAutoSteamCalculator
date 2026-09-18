export const CALIBRATION_STORAGE_KEY = 'calibration-library.v2';

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

export function calibrationStorageRecord(flowReadings, curveFitTargets = []) {
  if (!validSerializedLibrary(flowReadings)) return null;
  if (!validCurveFitTargets(curveFitTargets)) return null;
  return { schemaVersion: 2, flowReadings, curveFitTargets: [...new Set(curveFitTargets)].sort((a, b) => a - b) };
}

export function reconcileCalibrationStorage({ legacyPresent, legacyValue, storedValue }) {
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
