#!/usr/bin/env node
// The OpenShift objects for the inspector, rendered from parameters so a cluster's conventions fit without editing
// a manifest. deploy.sh runs it with its environment: `IMAGE=… node deploy/openshift/manifests.mjs | oc apply -f -`.
//
//   IMAGE          the image reference; deploy.sh sets it                                 required
//   ROUTE_HOST     the Route's hostname                                                    default: the router generates one
//   ROUTE_PATH     the Route's path, such as /cwa: the router strips it before the
//                  inspector sees the request and the pages are relative to their own
//                  URLs, so the inspector is then at https://<host>/cwa/                   default: none, the host's root
//   ROUTE_TIMEOUT  the router's timeout for one request; an agent run takes minutes        default: 10m
//   STORAGE_SIZE   a PersistentVolumeClaim of this size for the live agent runs, which
//                  otherwise last as long as the pod                                      default: no claim
//   STORAGE_CLASS  the claim's storage class; on its own it asks for a claim of 1Gi        default: the cluster's default class
//
// The Secret cwa-demo-env (the .env variables) is deploy.sh's, never rendered here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'cwa-demo-app';
const PORT = 8787;
const LABELS = { app: NAME };
/** The run store in the image (src/agent/store.mjs): where a claim is mounted, and where the reference runs are. */
const RUNS = '/opt/cwa/cwa-demo-app/scenarios/advanced/runs';

export function manifests({ image, routeHost = '', routePath = '', routeTimeout = '10m', storageSize = '', storageClass = '' } = {}) {
  if (!image) throw new Error('IMAGE is required: the image reference to deploy');
  if (routePath && !/^\/.*[^/]$/.test(routePath)) throw new Error(`ROUTE_PATH ${routePath} must start with a slash and not end with one, like /cwa`);
  const storage = storageSize || storageClass ? { size: storageSize || '1Gi', className: storageClass } : null;

  const container = {
    name: 'inspector',
    image,
    // A rebuilt -dirty tag keeps its name: pull it every time.
    imagePullPolicy: 'Always',
    ports: [{ containerPort: PORT }],
    env: [{ name: 'PORT', value: String(PORT) }],
    envFrom: [{ secretRef: { name: 'cwa-demo-env' } }],
    // The landing page is a static file: the probes run no assembler and ask no model.
    readinessProbe: { httpGet: { path: '/', port: PORT }, initialDelaySeconds: 3, periodSeconds: 5 },
    livenessProbe: { httpGet: { path: '/', port: PORT }, initialDelaySeconds: 10, periodSeconds: 20 },
    // An assembly runs the three adapters at once; a live producer run imports LlamaIndex.
    resources: { requests: { cpu: '250m', memory: '512Mi' }, limits: { cpu: '2', memory: '2Gi' } },
    ...(storage ? { volumeMounts: [{ name: 'runs', mountPath: RUNS }] } : {}),
  };
  const pod = {
    ...(storage ? {
      // The claim is mounted over the run store, which hides the reference runs the image carries: copy them in at
      // every start, fresh from the image, and leave the live runs alone.
      initContainers: [{
        name: 'reference-runs',
        image,
        command: ['sh', '-c', `cd ${RUNS} && for d in reference-*; do rm -rf "/runs/$d" && cp -R "$d" /runs/; done`],
        volumeMounts: [{ name: 'runs', mountPath: '/runs' }],
      }],
    } : {}),
    containers: [container],
    ...(storage ? { volumes: [{ name: 'runs', persistentVolumeClaim: { claimName: `${NAME}-runs` } }] } : {}),
  };

  const items = [];
  if (storage) {
    items.push({
      apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: `${NAME}-runs`, labels: LABELS },
      spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: storage.size } }, ...(storage.className ? { storageClassName: storage.className } : {}) },
    });
  }
  items.push({
    apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: NAME, labels: LABELS },
    spec: {
      // One replica: the live runs are recorded on one disk and listed from it. Recreate: with a claim, the old pod
      // releases it before the new one mounts it.
      replicas: 1,
      strategy: { type: 'Recreate' },
      selector: { matchLabels: LABELS },
      template: { metadata: { labels: LABELS }, spec: pod },
    },
  });
  items.push({
    apiVersion: 'v1', kind: 'Service', metadata: { name: NAME, labels: LABELS },
    spec: { selector: LABELS, ports: [{ name: 'http', port: PORT, targetPort: PORT }] },
  });
  items.push({
    apiVersion: 'route.openshift.io/v1', kind: 'Route',
    metadata: {
      name: NAME, labels: LABELS,
      annotations: {
        'haproxy.router.openshift.io/timeout': routeTimeout,
        ...(routePath ? { 'haproxy.router.openshift.io/rewrite-target': '/' } : {}),
      },
    },
    spec: {
      ...(routeHost ? { host: routeHost } : {}),
      ...(routePath ? { path: routePath } : {}),
      to: { kind: 'Service', name: NAME },
      port: { targetPort: 'http' },
      tls: { termination: 'edge', insecureEdgeTerminationPolicy: 'Redirect' },
    },
  });
  return { apiVersion: 'v1', kind: 'List', items };
}

/** The parameters as the environment names them; an empty variable is an absent one. */
export const fromEnv = (env = process.env) => manifests({
  image: env.IMAGE, routeHost: env.ROUTE_HOST, routePath: env.ROUTE_PATH, routeTimeout: env.ROUTE_TIMEOUT || undefined,
  storageSize: env.STORAGE_SIZE, storageClass: env.STORAGE_CLASS,
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(fromEnv(), null, 2) + '\n'); }
  catch (error) { console.error(`manifests: ${error.message}`); process.exit(1); }
}
