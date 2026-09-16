# Auto Steam Calculator for Decaid

An independently installed Decaid plugin that estimates steam time from actual
milk weight and your measured calibration. The formula and automatic pitcher
selection are inspired by [Damian / Damian-AU's DSx2](https://github.com/Damian-AU/DSx2).

The plugin owns calibration, pitcher settings, calculations and guided calibration.
A supporting skin supplies the main steam controls. It estimates temperature
through time; it does not measure milk temperature.

## Install in the official Decaid app

These instructions target the official Android Decaid v0.8.6 release or newer.
No custom APK, Java installation or application rebuild is needed. Internet
access is needed to install and update; calculation and settings run locally.

### 1. Install the supporting Streamline skin

The official Streamline skin does not yet include these Auto steam controls.
Open Decaid's skin selector and choose **Install skin → GitHub Branch**:

| Field | Value |
| --- | --- |
| Repository | `pponce/streamline-js` |
| Branch | `feature/calibrated-steam-timer` |

Install, then select **Streamline.js — Auto Steam**. Its ID is
`pponce.streamline-auto-steam`, so it can coexist with the official Streamline
skin. This identity is for the test fork and should not be included in a future
upstream Streamline contribution.

### 2. Install and enable the calculator

In that skin, open **Settings → Extensions → Auto Steam Calculator**:

1. Select **Install Auto Steam Calculator**. This uses Decaid's GitHub branch
   installer for this repository's `main` branch.
2. Select **Enable Auto Steam Calculator** if it is not already enabled.
3. Select **Open settings** to configure pitchers and calibration.

Alternatively, use Decaid's native **Plugins** screen → **Install Plugin → GitHub
Branch**, with repository `pponce/decentAutoSteamCalculator` and branch `main`.
Enable the plugin after installation. A GitHub release is not needed for this
branch-based installation.

If the calculator was already bundled in your experimental app, installing from
this repository replaces it with the independently tracked version. The plugin ID
remains `calibrated-steam.reaplugin`. Decaid preserves settings and enablement when
updating that ID within the same application installation. Separate app installs
have separate settings.

### 3. Configure and test

- Enter at least one empty Small, Medium or Large pitcher weight, manually or
  using **Tare empty scale** and **Set from scale**.
- Optionally enable Auto pitcher selection and complete its required settings.
- Choose single or multiple flow calibration. Record the **actual milk-only
  weight for every reading**, manually or with guided calibration.
- Save, return to the shot page, select **Auto**, put the filled pitcher on the
  scale, and tap its pitcher preset to calculate. Start steam normally afterward.

Single-flow Auto fixes the calibrated flow. Multiple-flow Auto permits adjustment
within the measured range and recalculates time from the current milk weight.
Manual Flow and Time remain available. Off prompts recalculation between drinks;
it is not a hard start interlock and a physical start may produce a brief burst.

See the [full setup and skin-developer guide](docs/CalibratedSteam.md).

## Updates

Decaid records the GitHub branch source and checks it through its normal plugin
update mechanism. In the Plugins screen, check for updates to fetch new commits.
The skin and plugin update independently. Use Decaid's skin update controls for
the Streamline fork. Branch installs follow development commits; no release tag
needs to be created for each test update.

## API installation alternative

From a computer on the tablet's network, replace `TABLET_IP` with its address.
Use Decaid's configured API port if it differs from 8080:

```bash
curl --fail-with-body -X POST http://TABLET_IP:8080/api/v1/webui/skins/install/github-branch \
  -H 'Content-Type: application/json' \
  -d '{"repo":"pponce/streamline-js","branch":"feature/calibrated-steam-timer"}'

curl --fail-with-body -X PUT http://TABLET_IP:8080/api/v1/webui/skins/default \
  -H 'Content-Type: application/json' \
  -d '{"skinId":"pponce.streamline-auto-steam"}'

curl --fail-with-body -X POST http://TABLET_IP:8080/api/v1/plugins/install/github-branch \
  -H 'Content-Type: application/json' \
  -d '{"repo":"pponce/decentAutoSteamCalculator","branch":"main"}'

curl --fail-with-body -X POST \
  http://TABLET_IP:8080/api/v1/plugins/calibrated-steam.reaplugin/enable
```

Then open the selected skin in Decaid and configure the calculator. Decaid handles
package installation, permissions, settings and updates; the skin does not download
or execute code directly from GitHub.

## Development

Requires Node.js 22 or newer. No npm dependencies are required.

```bash
npm test
npm run build
```

Edit `src/` and `manifest.src.json`. Commit the generated root `manifest.json`
and `plugin.js` with the source. Their root placement is required by Decaid's
GitHub branch installer. Keep the package and manifest versions equal and keep
the plugin ID stable. Calculator API version is 4; the Decaid host manifest API
is 1.

CI runs the tests, checks generated-file consistency, and uploads an installable
ZIP artifact containing the runtime files and license. It does not publish
releases automatically. A future GitHub release must have a version-matching tag
and one plugin ZIP asset, per [Decaid's packaging contract](https://github.com/decentespresso/decaid/blob/v0.8.6/doc/Plugins.md#packaging-a-release).

This project is maintained independently by pponce. It is not a Decaid bundled
plugin or an official Streamline feature. No changes to Decaid's native code are
required. Historical design notes are in `docs/design/`.

## License and attribution

GPL-3.0-only; see [LICENSE.txt](LICENSE.txt). Extracted from pponce's experimental
Decaid feature branch, preserving the existing licensing and attribution.
Damian is credited for the original calibrated steam calculator and pitcher
heuristics. This is a JavaScript implementation, not a copy of the DSx2 Tcl UI.
