#!/usr/bin/env bash
set -euo pipefail

# Called only after the test/package job succeeds for the exact main commit.
test "${GITHUB_REF:?}" = refs/heads/main
version=$(node -p "JSON.parse(require('fs').readFileSync('manifest.json')).version")
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Only stable X.Y.Z versions may be published from main.' >&2
  exit 1
fi
tag="v$version"
archive=dist/calibrated-steam.reaplugin.zip
test -f "$archive"

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
unzip -q "$archive" -d "$staging"
for file in manifest.json plugin.js LICENSE.txt; do
  cmp "$file" "$staging/$file"
done
node -e "const fs = require('fs'); const m = JSON.parse(fs.readFileSync('manifest.json')); const p = JSON.parse(fs.readFileSync('package.json')); if (m.version !== p.version || m.id !== 'calibrated-steam.reaplugin') process.exit(1);"

# Documentation-only commits keep the existing release. Never replace a public
# release with different runtime files under the same version.
if gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag" > "$staging/release.json" 2> "$staging/release-error"; then
  node - "$staging/release.json" <<'NODE'
const fs = require('fs');
const release = JSON.parse(fs.readFileSync(process.argv[2]));
const zips = release.assets.filter(asset => asset.name.endsWith('.zip'));
if (release.draft || release.prerelease || zips.length !== 1 || zips[0].name !== 'calibrated-steam.reaplugin.zip') {
  throw new Error('Existing release is incomplete or incompatible; inspect it before retrying.');
}
NODE
  git fetch --depth=1 origin "refs/tags/$tag:refs/tags/$tag"
  git diff --exit-code "$tag" -- manifest.json plugin.js LICENSE.txt
  echo "$tag is already published with the same runtime files."
  exit 0
elif ! grep -q '(HTTP 404)' "$staging/release-error"; then
  cat "$staging/release-error" >&2
  exit 1
fi

# Refuse to publish against a pre-existing tag from a different commit.
tag_ref=$(git ls-remote --tags origin "refs/tags/$tag" "refs/tags/$tag^{}")
if [[ -n "$tag_ref" ]]; then
  git fetch --depth=1 origin "refs/tags/$tag:refs/tags/$tag"
  test "$(git rev-parse "$tag^{commit}")" = "$GITHUB_SHA"
fi

notes=(--generate-notes)
if [[ -f "docs/releases/$version.md" ]]; then
  notes=(--notes-file "docs/releases/$version.md")
fi

# Upload to a draft first so Decaid never sees a release without its ZIP.
gh release create "$tag" --repo "$GITHUB_REPOSITORY" \
  --target "$GITHUB_SHA" --title "Auto Steam Calculator $version" \
  --draft "${notes[@]}" "$archive"
mkdir "$staging/download"
gh release download "$tag" --repo "$GITHUB_REPOSITORY" \
  --pattern calibrated-steam.reaplugin.zip --dir "$staging/download"
cmp "$archive" "$staging/download/calibrated-steam.reaplugin.zip"
gh release edit "$tag" --repo "$GITHUB_REPOSITORY" --draft=false --latest
