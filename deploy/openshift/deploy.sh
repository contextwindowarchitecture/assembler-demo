#!/usr/bin/env bash
# Deploy the CWA demo inspector to the current oc project.
#
# The image holds this repository and the three assembler checkouts assemblers.json names (see the Containerfile),
# so the build context is staged first by deploy/stage-context.sh: the four working trees as git lists them,
# nothing ignored, never .env.
#
# Two ways to get an image:
#   1. In-cluster build (default): needs the cluster's Build capability (the `builder` service account exists).
#        deploy/openshift/deploy.sh
#   2. Local build with podman, pushed to a registry you can reach (works on every cluster):
#        IMAGE=quay.io/<you>/cwa-demo-app deploy/openshift/deploy.sh
#      Set PLATFORM (default linux/amd64) to match the cluster's nodes. Run `podman login` to the registry first;
#      if the repository is private the script creates a pull secret from podman's auth file.
#
# Every image is tagged with this repository's git short SHA, plus -dirty when any of the four working trees has
# uncommitted changes, so each deploy points the Deployment at a new image reference; the pull policy is Always, so
# a rebuilt -dirty tag is pulled again. `latest` is updated as well for convenience. A tag on IMAGE is ignored; TAG
# overrides the computed one. The four revisions are recorded in the image's labels.
#
# Providers: the inspector in the cluster reads the variables .env.example lists from the Secret cwa-demo-env. When
# .env exists here it is applied on every deploy (what the file says is what runs, as locally); without one the
# Secret is created empty once and left alone, so `oc edit secret cwa-demo-env` holds. A model URL must be
# reachable from the cluster: a server on this machine's localhost is not.
set -euo pipefail
cd "$(dirname "$0")/../.."
PROJECT=$(oc project -q)
PLATFORM=${PLATFORM:-linux/amd64}

CONTEXT=$(mktemp -d "${TMPDIR:-/tmp}/cwa-context.XXXXXX")
trap 'rm -rf "$CONTEXT"' EXIT
REVISIONS=$(deploy/stage-context.sh "$CONTEXT" | tr '\n' ' ')
REVISIONS=${REVISIONS% }
if [ -z "${TAG:-}" ]; then
  TAG=$(git rev-parse --short HEAD)
  case "$REVISIONS" in *-dirty*) TAG="$TAG-dirty" ;; esac
fi
echo "project: $PROJECT"
echo "tag: $TAG"
echo "revisions: $REVISIONS"

# The Secret is .env, read by the parser the inspector uses and applied whole, so a key removed from .env leaves
# the Secret too. Only the keys are printed, never a value.
if [ -f .env ]; then
  node -e '
    const { parseEnv } = require("node:util");
    const { readFileSync } = require("node:fs");
    const values = parseEnv(readFileSync(".env", "utf8"));
    const data = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(value).toString("base64")]));
    process.stdout.write(JSON.stringify({ apiVersion: "v1", kind: "Secret", metadata: { name: "cwa-demo-env" }, type: "Opaque", data }));
    console.error(`secret cwa-demo-env from .env: ${Object.keys(data).join(", ") || "(no variables)"}`);
  ' | oc apply -f -
elif ! oc get secret cwa-demo-env >/dev/null 2>&1; then
  oc create secret generic cwa-demo-env
  echo "created secret cwa-demo-env empty: no .env here, so no provider is configured (edit the Secret, or add .env and redeploy)"
fi

if [ -n "${IMAGE:-}" ]; then
  # IMAGE names the repository; strip any tag the caller left on it.
  REPO=${IMAGE%%@*}
  case "${REPO##*/}" in *:*) REPO=${REPO%:*} ;; esac
  IMAGE="$REPO:$TAG"
  echo "building $IMAGE for $PLATFORM with podman"
  podman build --platform "$PLATFORM" --build-arg "REVISIONS=$REVISIONS" \
    -f "$CONTEXT/cwa-demo-app/Containerfile" -t "$IMAGE" -t "$REPO:latest" "$CONTEXT"
  podman push "$IMAGE"
  podman push "$REPO:latest"
  # Private repository? Give the pod podman's credentials for it.
  AUTH=${REGISTRY_AUTH_FILE:-${XDG_RUNTIME_DIR:-$HOME/.config}/containers/auth.json}
  [ -f "$AUTH" ] || AUTH="$HOME/.config/containers/auth.json"
  if [ -f "$AUTH" ]; then
    oc create secret generic cwa-demo-pull --from-file=.dockerconfigjson="$AUTH" \
      --type=kubernetes.io/dockerconfigjson --dry-run=client -o yaml | oc apply -f -
    oc secrets link default cwa-demo-pull --for=pull
  fi
else
  # Binary build: streams the staged context to the cluster and builds the Containerfile there. The BuildConfig
  # writes cwa-demo-app:latest; the result is then tagged with the SHA for the Deployment.
  oc apply -f deploy/openshift/build.yaml
  oc start-build cwa-demo-app --from-dir="$CONTEXT" --build-arg "REVISIONS=$REVISIONS" --follow
  oc tag "cwa-demo-app:latest" "cwa-demo-app:$TAG"
  IMAGE="image-registry.openshift-image-registry.svc:5000/$PROJECT/cwa-demo-app:$TAG"
fi

sed "s#IMAGE_PLACEHOLDER#$IMAGE#" deploy/openshift/app.yaml | oc apply -f -

# Roll even when the image reference did not change (a rebuilt -dirty tag, a changed Secret).
oc rollout restart deployment/cwa-demo-app
oc rollout status deployment/cwa-demo-app --timeout=300s

ROUTE=$(oc get route cwa-demo-app -o jsonpath='{.spec.host}')
echo
echo "inspector    : https://$ROUTE/"
echo "basic        : https://$ROUTE/basic/"
echo "intermediate : https://$ROUTE/intermediate/"
echo "advanced     : https://$ROUTE/advanced/"
