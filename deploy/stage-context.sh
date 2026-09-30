#!/usr/bin/env bash
# Writes the container build context: this repository and the assembler checkouts assemblers.json names, side by
# side under the names the Containerfile expects (this repository as cwa-demo-app, each checkout under its own
# basename). Each tree is copied as git sees it: tracked and untracked files, nothing ignored, so no node_modules,
# no .venv, no built adapter, and never .env. Prints one `name=revision` line per tree (-dirty when the working
# tree has uncommitted changes); the image records them.
#
#   deploy/stage-context.sh /tmp/cwa-context
#   podman build -f /tmp/cwa-context/cwa-demo-app/Containerfile -t cwa-demo-app /tmp/cwa-context
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST=${1:?usage: deploy/stage-context.sh <directory>}
mkdir -p "$DEST"
DEST=$(cd "$DEST" && pwd)

# stage <checkout> <name>: the working tree's files as git lists them, into $DEST/<name>.
stage() {
  local checkout=$1 name=$2
  git -C "$checkout" rev-parse --show-toplevel >/dev/null 2>&1 || { echo "stage-context: $checkout is not a git checkout" >&2; exit 1; }
  rm -rf "${DEST:?}/${name:?}"
  mkdir -p "$DEST/$name"
  (cd "$checkout" && git ls-files -z --cached --others --exclude-standard \
    | while IFS= read -r -d '' file; do [ -e "$file" ] && printf '%s\0' "$file"; done \
    | tar --null -cf - -T -) | tar -xf - -C "$DEST/$name"
  local revision
  revision=$(git -C "$checkout" rev-parse --short HEAD)
  [ -z "$(git -C "$checkout" status --porcelain)" ] || revision="$revision-dirty"
  echo "$name=$revision"
}

stage "$ROOT" cwa-demo-app
for checkout in $(node -e 'for (const [id, entry] of Object.entries(require(process.argv[1]))) if (!id.startsWith("$")) console.log(entry.checkout)' "$ROOT/assemblers.json"); do
  stage "$ROOT/$checkout" "$(basename "$checkout")"
done
