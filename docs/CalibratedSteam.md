# Auto Steam Calculator

This independently installed, opt-in plugin estimates steam duration from a known milk-weight/time
calibration. It does not measure milk temperature. Decaid runs the plugin and persists its
settings; a supporting skin owns the controls and uses the ordinary workflow API
to apply the duration. DYE2 is neither required nor modified.

Install the plugin and supporting skin using the [official-app setup guide](../README.md#install-in-the-official-decaid-app). No custom APK is required.

## Setup and use

In Streamline, open **Settings > Extensions**, select **Auto Steam Calculator**,
enable the extension (install it first if needed), then choose **Open**. Streamline
builds this plugin row and details page generically from `GET /api/v1/plugins` and
the manifest; no calculator-specific settings page is required in the skin. The
standalone page provides a return address:
**Return to settings** leaves without saving, and a successful **Save settings**
returns to the calling settings page. Validation or save errors keep the form open.

The settings page uses compact **Pitchers & Auto**, **Calibration**,
**Instructions**, and **Glossary** tabs. Each calibration stores its flow, milk
target, actual milk weight and measured time. The compact summary shares the tab
row and updates as the draft changes. It always shows S, M, L and Auto: available
choices are green and unavailable choices are red. Calibration readings are
stored immediately; **Save settings** activates the overall valid setup.

The page keeps **Auto Steam Calculator** centered in its header and checks the
recorded GitHub branch when it opens. When the installed version is current, that
version appears alone at top right. When a newer version exists, the current and
new versions appear immediately left of **Update**; one that adds permissions
shows **Approve & Update** and names those permissions before the user approves
installation. A failed check shows **Unable to check · Retry**.
The action uses Decaid's branch installer for this extension only and preserves
saved settings. Results and update failures open in a dialog. A GitHub 403
reports the remaining minutes until the unauthenticated API limit resets.

Pitchers & Auto places empty-scale tare beside the pitcher rows. Each **Set from
scale** button fills its own field without focusing it first, and reports success
or failure in that row. The Auto switch is grouped with its two detection inputs.
Calibration has a second tare button, live scale status, a derived milk-weight
result, and guidance for the physical start/stop sequence. Save reveals the tab
and first invalid setting.

1. Enter at least one empty pitcher weight, or use **Tare empty scale** and then
   **Set from scale** for each size. Wait for the stable-zero message before
   placing an empty pitcher on the scale. Blank or 0 means an unused size.
2. Optionally enable **Offer Auto pitcher selection**. This reveals the required
   usual milk per drink and the Small/Medium pitcher normally used for one drink.
   Damian's existing heuristic needs all three pitcher weights and gross scale
   weight. Auto is not offered until these inputs are valid; it is opt-in.
3. In Calibration, choose **Gross** or **Tared** once. This global choice applies
   to every calibration. The supporting skin owns and
   remembers the current pitcher preset; the plugin no longer has a separate
   starting-pitcher setting.
4. Leave **Interpolate** off for the simplest setup and create one saved
   calibration. **Milk target** may be **All targets** or one saved target.
   Turn on **Interpolate** only to calculate between multiple flow readings at
   one specific milk target. For guided Gross calibration, tare the empty
   scale, choose a configured pitcher, and **Capture pitcher + milk (g)**. For
   Tared calibration, put the empty pitcher on the scale, select **Tare**, add
   milk, and **Capture milk only (g)**. Capture arms the session. Start and stop
   steam with the physical machine controls; there are no software Start/Stop
   buttons. The page fills the actual milk weight, time and flow after the machine
   stops and prior steam settings are restored.
   Alternatively, choose **Enter measured time** for each reading and enter values
   measured using normal manual steam controls, then select **Update saved calibration**.
5. Save. Use similar milk, starting temperature and technique on later runs.

Only configured sizes appear in the steam presets. With no setup, top-level Auto
remains available while the extension is enabled, but it stays Off and shows a
setup reminder. Calibration must be valid before a preset can calculate. Manual
Flow and Time remain available regardless of extension setup.

Streamline shows **Auto | F | T**, with the active mode blue. Tap the Steam heading
or mode label to cycle. In Auto, the usual preset row shows the configured **S / M / L** choices, plus **Auto** only when automatic detection is configured.
Place the filled pitcher on the scale and tap a preset to calculate and apply. Tapping
an already-selected preset recalculates; no preview dialog or Use time button is
involved. Success shows pitcher, milk mass and seconds; start steam normally afterward.

Saved calibration flows may be **0.4 to 2.5 ml/s**. With Interpolate off, the
skin cycles through exact saved calibrations and applies each reading's measured
flow. With Interpolate on, flow is adjustable in 0.1 ml/s steps only inside the
selected measured range.

Auto applies the calibration flow. After calculation, Streamline restores its
normal heater setting from before Auto was entered (or its existing remembered
normal setting if steam was already Off). No heater setting is stored in the
calculator, and no temperature compensation is performed. Entering Auto, finishing a steam cycle, reloading an active session, or leaving
an armed calculation on the main page resets to **Off** until the next calculation.
Navigation never waits for this background reset. A confirmed Off state is retained
across ordinary navigation; unchanged settings are not rewritten. Focus and merely
opening/closing settings do not refresh steam settings. Reconnect and actual plugin
configuration changes revalidate them. Duplicate resets share one pending operation;
a calculation in progress is invalidated if the user leaves the main page. Off means duration 0 and heater target 0, matching Streamline's manual
Off behavior. It is a reminder rather than a hardware start interlock: a physical
start may still produce a brief steam burst. Resets wait until the machine is idle.

The skin saves the previous manual duration, flow, heater target and probe-stop
setting before entering Auto and restores them on exit or plugin disable. A disable
during steaming defers restoration until idle. Auto values do not replace manual
preferences or profile values. While Auto is active, use pitcher presets to set the
time. Manual number editors stay inactive in Auto. With one available saved
calibration, Auto hides only the − / + icons, keeping their gray button
backgrounds visible and disabled. With several, the buttons cycle through exact
calibrations. The selected milk target briefly replaces the existing 0s display,
then that display returns to 0s; the Streamline layout does not change.
Interpolate uses the same buttons for 0.1 ml/s flow adjustment within the
calibrated range while the machine is idle. Any selection or flow change resets
time to Off; tap the pitcher again to calculate from the current scale weight.
The skin remembers the Auto selection separately from manual settings. Normal
Flow and Time modes keep − / +.

**Gross** means pitcher plus milk: start with the empty scale at zero and do not tare
the pitcher. **Tared** means milk only: no pitcher weight is subtracted and automatic pitcher
identification is unavailable. The software cannot detect a physical tare button
press; the selected mode must match the scale display.

## Saved calibrations and Interpolate

Every saved calibration contains flow, target temperature, actual milk weight and
measured seconds. A flow/temperature pair is unique. The library is not limited
to nine readings and keeps measurements until the user deletes them.

With Interpolate off, **Milk target** defaults to **All targets**. The active
list and shot page include every saved reading allowed by that filter. There is
no default checkbox: the skin remembers the last selected calibration on that
device and falls back to the first currently available choice.

Interpolate asks for a minimum and maximum between 0.4 and 2.5 ml/s. Its active
set contains every saved reading whose target temperature matches the selected
target and whose flow is inside the selected range. It requires at least three
active readings: one at the exact minimum, one at the exact maximum, and at least
one interior reading. A reading near the middle is recommended, but not forced.
Additional matching readings are all used. Readings outside the range or at a
different target temperature remain under collapsed **Other saved calibrations**.
Changing range or target therefore does not erase prior work.

Record the **actual milk-only weight for every reading**. New manual readings
start blank and require the measured weight; guided calibration fills it from
the scale after subtracting the selected pitcher. Each reading stores and uses
its own actual weight. Editing a saved reading retains its measured values.

**Temperature unit** is a remembered display preference with Fahrenheit as the
default. Switching between F and C converts Milk target options,
saved-calibration labels and guided instructions to the equivalent temperature.
Every reading remains stored
canonically in Celsius, so changing the display unit does not create a different
calibration or alter its measured weight, time or flow. Target temperature does
not set the steam heater or stop steam. It selects which readings belong to the
active Interpolate set, so readings at different target temperatures are never mixed.

For each point, use the same pitcher,
milk starting temperature, target temperature, heater setting and technique. Use
fresh milk for each run, not milk already heated by the previous reading. Similar
amounts help keep technique consistent, but record each actual milk weight.

Each point offers manual time entry or the existing guided calibration. The
reading heading shows its required flow. Guided Prepare applies that flow, not
the default Auto flow. Start remains unavailable until preparation completes and
rechecks the workflow's flow, duration and probe-stop settings before requesting
steam. No successful result is returned until prior steam settings are restored.

Each **Edit** button opens that calibration directly below its row. Only one
editor is open at a time. **Update saved calibration** closes it after accepting the
measurement; **Close without update** and the opener's **Cancel** state discard
the draft. Missing Interpolate requirements have **Create reading** controls, which
also toggle to **Cancel** while open. Delete removes only that library entry. If
deletion makes Interpolate incomplete, recreate the missing endpoint/interior
entry or turn Interpolate off before saving. Individual readings are written to
plugin storage immediately, so an incomplete interpolation set can be completed
across later visits without activating an invalid setup.

## Guided calibration details

In Gross mode, tare means an **empty scale**. In Tared mode, place the empty
pitcher on the scale before taring. The page waits
for a stable zero (within 0.5 g), then allows capture from at least three fresh
samples spanning 500 ms with no more than 2 g spread. This cannot detect a later
press of the scale's physical tare button. Repeat the empty-scale tare if unsure.
Gross guided calibration subtracts the explicitly selected pitcher. Tared guided
calibration removes the pitcher selector and treats captured weight as milk only.
Auto inference is not used for calibration. Initial milk weight is frozen before steam starts;
removing the pitcher from the scale does not change it.

Capture prepares and applies the current reading's flow (0.4–2.5 ml/s), the existing normal heater
setting and a temporary duration of 255 seconds, with probe stopping disabled.
255 is the existing machine timer ceiling, not a new user setting. The user stops
at their desired temperature. The measured counter follows machine snapshot
`pouring` time, excluding warm-up. On Decaid 0.8.6 or newer, `puffing` freezes
the final measured time and displays **Steam stopped · finishing purge…** while
the machine completes its purge; confirmed idle is still required before settings
are restored and the reading completes. A `pausedSteam` state rejects the reading
because guided calibration requires one continuous pour. Runs reaching the timer
ceiling and interrupted telemetry are also not accepted as calibration. After
review, Save stores values and returns to settings.
Changing a single calibration flow clears its measured weight and time and
requires a new measurement. Changing a multiple calibration default inside the measured range
does not discard readings. Capture fresh milk to repeat any guided reading.

The plugin owns preparation and restoration; the page renews its session lease.
Return to settings cancels an active run and waits for restoration before navigating.
Page closure or a six-second heartbeat gap cancels the run. Machine telemetry gaps
over three seconds invalidate it. The plugin requests stop and restores the prior
steam settings after confirmed idle, retrying a failed restoration while loaded.
Results are exposed only after restoration succeeds. App termination or forcibly
unloading the plugin ends this protection; incomplete results are never saved and
previous settings should be checked after restarting. A stopped app cannot issue
machine commands. The machine's own timer remains in effect.

For a low milk weight, the main controls show a compact message such as
**Milk < 10 g · Medium pitcher**. Auto names the pitcher chosen by the heuristic;
tared mode identifies milk-only weight. The validation range remains unchanged.

## Attribution and calculation

The formula and pitcher-selection heuristic are inspired by Damian / Damian-AU's
[DSx2](https://github.com/Damian-AU/DSx2), specifically `skin_steam_time_calc` in
`code/procs_vars.tcl`. This is a new JavaScript implementation; it does not copy
DSx2's Tcl UI or artwork. Damian is credited in the manifest and settings UI.

An exact saved calibration uses
`seconds = round(readingSeconds × milkGrams / readingMilkGrams)`.

Interpolate normalizes each reading to `rate = seconds / milkGrams`. For a
requested flow between adjacent measured flows `f0` and `f1`, let
`p = (flow - f0) / (f1 - f0)`. Every active reading participates through its
adjacent segment. Then
`seconds = round(milkGrams × ((1-p) × rate0 + p × rate1))`.
Measured endpoints retain their measured rate. There is no curve fitting or
extrapolation beyond the measured range. This extension to the original ratio
is an empirical estimate; it still assumes time scales approximately with milk
mass. Heater-temperature compensation and pitcher inference are unchanged.

For gross weight `W`, empty small/medium pitcher weights `S`/`M`, and usual
single-drink milk mass `D`:

| Normal single-drink pitcher | Select medium when | Select large when |
| --- | --- | --- |
| Small | `W > 1.7 × D + S` | `W > 2.7 × D + M` |
| Medium | `W > 0.7 × D + S` | `W > 1.7 × D + M` |

Selection starts at small, then evaluates medium and large in order; large wins
when both conditions hold. Comparisons are strictly greater-than, matching DSx2.
The selected empty-pitcher weight is subtracted from gross weight. A manual choice
overrides the heuristic. Total weight cannot uniquely identify every possible
pitcher/milk combination: skins must display the inference and allow correction.

## Skin developer contract

Discover the plugin through `GET /api/v1/plugins`. Its id is
`calibrated-steam.reaplugin`. Activate controls only when it is **loaded** and
declares the `calculate` HTTP endpoint. `autoLoad` is a startup preference, not
proof that the plugin is running. Restore the skin's usual steam UI if disabled.

| Method | Plugin endpoint | Purpose |
| --- | --- | --- |
| GET | `status` | API version, `calibrationActive`, readiness, `availablePitchers`, current settings, validation errors and setting schema |
| GET | `ui` | Standalone settings form with a `returnTo` query parameter |
| POST | `validate` | Validate a complete settings object without storing it |
| POST | `calculate` | Return a calculation and duration/flow workflow patch; performs no write |
| POST | `calibration` | Prepare, start, stop, cancel or renew an owned guided calibration session |
| POST | `library` | Validate and persist saved readings independently of overall setup readiness |

`calculate` is calculation-only: it never writes workflow or machine settings and
never starts steaming. The supporting skin owns the separate, validated and
machine-bounded workflow write after it has rejected stale observations.

Prefix endpoints with `/api/v1/plugins/calibrated-steam.reaplugin/`.
Settings are persisted through the existing
`POST /api/v1/plugins/calibrated-steam.reaplugin/settings` endpoint. That endpoint
reloads a loaded plugin. Use `validate` first for actionable calibration errors.
The form and its endpoints work offline against the local Decaid server.

Status includes `availablePitchers`, for example `["medium"]` or
`["small", "medium", "large", "auto"]`. Render these choices instead of hard-coding
four buttons. Gate calculation on `ready`, re-read status when settings change,
and reject a saved selection no longer present. `autoDetect` defaults to false;
missing pitcher weights are 0. Automatic detection requires all three weights,
`singleDrinkGrams`, `singleDrinkPitcher` and gross mode. Saving manual-only settings
requires at least one pitcher and the calibration, without Auto-specific inputs.
Settings and API fields consistently use pitcher terminology: `smallPitcherGrams`,
`mediumPitcherGrams`, `largePitcherGrams`, `singleDrinkPitcher`, `pitcher`,
`pitcherGrams` and `pitcherSource`. Skins should remember their current pitcher
selection themselves and fall back to the first `availablePitchers` entry if a
remembered selection is no longer available.

Open the form as a normal page rather than an iframe. Supply the calling skin's
settings address using `?returnTo=` plus a URL-encoded absolute URL. The form
uses that address for its top return link and successful save. It accepts HTTP(S)
addresses on the same host (including equivalent loopback names), with no embedded
credentials; the skin port and route are preserved. Without a valid address it
tries a same-host referrer, then falls back to Decaid's settings plugin. The plugin
has no dependency on Streamline routes. Streamline supplies its `?page=settings`
URL and restores the selected settings category from its existing navigation state.


### Calibration-selection capability

Status uses contract `apiVersion: 5` and includes `flowCalibration`, either null
for an invalid setup or one of these capability-driven shapes:

- Interpolate off: `{mode: "saved", adjustable, defaultCalibrationKey, choices, readings}`.
  Each choice is `{key, flow, targetTemperatureC, targetLabel}`. The key is opaque
  to the skin. Cycle this ordered list, remember the key device-locally, and fall
  back to `defaultCalibrationKey` when the remembered key is absent.
- Interpolate on: `{mode: "interpolate", adjustable: true, minimum, maximum,
  step: 0.1, defaultFlow, readings}`. Keep the existing 0.1 ml/s controls and
  never extrapolate beyond the returned range.

Each full reading is `{flow, targetTemperatureC, milkGrams, seconds}`. Also
require `ready`; valid calibration data alone does not establish valid pitcher
settings. A selection change invalidates any armed duration and writes the safe
Off state before another calculation.

Persist `interpolate` (false by default). `targetTemperatureC: 0` means
**All targets** only when Interpolate is off. Interpolate requires a specific
target with exact minimum and maximum readings plus at least one interior reading.
The v5 beta intentionally starts a new Decaid plugin-storage record at
`calibration-library.v2` and does not import older calibration semantics.
Beta testers recreate their readings. The `library` endpoint validates and
stores individual library changes even when an interpolation set is incomplete;
the complete extension setup remains unready until normal validation succeeds.

Generic manifest-driven settings pages expose the serialized compatibility field
as text; skins should direct calibration edits to the plugin's **Open** page.
`referenceFlow`, `referenceMilkGrams` and `referenceSeconds` are editor
working values, not a default calibration. `minimumFlow` and `maximumFlow`
select the Interpolate range without deleting readings. `temperatureUnit` is
`F` by default or `C` and affects display only.

With Interpolate off, a `calculate` body must include a current
`calibrationKey`. The plugin selects both the exact calibration ratio and its
flow; stale or filtered keys return `calibration_required`. With Interpolate on,
send numeric `flow`; values outside the measured range return
`flow_out_of_range`. The response includes `calibrationKey` (null for
Interpolate), `targetTemperatureC`, `targetLabel`, and the exact duration/flow
workflow patch. Never retain a previous duration or reuse a prior milk measurement
silently. Keep manual steam preferences separate.

### Reusing guided calibration in another skin

Opening the shared `ui` is sufficient; skins do not need their own scale or
calibration UI. When temporarily parking the heater Off, a skin may pass its
remembered normal heater target as `steamHeaterTemperature=145` alongside
`returnTo`. Only integer targets 135–165 °C are accepted. The live workflow's
positive heater target takes precedence. If neither is available, the page asks
the user to enable the normal steam heater before calibrating. The value is used
for machine operation, not stored as calibration or used for temperature scaling.
Streamline supplies its existing saved target from both Open settings entry points.

Before an Auto workflow write, consult `status.calibrationActive`. If true, defer
Auto resets, calculated writes and manual-backup restoration. Do not rewrite
steam settings from another client during calibration. `calculate` returns 409
while calibration owns the machine settings. This is cooperative skin coordination,
not a global lock on Decaid's workflow API.

A custom guided UI can `POST calibration` with:

```json
{"action":"begin","pitcher":"small","pitcherGrams":150,"milkGrams":160,"flow":0.4,"heaterTemperature":145}
```

For Tared mode, send `"pitcher":null` and `"pitcherGrams":0`; `milkGrams`
is the captured milk-only weight.

`begin` validates idle state, fresh host machine telemetry, pitcher/milk ranges,
flow and heater availability before preparation. Weights come from the caller's
validated capture; the endpoint does not authenticate scale samples. The response
includes an opaque `token`, `active`, `phase`, `message`, `seconds`, `measurement`
and `result`. Subsequent requests use `{action, token}`, with action `heartbeat`,
`start`, `stop` or `cancel`. Renew at least every two seconds while active; the
bundled page renews every 500 ms to show the counter. Only the owning token can
control a session; concurrent begins return 409. Phase progresses through
`preparing`, `armed`, `starting`/`heating`/`steaming`, `restoring`, then `complete`
or `failed`. Result remains null until a valid run has ended and restoration
has succeeded. A complete result contains milkGrams, pitcher, pitcherGrams, flow
and measured seconds. It is not automatically persisted. On page hide, request
cancel with keepalive; the lease is the fallback if that request cannot arrive.
Do not reload or disable the plugin during an active session.

Example request body for `calculate`:

```json
{
  "samples": [
    {"weightGrams": 330, "ageMs": 800},
    {"weightGrams": 330, "ageMs": 400},
    {"weightGrams": 330, "ageMs": 0}
  ],
  "pitcher": "auto",
  "calibrationKey": "1.500@60.000",
  "machineState": "idle",
  "stopAtTemperature": 0
}
```

Supply real observations from the skin's existing scale stream. Do not duplicate
one reading to manufacture a stable window. Samples must be oldest-to-newest,
have strictly decreasing nonnegative ages, span at least 500 ms, contain 3–64
readings, have a spread no greater than 2 g and be no older than 2500 ms; the
newest must be at most 1500 ms old. The median determines the mass. Clear samples
on disconnect, reconnection, scale replacement and backward clock changes.
Timestamp ages are caller-provided; this API cannot authenticate the observations
or guarantee that a skin is reporting actual live hardware state.

With a 150 g small pitcher and a 150 g / 25 s calibration, the example returns
`pitcher: "small"`, `pitcherSource: "heuristic"`, `milkGrams: 180`,
`durationSeconds: 30`, and:

```json
{"steamSettings": {"duration": 30, "flow": 1.5}}
```

The response also contains `scaleGrams`, `pitcherGrams`, `targetTemperatureC`,
`targetLabel`, `apiVersion: 5` and an opaque
`calibrationRevision`. Do not parse the revision: compare it to invalidate a
preview when the settings change. `pitcherSource` is `heuristic`, `manual` or `tared`.
Tared mode requires an explicit configured pitcher choice; Auto detection is unavailable.

Check `status.apiVersion` before using the calculator; the current contract is 5.
The plugin manifest's `apiVersion` identifies the Decaid host API and remains 1.
The workflow patch contains duration and flow only; the skin owns heater handling.
There is no configurable maximum duration; results must fit the supported
1–255-second timer range.

Damian's `skin_steam_time_calc` uses calibration time, calibration milk weight,
scale weight and pitcher weight. It neither scales time for heater temperature nor
captures a heater calibration value, and has no separate maximum-duration cap.
The matching equation here likewise does not compensate for heater or starting
milk temperature. Recalibrate if the steaming conditions change.

Before applying, obtain fresh workflow and machine state and recalculate with
fresh scale samples. Reject changed observations or calibration. Apply duration
and flow together through `PUT /api/v1/workflow`; never start steam or run the
stop countdown in a WebView. If the skin has put steam Off, restore its existing
normal heater setting as part of the same write. Do not invent a new heater target
or use one to change the calculated time. Probe stopping must be zero when
calculating. Streamline captures its prior value and clears it on Auto entry.

Skins own Auto-session transitions. Capture and persist the manual settings before
writing Off, keep them through reloads and failed writes, and restore them before
releasing Auto ownership. Suppress normal manual-setting reconciliation while
Auto owns the steam settings, including reconciliation already waiting on a read.
Never queue a failed calculation for later replay or claim success before the
workflow write succeeds. A lost response can leave the final state uncertain.
Separate calculation and application calls are not an atomic machine lock.

HTTP 422 carries `{code, message}` for configuration, scale readiness, invalid
milk mass, the supported timer range, non-idle machine or active probe stop. An unloaded plugin is rejected by Decaid with 404 before dispatch.
Handle unavailable plugins and API failures without applying a cached result. Requests for an unavailable pitcher return `pitcher_not_configured`.

## Source and maintenance

- Repository: [pponce/decentAutoSteamCalculator](https://github.com/pponce/decentAutoSteamCalculator).
- Editable source: `src/` and `manifest.src.json`.
- Installable, committed output: root `manifest.json` and `plugin.js`.
- Build: `npm run build` (no third-party dependencies or npm install needed).
- Tests: `npm test`.

Commit generated output with source changes. CI checks reproducibility and uploads
an installable ZIP artifact. Branch installation uses the committed root files;
GitHub release publishing is optional and requires a matching version tag plus
one ZIP asset. The manifest and package versions must match.

Keep `calibrated-steam.reaplugin` as the plugin ID so existing settings are retained
when updating inside the same Decaid installation. No native application changes
or fork-specific APK are required. The plugin is maintained independently of Decaid;
Decaid's maintainers do not own this repository or its release lifecycle.

A focused official Streamline contribution is maintained on the
`feature/upstream-auto-steam` branch of `pponce/streamline-js` while it is reviewed
upstream. Other skins can use the API documented here without copying the
calculations or calibration page.

## Runtime verification before release

The following optional developer smoke check runs from a Decaid checkout with
this standalone plugin installed. For tablet installation, follow the README.

Run the app with `scripts/sb-dev.sh start --connect-machine MockDe1` and confirm
`scripts/sb-dev.sh status` reports a connected mock machine. With the local API:

```sh
curl -sf -X POST http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/enable
curl -sf http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/status
curl -sf -X POST http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/settings \
  -H 'Content-Type: application/json' \
  -d '{"autoDetect":true,"smallPitcherGrams":150,"mediumPitcherGrams":220,"largePitcherGrams":300,"singleDrinkGrams":160,"singleDrinkPitcher":"small","weightMode":"gross","referenceMilkGrams":150,"referenceSeconds":25,"referenceFlow":1.5}'
curl -sf -X POST http://localhost:8080/api/v1/plugins/calibrated-steam.reaplugin/calculate \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"weightGrams":330,"ageMs":800},{"weightGrams":330,"ageMs":400},{"weightGrams":330,"ageMs":0}],"machineState":"idle","stopAtTemperature":0}'
```

The initial status must be unconfigured on a clean installation; after setting
the fixture calibration, calculation must return 180 g of milk and 30 seconds.
Compare `GET /api/v1/workflow` before and after: calculation must not change it.
An empty sample array or busy state must return 422. These supplied samples test
the HTTP contract only; they do not replace live-scale verification.

Reload with `scripts/sb-dev.sh reload`, confirm settings remain, and repeat.
Disable the plugin through its `/disable` endpoint and confirm `/calculate`
returns 404; restart and confirm it stays disabled. Inspect
`scripts/sb-dev.sh logs -n 30 --filter error`, then `scripts/sb-dev.sh stop`.

On the tablet, verify the 114 px mode label and four preset touch targets in
light/dark mode; heading and label cycling; the generic Settings > Extensions
plugin row and **Open** action before and after visiting a legacy settings page; enable/disable; gross/tared
weighing; repeated taps on the same pitcher; and persistence across reloads. Verify
entry and post-steam Off, automatic calibration-flow application, manual-setting
restoration and a deferred disable while steaming. A failed scale/calibration
check must leave Auto Off, and a failed write must not be reported as success.
Validate actual stopping temperature with a thermometer; simulated tests cannot
establish thermal accuracy or the length of a physical-start burst in Off.
