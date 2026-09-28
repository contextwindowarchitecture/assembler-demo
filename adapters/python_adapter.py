#!/usr/bin/env python3
"""Adapter from the Python reference assembler to the harness protocol (PORTING.md, the adapter protocol).

Snapshot bytes on stdin. Exit 0 with {"payload": base64 or null, "trace": {...}} on stdout when assembled or refused;
exit 2 when the snapshot is rejected before assembly (the problems on stderr); exit 3 when it names a tokenizer or
renderer this assembler does not provide. Run it with the assembler's environment:

    uv run --quiet --project ../cwa-assembler python adapters/python_adapter.py < snapshot.json
"""
import base64
import json
import sys

from cwa import Snapshot, SnapshotError, assemble
from cwa.render import REGISTRY as RENDERERS
from cwa.tokenize import REGISTRY as TOKENIZERS


def main() -> int:
    raw = sys.stdin.buffer.read()
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        print(f"not a JSON document: {error}", file=sys.stderr)
        return 2
    # The conformance runner skips, rather than judges, a case whose tokenizer or renderer is not provided.
    for field, registry in (("tokenizer", TOKENIZERS), ("renderer", RENDERERS)):
        value = document.get(field) if isinstance(document, dict) else None
        if isinstance(value, str) and value not in registry:
            print(f"{field} {value} is not provided", file=sys.stderr)
            return 3
    try:
        result = assemble(Snapshot.from_json(document))
    except SnapshotError as error:
        print("; ".join(error.problems), file=sys.stderr)
        return 2
    payload = base64.b64encode(result.payload).decode("ascii") if result.payload is not None else None
    sys.stdout.write(json.dumps({"payload": payload, "trace": result.trace}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
