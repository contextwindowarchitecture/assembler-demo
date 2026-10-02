#!/bin/sh
# Builds the Go adapter into bin/ and checks that every adapter can run. Safe to rerun.
set -eu
cd "$(dirname "$0")/.."

status=0
if [ -d ../assembler-go ]; then
  echo "go: building ../assembler-go/cmd/adapter -> bin/cwa-adapter-go"
  mkdir -p bin
  (cd ../assembler-go && go build -o "$OLDPWD/bin/cwa-adapter-go" ./cmd/adapter)
else
  echo "go: ../assembler-go is not checked out; the Go assembler will be skipped" >&2
  status=1
fi

if [ -f node_modules/@contextwindowarchitecture/assembler/dist/index.js ]; then
  echo "typescript: linked ../assembler-typescript (dist/ present)"
else
  echo "typescript: run 'pnpm install' here and 'npm run build' in ../assembler-typescript; the TypeScript assembler will be skipped" >&2
  status=1
fi

if [ -f ../assembler-python/pyproject.toml ] && command -v uv >/dev/null 2>&1; then
  echo "python: ../assembler-python through uv"
  uv run --quiet --project ../assembler-python python -c "import cwa" || { echo "python: 'uv run' cannot import cwa" >&2; status=1; }
else
  echo "python: ../assembler-python with uv is needed; the Python assembler will be skipped" >&2
  status=1
fi

exit $status
