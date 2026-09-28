#!/bin/sh
# Builds the Go adapter into bin/ and checks that every adapter can run. Safe to rerun.
set -eu
cd "$(dirname "$0")/.."

status=0
if [ -d ../cwa-assembler-go ]; then
  echo "go: building ../cwa-assembler-go/cmd/adapter -> bin/cwa-adapter-go"
  mkdir -p bin
  (cd ../cwa-assembler-go && go build -o "$OLDPWD/bin/cwa-adapter-go" ./cmd/adapter)
else
  echo "go: ../cwa-assembler-go is not checked out; the Go assembler will be skipped" >&2
  status=1
fi

if [ -f node_modules/@contextwindowarchitecture/assembler/dist/index.js ]; then
  echo "typescript: linked ../cwa-assembler-ts (dist/ present)"
else
  echo "typescript: run 'npm install' here and 'npm run build' in ../cwa-assembler-ts; the TypeScript assembler will be skipped" >&2
  status=1
fi

if [ -f ../cwa-assembler/pyproject.toml ] && command -v uv >/dev/null 2>&1; then
  echo "python: ../cwa-assembler through uv"
  uv run --quiet --project ../cwa-assembler python -c "import cwa" || { echo "python: 'uv run' cannot import cwa" >&2; status=1; }
else
  echo "python: ../cwa-assembler with uv is needed; the Python assembler will be skipped" >&2
  status=1
fi

exit $status
