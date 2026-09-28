#!/usr/bin/env bash
# Re-sync packages/gpc-fhir from a local checkout of GP-Connect-Demo.
# Usage: scripts/sync-gpc-fhir.sh /path/to/GP-Connect-Demo
# Copies only the files listed in packages/gpc-fhir/PROVENANCE.md, then shows
# the diff so it can be reviewed before committing. Update the commit hash in
# PROVENANCE.md after syncing.
set -euo pipefail

src="${1:?path to GP-Connect-Demo checkout required}"
dest="$(cd "$(dirname "$0")/.." && pwd)/packages/gpc-fhir"

for f in "$src"/src/fhir/*.ts; do
  case "$(basename "$f")" in
    snomedLookup.ts|snomedDegrade.ts) ;;
    *) cp "$f" "$dest/src/fhir/" ;;
  esac
done
cp "$src"/src/builder/{types,idMap,sampleData}.ts "$dest/src/builder/"
cp "$src"/src/builder/generate/*.ts "$dest/src/builder/generate/"
cp "$src"/public/gpc-sample-bundle.json "$src"/src/sample-data/*.json "$dest/fixtures/"

echo "Upstream commit: $(git -C "$src" rev-parse HEAD)"
git -C "$dest" status --short -- .
