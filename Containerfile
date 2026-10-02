# The CWA demo inspector with its three assemblers in one image.
#
# The build context is not this repository alone: the assemblers are sibling checkouts (assemblers.json), so the
# context holds all four side by side, each under its own name, and the image keeps that layout under /opt/cwa so
# the relative paths in assemblers.json hold:
#
#   <context>/cwa-demo-app/          this repository
#   <context>/assembler-python/      ../assembler-python      Python, run through uv from its own .venv
#   <context>/assembler-typescript/  ../assembler-typescript  TypeScript, built here and linked by pnpm as locally
#   <context>/assembler-go/          ../assembler-go          Go, built into bin/cwa-adapter-go as `pnpm run setup` does
#
# deploy/stage-context.sh writes that context from the working trees (what git lists, nothing it ignores, never
# .env), and deploy/openshift/deploy.sh builds from it. By hand:
#
#   deploy/stage-context.sh /tmp/cwa-context
#   podman build -f /tmp/cwa-context/cwa-demo-app/Containerfile -t cwa-demo-app /tmp/cwa-context
#   podman run --rm -p 8787:8787 --env-file .env cwa-demo-app     # http://localhost:8787
#
# The inspector reads the provider settings .env.example lists from the environment (there is no .env in the image),
# and listens on every interface: it has no login, so the port is published on purpose.

# The Go adapter.
FROM docker.io/library/golang:1.26-alpine AS go
WORKDIR /src
COPY assembler-go/ .
RUN CGO_ENABLED=0 go build -mod=vendor -trimpath -o /out/cwa-adapter-go ./cmd/adapter

# Node, Python and uv: what both the build and the running inspector need. Debian trixie's python3 is 3.13, which
# both the Python assembler (>=3.11) and the producers (>=3.12) accept.
FROM docker.io/library/node:24-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /usr/local/bin/uv
ENV UV_PYTHON_PREFERENCE=only-system UV_LINK_MODE=copy

# Install and build everything under /opt/cwa, then hand the tree to the runtime stage.
FROM base AS build
WORKDIR /opt/cwa
COPY assembler-typescript/ assembler-typescript/
COPY assembler-python/ assembler-python/
COPY cwa-demo-app/ cwa-demo-app/
RUN npm install -g "pnpm@$(node -p "require('./cwa-demo-app/package.json').packageManager.split('@')[1]")"
# The TypeScript assembler: built with its dev dependencies, then pruned to what dist/ imports.
RUN cd assembler-typescript && pnpm install --frozen-lockfile && pnpm run build && pnpm prune --prod
# This app: its dependencies and the link to ../assembler-typescript, as `pnpm install` makes locally.
RUN cd cwa-demo-app && pnpm install --frozen-lockfile --prod
# The Python assembler and the producers, each in its own .venv from its lockfile; bytecode compiled now, since
# the running container may not write into the tree. PyStemmer, a producers' dependency, has no wheel for every
# platform and Python, so a compiler is here (in this stage only) to build it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc python3-dev \
  && rm -rf /var/lib/apt/lists/*
RUN uv sync --frozen --no-dev --compile-bytecode --project assembler-python \
  && uv sync --frozen --no-dev --compile-bytecode --directory cwa-demo-app/producers \
  && assembler-python/.venv/bin/python -m compileall -q assembler-python/src \
  && cwa-demo-app/producers/.venv/bin/python -m compileall -q cwa-demo-app/producers/producers
COPY --from=go /out/cwa-adapter-go cwa-demo-app/bin/cwa-adapter-go
# OpenShift runs the container as an arbitrary user in the root group: give the group the owner's rights, so the
# tree is readable and the run store (scenarios/advanced/runs) is writable.
RUN chmod -R g=u /opt/cwa

FROM base
ARG REVISIONS=""
LABEL org.opencontainers.image.title="cwa-demo-app" \
      org.opencontainers.image.description="The CWA support-assistant demo: the inspector with the Python, TypeScript and Go assemblers" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.contextwindowarchitecture.revisions="$REVISIONS"
COPY --from=build /opt/cwa /opt/cwa
WORKDIR /opt/cwa/cwa-demo-app
# uv runs the adapter and the producers from the environments built above: no sync, no network, no cache to keep.
ENV HOME=/tmp UV_NO_SYNC=1 UV_FROZEN=1 UV_OFFLINE=1 UV_CACHE_DIR=/tmp/uv-cache PORT=8787
EXPOSE 8787
USER 1001
CMD ["node", "src/inspector/server.mjs", "--host", "0.0.0.0"]
