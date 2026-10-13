#!/usr/bin/env bash
set -euo pipefail

if ! [[ "$VERSION" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "::error::Version must be vMAJOR.MINOR.PATCH with no leading zeroes. Select a new unused version."
  exit 1
fi
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
test -s dist/index.js
gh auth setup-git
existing=$(git ls-remote --tags origin "refs/tags/$VERSION")
if [ -n "$existing" ]; then
  echo "::error::Tag $VERSION already exists. Complete interrupted publication explicitly; never replace a version."
  exit 1
fi
git config user.name 'github-actions[bot]'
git config user.email 'github-actions[bot]@users.noreply.github.com'
git add -f dist/
git commit -m "Release $VERSION from $SOURCE_SHA"
RELEASE_SHA=$(git rev-parse HEAD)
git tag -a "$VERSION" -m "Release $VERSION from source $SOURCE_SHA"
git push --atomic origin "refs/tags/$VERSION:refs/tags/$VERSION"
# shellcheck disable=SC2016
printf 'Source commit: `%s`\nRelease commit: `%s`\n\nBuilt and tested with Node.js 24. The tagged tree includes `action.yml` and `dist/`; its first parent is the source commit.\n' \
  "$SOURCE_SHA" "$RELEASE_SHA" > "$RUNNER_TEMP/release-notes.md"
gh release create "$VERSION" --verify-tag --draft --title "$VERSION" \
  --notes-file "$RUNNER_TEMP/release-notes.md"
gh release edit "$VERSION" --draft=false
test "$(gh api "repos/$GH_REPO/releases/tags/$VERSION" --jq '.immutable')" = true
