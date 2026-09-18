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

### 1. Open the Decaid settings dashboard

Keep Decaid running and open this address in a browser:

[http://localhost:8080/api/v1/plugins/settings.reaplugin/ui](http://localhost:8080/api/v1/plugins/settings.reaplugin/ui)

`localhost` works when browsing on the tablet itself. If it does not work—or
you are using another device on the same network—replace `localhost` with the
tablet's IP address.

### 2. Install the supporting Streamline skin

The official Streamline skin does not yet include these Auto steam controls.
In the dashboard's **Install Skin** field, enter:

```text
pponce/streamline-js
```

Click **Install** and wait for it to finish. This installs the latest published
skin release; no branch selection or manual ZIP download is needed.

### 3. Select the skin inside the Decaid app

Return to the Decaid app. Go to **Settings → Skin** and select
**Streamline.js — Auto Steam**.

Its ID is `pponce.streamline-auto-steam`, so it can coexist with official
Streamline. This identity is for the test fork and should not be included in a
future upstream Streamline contribution.

### 4. Install and enable the calculator

In the new skin, go to **Settings → Extensions → Auto Steam Calculator**.
Select **Install Auto Steam Calculator**, wait for installation, then turn on
**Enable Auto Steam Calculator**.

Use this installation button inside the skin. The browser dashboard's separate
**Install Plugin (coming soon)** section is not needed. The skin uses Decaid's
existing GitHub branch installer for `pponce/decentAutoSteamCalculator`,
branch `main`.

### 5. Set it up

Select **Open settings**:

- Enter at least one empty Small, Medium or Large pitcher weight, manually or
  using **Tare empty scale** and **Set from scale**.
- Optionally enable Auto pitcher selection and complete its required settings.
- In **Calibration**, choose one **Scale weight mode**. **Gross** subtracts a
  selected empty pitcher; **Tared** expects the empty pitcher to be on the scale
  when you tare. The setting applies to every calibration.
- Choose **F** or **C** for temperature display. Each saved calibration keeps its
  own milk target. With **Interpolate** off, **Milk target** may be **All targets**
  or filter the exact saved calibrations offered on the shot page.
- Turn on **Interpolate** only when you want adjustable flow. It requires one
  specific milk target plus the exact minimum, exact maximum, and at least one
  interior reading. More matching readings improve interpolation. When that set
  is complete, **Preview** graphs calculated time by flow for
  several milk weights. The preview can browse other complete milk targets,
  choose **Use this milk target**, and enable **Smooth curve fit** separately for
  each target.
- Record the **actual milk-only weight for every reading**, manually or with
  guided calibration. Guided capture arms timing; start and stop steam using the
  physical machine controls.
- Select **Save settings** to activate the complete setup.

### 6. Test it

Return to the main shot page and tap the Steam heading to select **Auto**.
Place the filled pitcher on the scale, then tap its pitcher preset to calculate
the steaming time. Review the calculated time and start steaming normally.

With Interpolate off, Auto cycles through exact saved calibrations. Their saved
flow is fixed, and their milk target is shown briefly in the existing time
position before it returns to 0s. With Interpolate on, Auto permits 0.1 ml/s
adjustment within the measured range; after changing flow, tap the pitcher preset
again to calculate from the current milk weight. Manual Flow and Time remain available.
Off prompts recalculation between drinks; it is not a hard start interlock and
a physical start may produce a brief burst.

See the [full setup and skin-developer guide](docs/CalibratedSteam.md).

## Updates

The skin and plugin update independently:

- **Skin:** use **Check for Skin Updates** in the Decaid settings dashboard.
  Installations made using `pponce/streamline-js` follow its published releases.
  Pushing commits alone does not update a release-installed skin.
- **Calculator:** its settings page keeps the title centered and checks its
  recorded GitHub branch when the page opens. When current, the installed version
  appears alone at top right. When an update exists, the current and new version
  numbers appear immediately left of **Update**; one requesting additional
  permissions shows **Approve & Update** and lists those permissions before
  installation. A failed check shows
  **Unable to check · Retry**. Updates target only Auto Steam Calculator and
  preserve its saved settings. A GitHub 403 reports how many minutes remain
  before the unauthenticated API limit resets. Branch installs follow new commits
  on `pponce/decentAutoSteamCalculator`'s `main` branch.

The **Instructions** tab also shows whether this extension follows the stable or
beta branch. **Join beta** installs the newer beta for this extension only. Beta
versions may be less stable, and Decaid does not currently allow downgrades, so
**Return to stable** becomes available only when the stable version is equal to
or newer than the installed beta. Saved settings are preserved when changing
channels.

### Beta testing

Beta enrollment is per plugin: installing the `beta` branch changes Auto Steam
Calculator only. Decaid, skins and other plugins remain on their current update
sources. Beta builds use prerelease versions and each beta update advances that
version so the calculator's normal update check can offer it.

Beta `0.13.2-beta.9` adds the interpolation graph and per-target **Smooth curve
fit** preference. The extension chooses among safe simple curve candidates from
the saved readings and retains straight-line interpolation when no curve predicts
better. Calculations never extrapolate beyond the measured flow range.
This beta also prevents Android keyboard **Go** / implicit form submission from closing an open calibration editor or disturbing the saved calibration library; use **Update saved calibration** to commit that reading. The preview centers milk-target navigation, keeps the interpolation method and actions on one bottom row, hides Smooth curve fit when no safe smooth model is available, wraps the measured-reading legend, and lets **Use this milk target** close the preview even when that target is already selected. The preview is modal: tapping outside no longer closes it, and background settings scrolling is locked until **Close** or **Use this milk target** is pressed. **+ New calibration** remains available while Interpolate is enabled, so additional readings can be added without switching modes. If the new reading uses a different milk target, that target becomes active immediately; previous-target readings stay saved under the collapsed **Other saved calibrations** group until the user selects that target again.

Stable version `0.13.0` introduces the saved-calibration selector and interpolation
model tested in the 0.13.0 betas. It deliberately starts a new
`calibration-library.v2` record instead of importing older calibration semantics,
so users upgrading from 0.12.x must recreate their calibration readings. Each
reading is stored immediately; **Save settings** activates only a complete valid
setup.

Do not remove the beta merely to switch branches: removal clears manifest
settings even though Decaid leaves namespaced plugin storage intact. Return to a
stable build after a stable version at least as new as the beta is available, or
make a settings backup before testing a removal/reinstall rollback.

If you previously installed the skin from a branch or a ZIP URL, install it once
using `pponce/streamline-js` in the dashboard to switch to release updates.

## Development

Requires Node.js 22 or newer. No npm dependencies are required.

```bash
npm test
npm run build
```

Edit `src/` and `manifest.src.json`. Commit the generated root `manifest.json`
and `plugin.js` with the source. Their root placement is required by Decaid's
GitHub branch installer. Keep the package and manifest versions equal and keep
the plugin ID stable. Calculator API version is 5; the Decaid host manifest API
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
