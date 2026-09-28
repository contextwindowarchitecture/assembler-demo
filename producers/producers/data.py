"""Paths, loaders and the clock the producers share."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
STAGE = ROOT / "scenarios" / "intermediate"
SOURCE = STAGE / "source"
SCHEMAS = ROOT / "vendor" / "cwa" / "schema"


def load(name: str) -> Any:
    return json.loads((SOURCE / name).read_text(encoding="utf-8"))


def instant(text: str) -> datetime:
    """An RFC 3339 timestamp as an aware datetime (the portable profile the spec fixes: Z or an offset)."""
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


def item(**fields: Any) -> dict[str, Any]:
    """A context item with every policy field explicit, so the trace's defaults_filled stays empty and the audience
    sees what the producer declared. Callers pass slot-specific fields (scope, relevance, expires, variants)."""
    base = {
        "token_budget": None,
        "variants": [],
        "conflict_policy": "defers",
        "lineage": "verbatim",
        "eligibility": "route-policy",
        "injection_risk": "untrusted_content",
    }
    base.update(fields)
    return base
