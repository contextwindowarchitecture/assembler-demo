"""Run only the retrieval producer, for the advanced stage's controller, which builds its own snapshots.

    uv run python -m producers.retrieve --query "..." --top-k 3     # the kb-search batch and report on stdout
"""
from __future__ import annotations

import argparse
import json
import sys

from . import retrieval
from .data import load


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", required=True)
    parser.add_argument("--top-k", type=int, default=3)
    args = parser.parse_args(argv)
    settings = load("common.json")["retrieval"]
    batch, report = retrieval.retrieve(args.query, args.top_k, scale=settings["scale"], near_duplicate_jaccard=settings["near_duplicate_jaccard"])
    sys.stdout.write(json.dumps({"batch": batch, "report": report}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
