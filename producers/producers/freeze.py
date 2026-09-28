"""Run every producer for a step and freeze the snapshot (R-23).

    uv run python -m producers.freeze --step 01-retrieval --print     # {"snapshot", "snapshot_messages", "report"} on stdout
    uv run python -m producers.freeze --write                          # write every step's snapshots and scenario.json
    uv run python -m producers.freeze --check                          # exit 1 when a committed file differs

The snapshot is validated against the vendored snapshot schema before it is written or printed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import others, retrieval
from .data import SCHEMAS, STAGE, load


def produce(step: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """The two frozen snapshots for a step (fixture and messages renderings) and the producers' report."""
    common = load("common.json")
    scope = common["scope"]
    batches, report = [], {}
    for producer_id, (batch, run) in (
        ("policy-registry", others.policy()),
        ("state-svc", others.state(scope, common["assembly_time"])),
        ("kb-search", retrieval.retrieve(step["retrieval"]["query"], step["retrieval"]["top_k"], scale=common["retrieval"]["scale"],
                                         near_duplicate_jaccard=common["retrieval"]["near_duplicate_jaccard"])),
        ("memory-svc", others.memory(scope, common["assembly_time"], leak_other_user=step["memory"]["leak_other_user"])),
        ("conversation", others.conversation(step["question"])),
    ):
        batches.append(batch)
        report[producer_id] = run
    profiles = load("profiles.json")

    def snapshot(variant: str) -> dict[str, Any]:
        return {
            "assembly_time": common["assembly_time"],
            "scope": scope,
            "budget": step["budget"],
            "profile": profiles[variant],
            "route_policy": load("route-policy.json"),
            "tokenizer": common["tokenizer"],
            "renderer": common["renderers"][variant],
            "batches": json.loads(json.dumps(batches)),
            "conflicts": step["conflicts"],
        }

    return snapshot("fixture"), snapshot("messages"), report


def validate(document: dict[str, Any]) -> list[str]:
    """Problems against snapshot.schema.json, resolving the vendored schemas by $id; [] when valid."""
    import jsonschema
    from referencing import Registry, Resource

    schemas = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(SCHEMAS.glob("*.schema.json"))]
    registry = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas)
    schema = next(s for s in schemas if s["$id"].endswith("/snapshot.schema.json"))
    validator = jsonschema.Draft202012Validator(schema, registry=registry)
    return [f"/{'/'.join(str(p) for p in e.absolute_path)}: {e.message}" for e in validator.iter_errors(document)]


def text(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def files_for(step: dict[str, Any]) -> dict[str, str]:
    fixture, messages, report = produce(step)
    for name, document in (("snapshot.json", fixture), ("snapshot.messages.json", messages)):
        if problems := validate(document):
            sys.exit(f"{step['id']}/{name} is not a valid snapshot:\n  " + "\n  ".join(problems))
    directory = STAGE / step["id"]
    existing = json.loads((directory / "scenario.json").read_text(encoding="utf-8")) if (directory / "scenario.json").exists() else {}
    meta = {k: v for k, v in step.items() if k not in ("conflicts", "retrieval", "memory")}
    meta.update({
        "retrieval": step["retrieval"],
        "memory": step["memory"],
        "conflicts": [g["id"] for g in step["conflicts"]],
        # Timings vary run to run; the frozen report keeps what is reproducible.
        "producers": {producer_id: {k: v for k, v in run.items() if k != "ms"} for producer_id, run in report.items()},
        "expectations": existing.get("expectations", {"generated_by": None, "reviewed": False}),
    })
    return {"snapshot.json": text(fixture), "snapshot.messages.json": text(messages), "scenario.json": text(meta)}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--step", help="one step id; default every step")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--print", action="store_true", help="print {snapshot, snapshot_messages, report} for one step")
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    steps = [s for s in load("steps.json") if not args.step or s["id"] == args.step]
    if not steps:
        sys.exit(f"no step {args.step}")
    if args.print:
        if len(steps) != 1:
            sys.exit("--print takes one --step")
        fixture, messages, report = produce(steps[0])
        for name, document in (("snapshot", fixture), ("snapshot.messages", messages)):
            if problems := validate(document):
                sys.exit(f"{name} is not a valid snapshot:\n  " + "\n  ".join(problems))
        sys.stdout.write(json.dumps({"snapshot": fixture, "snapshot_messages": messages, "report": report}, ensure_ascii=False))
        return 0
    stale: list[str] = []
    for step in steps:
        directory = STAGE / step["id"]
        for name, content in files_for(step).items():
            path = directory / name
            current = path.read_text(encoding="utf-8") if path.exists() else None
            if current == content:
                continue
            if args.check:
                stale.append(str(path.relative_to(STAGE.parent.parent)))
                continue
            directory.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            print(f"wrote {path.relative_to(STAGE.parent.parent)}")
    if args.check and stale:
        print("stale (run the producers with --write):\n  " + "\n  ".join(stale), file=sys.stderr)
        return 1
    if args.check:
        print(f"{len(steps)} intermediate scenarios are current")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
