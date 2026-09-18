# Release procedure

This repository uses two installable GitHub branches:

- `main` is the stable channel.
- `beta` is the opt-in beta channel.

Decaid records the branch a user installed. The calculator's normal update check follows that recorded branch. Because of that, a user enrolled in beta will not see a newer stable build on `main` unless `beta` is also advanced to the stable release.

## Versioning

- Stable versions use `X.Y.Z`, for example `0.13.3`.
- Beta versions use `X.Y.Z-beta.N`, for example `0.13.4-beta.1`.
- Keep `package.json`, `manifest.src.json`, generated `manifest.json`, and generated `plugin.js` on the same version.
- Edit source files and `manifest.src.json`, then regenerate committed outputs with `npm run build`.
- Do not start the next beta series until the prior stable release has passed CI and `beta` has been advanced to that exact stable commit.

## Beta development

1. Start beta work from the current shared stable commit.
2. Make changes on `beta`.
3. Use prerelease versions and increment the beta number for each published beta.
4. Run the full test suite and confirm GitHub Actions is green.
5. User-test the beta before promotion.
6. Keep updater behavior branch-based unless there is an explicit reason to redesign it.

## Promote beta to stable

1. Promote the tested beta work to `main`.
2. Change the version from `X.Y.Z-beta.N` to `X.Y.Z`.
3. Update release notes / README text so the promoted features are described as stable rather than beta.
4. Regenerate `manifest.json` and `plugin.js`.
5. Push `main`.
6. Wait for the `main` GitHub Actions run to finish.
7. Confirm all release checks are green:
   - tests,
   - generated-file consistency,
   - packaging,
   - artifact upload.
8. Only after stable CI is green, fast-forward `beta` to the exact same stable commit on `main`.

That final step is required. It keeps beta subscribers enrolled on the beta branch while allowing them to receive the newly released stable version through their normal updater.

## After promotion

- `main` and `beta` should point to the same stable commit immediately after a release.
- The next beta series starts from that shared commit.
- Example: after `0.13.3` is green, both branches point to `0.13.3`; the next beta becomes `0.13.4-beta.1`.
- Never move `beta` backward to an older version.
- If new beta-only work has already been added after the stable candidate, do not overwrite it. First reconcile the branch history so the stable commit is retained and no beta work is lost.

## Stable hotfixes and documentation releases

The same rule applies to a stable-only fix or documentation release:

1. Push the stable change to `main`.
2. Wait for green CI.
3. Advance `beta` to the same commit before beginning more beta work.

This prevents beta subscribers from becoming stranded on an older prerelease branch tip.

## Release safety notes

- Do not call a release green until the current GitHub Actions run has actually completed successfully.
- If CI fails, inspect the specific failing test rather than weakening unrelated coverage.
- Keep generated root files reproducible from source.
- Preserve saved calibration data semantics and the plugin ID.
- Do not remove/reinstall the plugin merely to change release channels; use the built-in channel switch so saved settings are preserved.
- GitHub tags/releases are optional for branch-installed plugin updates; the installable branch state and manifest version are what Decaid follows.
