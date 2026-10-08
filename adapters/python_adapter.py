#!/usr/bin/env python3
"""Adapter from the Python reference assembler to the harness protocol (PORTING.md, the adapter protocol).

Snapshot bytes on stdin. Exit 0 with {"payload": base64 or null, "trace": {...}} on stdout when assembled or refused;
exit 2 when the snapshot is rejected before assembly (the problems on stderr); exit 3 when an otherwise valid snapshot
names a tokenizer or renderer this assembler does not provide. Run it with the assembler's environment:

    uv run --quiet --project ../assembler-python python adapters/python_adapter.py < snapshot.json
"""
import base64
import json
import sys

from cwa import Snapshot, SnapshotError, UnsupportedComponentError, assemble


def main() -> int:
    raw = sys.stdin.buffer.read()
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        print(f"not a JSON document: {error}", file=sys.stderr)
        return 2
    # Snapshot.from_json validates first and resolves the tokenizer and renderer after (conformance/README.md,
    # Running a case), so a snapshot that breaks its schema is rejected even when it also names a missing component.
    try:
        result = assemble(Snapshot.from_json(document))
    except SnapshotError as error:
        print("; ".join(error.problems), file=sys.stderr)
        return 2
    except UnsupportedComponentError as error:
        print(f"{error.component} {error.id} is not provided", file=sys.stderr)
        return 3
    payload = base64.b64encode(result.payload).decode("ascii") if result.payload is not None else None
    sys.stdout.write(json.dumps({"payload": payload, "trace": result.trace}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
