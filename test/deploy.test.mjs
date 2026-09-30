// The container image: the Containerfile expects a build context that holds this repository and the assembler
// checkouts assemblers.json names, side by side, each under its own name, and deploy/stage-context.sh writes that
// context from the working trees: exactly the files git lists (tracked and untracked, nothing ignored), so no
// node_modules, no .venv, no built adapter, and never .env.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fromEnv, manifests } from '../deploy/openshift/manifests.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(path.join(ROOT, 'assemblers.json'), 'utf8'));
const checkouts = Object.entries(config).filter(([id]) => !id.startsWith('$')).map(([, entry]) => entry.checkout);
const trees = [['cwa-demo-app', ROOT], ...checkouts.map(c => [path.basename(c), path.resolve(ROOT, c)])];
const allPresent = trees.every(([, dir]) => existsSync(path.join(dir, '.git')));

test('the Containerfile copies this repository and every checkout assemblers.json names, each under its own name', () => {
  const file = readFileSync(path.join(ROOT, 'Containerfile'), 'utf8');
  const copied = [...file.matchAll(/^COPY (?!--from)([^/\s]+)\//gm)].map(m => m[1]);
  assert.deepEqual([...new Set(copied)].sort(), trees.map(([name]) => name).sort());
});

test(
  'stage-context.sh writes the four working trees side by side: what git lists, nothing it ignores, never .env',
  { skip: allPresent ? false : 'a checkout is missing or is not a git checkout' },
  () => {
    const context = mkdtempSync(path.join(tmpdir(), 'cwa-context-'));
    try {
      const report = execFileSync('bash', [path.join(ROOT, 'deploy', 'stage-context.sh'), context], { encoding: 'utf8' });
      for (const [name, dir] of trees) {
        assert.match(report, new RegExp(`^${name}=[0-9a-f]{7,}(-dirty)?$`, 'm'), `the report names ${name} with its revision`);
        const listed = execFileSync('git', ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
          .split('\0').filter(file => file && existsSync(path.join(dir, file)));
        const staged = readdirSync(path.join(context, name), { recursive: true, withFileTypes: true })
          .filter(entry => !entry.isDirectory())
          .map(entry => path.relative(path.join(context, name), path.join(entry.parentPath, entry.name)));
        assert.deepEqual(staged.sort(), listed.sort(), `${name} is staged as git lists it`);
      }
      assert.ok(existsSync(path.join(context, 'cwa-demo-app', 'Containerfile')));
      for (const ignored of ['.env', 'node_modules', 'bin', 'producers/.venv']) {
        assert.ok(!existsSync(path.join(context, 'cwa-demo-app', ignored)), `${ignored} is not staged`);
      }
    } finally {
      rmSync(context, { recursive: true, force: true });
    }
  },
);

const read = file => readFileSync(path.join(ROOT, file), 'utf8');
const byKind = list => Object.fromEntries(list.items.map(object => [object.kind, object]));

test('the OpenShift objects are rendered from parameters: the image, the Route host and path, the storage class and size', () => {
  const exposed = read('Containerfile').match(/^EXPOSE (\d+)$/m)[1];
  assert.throws(() => manifests({}), /IMAGE/, 'the image is required');

  const plain = byKind(manifests({ image: 'quay.io/x/cwa-demo-app:abc' }));
  assert.deepEqual(Object.keys(plain).sort(), ['Deployment', 'Route', 'Service'], 'no claim unless storage is asked for');
  const pod = plain.Deployment.spec.template.spec;
  const [container] = pod.containers;
  assert.equal(container.image, 'quay.io/x/cwa-demo-app:abc');
  assert.equal(String(container.ports[0].containerPort), exposed, 'the container port is the one the image exposes');
  assert.deepEqual(container.env, [{ name: 'PORT', value: exposed }]);
  for (const probe of [container.readinessProbe, container.livenessProbe]) assert.deepEqual(probe.httpGet, { path: '/', port: Number(exposed) }, 'probes hit the static landing page');
  assert.equal(String(plain.Service.spec.ports[0].targetPort), exposed);
  assert.equal(container.envFrom[0].secretRef.name, 'cwa-demo-env');
  assert.match(read('deploy/openshift/deploy.sh'), /cwa-demo-env/, 'deploy.sh creates the Secret the Deployment reads');
  assert.equal(plain.Deployment.spec.replicas, 1);
  assert.equal(pod.initContainers, undefined);
  assert.equal(pod.volumes, undefined);
  assert.equal(container.volumeMounts, undefined);

  // The Route: the router's hostname and no path unless given; a path is stripped by the router (the pages are relative).
  assert.equal(plain.Route.spec.host, undefined);
  assert.equal(plain.Route.spec.path, undefined);
  assert.equal(plain.Route.metadata.annotations['haproxy.router.openshift.io/timeout'], '10m');
  assert.equal(plain.Route.metadata.annotations['haproxy.router.openshift.io/rewrite-target'], undefined);
  assert.deepEqual(plain.Route.spec.tls, { termination: 'edge', insecureEdgeTerminationPolicy: 'Redirect' });
  const routed = byKind(manifests({ image: 'i', routeHost: 'demo.apps.example.com', routePath: '/cwa', routeTimeout: '30m' })).Route;
  assert.equal(routed.spec.host, 'demo.apps.example.com');
  assert.equal(routed.spec.path, '/cwa');
  assert.equal(routed.metadata.annotations['haproxy.router.openshift.io/rewrite-target'], '/', 'the prefix is stripped before the inspector sees the request');
  assert.equal(routed.metadata.annotations['haproxy.router.openshift.io/timeout'], '30m');
  assert.throws(() => manifests({ image: 'i', routePath: 'cwa' }), /ROUTE_PATH/, 'a path starts with a slash');
  assert.throws(() => manifests({ image: 'i', routePath: '/cwa/' }), /ROUTE_PATH/, 'and does not end with one');

  // Storage: a claim for the live runs when a size or a class is given, the cluster's default class unless one is
  // named, mounted over the run store, and the reference runs copied in from the image by an init container.
  const stored = byKind(manifests({ image: 'quay.io/x/cwa-demo-app:abc', storageSize: '5Gi' }));
  assert.equal(stored.PersistentVolumeClaim.spec.resources.requests.storage, '5Gi');
  assert.equal(stored.PersistentVolumeClaim.spec.storageClassName, undefined, 'no class named: the field is absent, not empty');
  assert.deepEqual(stored.PersistentVolumeClaim.spec.accessModes, ['ReadWriteOnce']);
  assert.equal(stored.Deployment.spec.strategy.type, 'Recreate', 'one writer: the old pod releases the claim before the new one mounts it');
  const storedPod = stored.Deployment.spec.template.spec;
  assert.equal(storedPod.containers[0].volumeMounts.find(m => m.name === 'runs').mountPath, '/opt/cwa/cwa-demo-app/scenarios/advanced/runs');
  assert.equal(storedPod.volumes.find(v => v.name === 'runs').persistentVolumeClaim.claimName, stored.PersistentVolumeClaim.metadata.name);
  const [init] = storedPod.initContainers;
  assert.equal(init.image, 'quay.io/x/cwa-demo-app:abc');
  assert.match(init.command.join(' '), /reference-\*/, 'the init container copies the committed reference runs into the claim');
  assert.equal(init.volumeMounts.find(m => m.name === 'runs').mountPath, '/runs');
  const classed = byKind(manifests({ image: 'i', storageClass: 'gp3-csi' })).PersistentVolumeClaim;
  assert.deepEqual([classed.spec.storageClassName, classed.spec.resources.requests.storage], ['gp3-csi', '1Gi'], 'a class alone asks for the default size');
});

test('deploy.sh renders the objects from the environment, and the in-cluster build finds the Containerfile in the staged context', () => {
  for (const script of ['deploy/stage-context.sh', 'deploy/openshift/deploy.sh']) execFileSync('bash', ['-n', path.join(ROOT, script)]);
  assert.match(read('deploy/openshift/deploy.sh'), /node deploy\/openshift\/manifests\.mjs \| oc apply/);
  assert.match(read('deploy/openshift/build.yaml'), /dockerfilePath: cwa-demo-app\/Containerfile$/m);
  const rendered = byKind(fromEnv({ IMAGE: 'i', ROUTE_HOST: 'h.example.com', ROUTE_PATH: '/p', ROUTE_TIMEOUT: '2m', STORAGE_CLASS: 'c', STORAGE_SIZE: '2Gi' }));
  assert.deepEqual([rendered.Route.spec.host, rendered.Route.spec.path, rendered.Route.metadata.annotations['haproxy.router.openshift.io/timeout']], ['h.example.com', '/p', '2m']);
  assert.deepEqual([rendered.PersistentVolumeClaim.spec.storageClassName, rendered.PersistentVolumeClaim.spec.resources.requests.storage], ['c', '2Gi']);
  assert.equal(fromEnv({ IMAGE: 'i', ROUTE_HOST: '' }).items.find(o => o.kind === 'Route').spec.host, undefined, 'an empty variable is an absent one');
  const printed = JSON.parse(execFileSync('node', [path.join(ROOT, 'deploy', 'openshift', 'manifests.mjs')], { env: { ...process.env, IMAGE: 'printed' }, encoding: 'utf8' }));
  assert.equal(printed.kind, 'List');
  assert.equal(printed.items.find(o => o.kind === 'Deployment').spec.template.spec.containers[0].image, 'printed');
});
