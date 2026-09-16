# Contributor instructions

This is an independent Decaid JavaScript plugin, not a Flutter application.
Read README.md for installation and docs/CalibratedSteam.md for the API contract.

- Keep the plugin ID stable and preserve saved actual calibration measurements.
- Edit src/ and manifest.src.json; regenerate root plugin.js and manifest.json.
- Run npm test and verify that npm run build leaves committed output unchanged.
- Keep package and manifest versions equal; bump both when publishing changed code.
- Test changes to machine commands, calibration restoration and actual-weight
  handling. Never start steam except through an explicit guided calibration action.
- Update user and skin-developer documentation when behavior changes.
- Preserve Damian's attribution and the GPL-3.0-only license.
- Do not publish releases or modify unrelated repositories unless requested.
