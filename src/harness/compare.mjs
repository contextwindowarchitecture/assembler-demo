// The comparison conformance/README.md (Running a case) defines, applied to any assembler's result: payload bytes
// byte for byte, traces field for field without trace_id and timings (R-23), and the JSON pointer of the first
// difference. Nothing here normalizes an assembler's output; a difference is a finding.

/** Trace fields that may differ between runs of the same snapshot (R-23). Everything else is compared. */
export const IGNORED = ['trace_id', 'timings'];

export function comparable(trace) {
  const out = {};
  for (const key of Object.keys(trace)) if (!IGNORED.includes(key)) out[key] = trace[key];
  return out;
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The JSON pointer of the first place two documents differ, or null. Keys are visited in UTF-16 code unit order,
 * which is JavaScript's default string order (conformance/README.md, Ordering). */
export function firstDifference(actual, expected, path = '') {
  if (isObject(actual) && isObject(expected)) {
    for (const key of [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()) {
      if (!(key in actual) || !(key in expected)) return `${path}/${key}`;
      const found = firstDifference(actual[key], expected[key], `${path}/${key}`);
      if (found) return found;
    }
    return null;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    const shared = Math.min(actual.length, expected.length);
    for (let index = 0; index < shared; index++) {
      const found = firstDifference(actual[index], expected[index], `${path}/${index}`);
      if (found) return found;
    }
    return actual.length === expected.length ? null : `${path}/${shared}`;
  }
  return actual === expected ? null : path || '/';
}

const sameBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/**
 * Judge one adapter result against an expectation. For a case, `expected` is `{payload: Buffer | null, trace}`; for a
 * rejection snapshot it is `{rejection: true}`. Returns `{outcome, detail?}` with outcome `passed`, `rejected`, `failed`
 * or `skipped`, worded as the reference runner words them (conformance/README.md, Reporting results).
 */
export function compareResult(result, expected) {
  if (result.outcome === 'unsupported') return { outcome: 'skipped', detail: result.detail };
  if (result.outcome === 'error') return { outcome: 'failed', detail: result.detail };
  if (expected.rejection) {
    if (result.outcome === 'rejected') return { outcome: 'rejected' };
    const did = result.outcome === 'assembled' ? 'assembled a payload' : `refused with ${result.trace.refused.reason}`;
    return { outcome: 'failed', detail: `${did} instead of rejecting the snapshot` };
  }
  if (result.outcome === 'rejected') return { outcome: 'failed', detail: `snapshot rejected: ${result.detail}` };
  const refused = result.payload === null, wanted = expected.payload === null;
  if (refused !== wanted) return { outcome: 'failed', detail: refused ? 'refused, but a payload was expected' : 'a payload, but a refusal was expected' };
  if (!refused && !sameBytes(result.payload, expected.payload)) return { outcome: 'failed', detail: 'payload bytes differ' };
  const where = firstDifference(comparable(result.trace), comparable(expected.trace));
  if (where) return { outcome: 'failed', detail: `trace differs at ${where}` };
  return { outcome: 'passed' };
}

const JUDGED = ['assembled', 'refused', 'rejected'];

/** Do several assemblers agree on one snapshot? The first judged result is the reference; every other judged result
 * is compared with it. Unsupported results take no part. Three agreeing assemblers can still share a mistake, which
 * is why expectations exist beside this. */
export function agreement(results) {
  const reference = results.find(result => JUDGED.includes(result.outcome));
  if (!reference) return { agree: true, differences: [] };
  const expected = reference.outcome === 'rejected' ? { rejection: true } : { payload: reference.payload, trace: reference.trace };
  const differences = [];
  for (const result of results) {
    if (result === reference || result.outcome === 'unsupported') continue;
    const judged = compareResult(result, expected);
    if (judged.outcome === 'failed') differences.push({ assembler: result.assembler, against: reference.assembler, detail: judged.detail });
  }
  return { agree: differences.length === 0, differences };
}
