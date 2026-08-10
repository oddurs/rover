#!/usr/bin/env bash
#
# Build the static export and publish it to the gh-pages branch.
#
# The site is served from a subdirectory (oddurs.github.io/rover/), so the base
# path has to be baked in at build time — it ends up in both Next's own asset
# URLs and, via lib/assets.ts, the fetches for the terrain and rover meshes.
#
#   ./tools/deploy.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-/rover}"
REMOTE="$(git remote get-url origin)"

echo "building with basePath=${BASE_PATH}"
rm -rf out
NEXT_PUBLIC_BASE_PATH="$BASE_PATH" pnpm exec next build

# Pages runs Jekyll by default, which drops any directory starting with an
# underscore — which is where Next puts its entire bundle.
touch out/.nojekyll

# Publish the built directory as an orphan branch, so gh-pages holds only the
# site and never the source history.
cd out
rm -rf .git
git init -q
git checkout -q -B gh-pages
git add -A
git commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q -f "$REMOTE" gh-pages

echo "published to gh-pages"
