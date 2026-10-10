# Release procedure

Stable users should install through **GitHub Release**. The repository also keeps
two installable GitHub branches:

- `main` is the stable channel.
- `beta` is the opt-in beta channel.

Decaid records whether a user installed a release or a branch. The calculator's
normal update check follows that recorded source. Release installs follow the latest
published stable release. Branch installs follow their recorded branch. A user
enrolled in beta receives a newer stable build through the normal updater only
after `beta` is also advanced to that stable commit.

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
6. Keep betas on the `beta` branch. Decaid currently accepts only `X.Y.Z` or
   `vX.Y.Z` release tags, so do not publish `-beta.N` GitHub Releases for installation.

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
   - artifact upload,
   - stable release publication with its attached ZIP.
8. Only after stable CI is green, fast-forward `beta` to the exact same stable commit on `main`.

That final step is required. It keeps beta subscribers enrolled on the beta branch while allowing them to receive the newly released stable version through their normal updater.

## Automatic stable publication

The `Test, package and release` workflow tests and packages pushes to `main` and
`beta`, plus pull requests. Its publish job runs only after successful tests on
`main`. It uses the tested ZIP artifact from that exact run.

1. Bump `package.json` and `manifest.src.json` to the new stable version.
2. Regenerate the root runtime files and optionally add `docs/releases/X.Y.Z.md`.
3. Push the stable commit to `main`; the workflow creates tag `vX.Y.Z` and a draft
   release, attaches `calibrated-steam.reaplugin.zip`, downloads it to verify the
   upload, then publishes it as the latest stable release.
4. Verify the release is public and contains exactly one ZIP. The ZIP must contain
   `manifest.json`, `plugin.js`, and `LICENSE.txt`, and the tag must match the manifest.
5. After the complete stable workflow succeeds, advance `beta` to that same commit.

No manual tag push or release upload is needed. Documentation-only pushes at an
already published version verify that the tagged runtime files are unchanged,
then leave the release intact. Changed runtime files require a new version. A
publication failure leaves the workflow red; if a draft was created, inspect it
and its package before completing or removing that draft and rerunning the job.
Do not overwrite an already published release asset.

The calculator supports both source kinds for Update and permission approval.
Join beta always installs the beta branch. Return to stable always installs the
latest published stable release, even for a user who originally installed a
branch. It is disabled while that release would be a downgrade. Existing main
branch installs stay on main unless the user changes channels.

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
- Stable GitHub Releases and their ZIP assets are required for release-installed users. Branch-installed users continue following the branch state; keep both distribution paths working.
