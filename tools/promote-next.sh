#!/bin/bash
# Promote the /next/ preview (branch feat/midi) to the root app, or roll that back. Run in the main checkout.
#   bash tools/promote-next.sh promote    merge feat/midi into main, tag posthuman-v0.5.0, move the root baseline, push
#   bash tools/promote-next.sh rollback   revert that merge (root back to what it was), tag posthuman-v0.5.0-rollback, push
# Run the gates (tools/e2e.mjs, e2e-kodama.mjs, e2e-midi.mjs, soak.mjs, leak-check.mjs) before pushing if time allows.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "not on main"; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "uncommitted changes: commit or set them aside first"; exit 1; }
git pull --ff-only origin main
case "${1:-}" in
  promote)
    git merge --no-ff --no-edit -m "release(posthuman): promote /next/ (MIDI) to the root" feat/midi
    git tag posthuman-v0.5.0
    node tools/root-hash.mjs --set posthuman-v0.5.0
    git commit -qm "chore(posthuman): root baseline posthuman-v0.5.0" tools/root-baseline.json
    git push origin main posthuman-v0.5.0
    echo "promoted: / is now v0.5.0 (MIDI). /next/ stays as it was." ;;
  rollback)
    m=$(git rev-list -n 1 posthuman-v0.5.0)
    git revert --no-edit -m 1 "$m"
    git tag posthuman-v0.5.0-rollback
    node tools/root-hash.mjs --set posthuman-v0.5.0-rollback
    git commit -qm "chore(posthuman): root baseline after rollback" tools/root-baseline.json
    git push origin main posthuman-v0.5.0-rollback
    echo "rolled back: / is the pre-promote app again." ;;
  *) echo "usage: bash tools/promote-next.sh promote|rollback"; exit 1 ;;
esac
