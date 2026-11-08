#!/usr/bin/env bash
# Build the Magpie plugin from the current commit and push it to the `magpie-plugin`
# branch, which holds only the built package so Magpie can install it with
#   magpie plugin add github:mxymalay/doubao-translate2api#magpie-plugin
set -euo pipefail

REMOTE="${PUBLISH_REMOTE:-origin}"
BRANCH="${PUBLISH_BRANCH:-magpie-plugin}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Commit your changes first; the plugin is built from HEAD." >&2
  exit 1
fi
SHA="$(git rev-parse --short HEAD)"

npm test
npm run build:plugin:local
OUT="$ROOT/outputs/doubao-translate-local"

WORK="$(mktemp -d)"
trap 'git worktree remove --force "$WORK" >/dev/null 2>&1 || rm -rf "$WORK"' EXIT

git fetch "$REMOTE" "$BRANCH" 2>/dev/null || true
if git rev-parse --verify -q "$REMOTE/$BRANCH" >/dev/null; then
  git worktree add --detach "$WORK" "$REMOTE/$BRANCH"
else
  git worktree add --detach "$WORK"
  git -C "$WORK" checkout --orphan "tmp-$BRANCH-$$"
fi
git -C "$WORK" rm -rqf --ignore-unmatch .
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$OUT"/. "$WORK"/

git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "Plugin build unchanged; nothing to publish."
  exit 0
fi
git -C "$WORK" commit -qm "Build Magpie plugin from $SHA"
git -C "$WORK" push "$REMOTE" "HEAD:refs/heads/$BRANCH"
echo "Published $BRANCH from $SHA."
