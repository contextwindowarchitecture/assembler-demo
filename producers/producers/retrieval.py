"""The retrieval producer: a LlamaIndex pipeline over the corpus, then a CWA producer batch.

    nodes -> BM25Retriever(top_k) -> NearDuplicatePostprocessor -> producer batch

The postprocessor interface is where LlamaIndex sits between retrieval and response synthesis, so it is where the
retriever's own duties (R-13) are done: a near-duplicate is dropped and reported with the chunk kept in its place.
Exact duplicates are left alone on purpose: the route asks the assembler to deduplicate exactly (R-24), and the
trace shows which is which. The batch adapter then turns each node into one scored item per chunk.
"""
from __future__ import annotations

import re
import time
from typing import Any

from llama_index.core.bridge.pydantic import Field
from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.schema import NodeWithScore, QueryBundle
from llama_index.retrievers.bm25 import BM25Retriever

from . import corpus
from .data import instant, item, load

PRODUCER = {"id": "kb-search", "kind": "retrieval"}
_WORD = re.compile(r"[a-z0-9]+")


def _words(text: str) -> frozenset[str]:
    return frozenset(_WORD.findall(text.lower()))


def _collapsed(text: str) -> str:
    return " ".join(text.split())


class NearDuplicatePostprocessor(BaseNodePostprocessor):
    """Drops a lower-ranked chunk whose word set overlaps a higher-ranked one's beyond `threshold` (Jaccard), and
    records the drop. Chunks with identical bodies are not touched: exact deduplication is the assembler's (R-24)."""

    threshold: float = Field(default=0.85)
    dropped: list[dict[str, str]] = Field(default_factory=list)

    @classmethod
    def class_name(cls) -> str:
        return "NearDuplicatePostprocessor"

    def _postprocess_nodes(self, nodes: list[NodeWithScore], query_bundle: QueryBundle | None = None) -> list[NodeWithScore]:
        kept: list[NodeWithScore] = []
        for candidate in nodes:
            words = _words(candidate.node.get_content())
            duplicate_of = None
            for earlier in kept:
                if _collapsed(earlier.node.get_content()) == _collapsed(candidate.node.get_content()):
                    continue  # exact: the assembler's
                earlier_words = _words(earlier.node.get_content())
                union = len(words | earlier_words)
                if union and len(words & earlier_words) / union >= self.threshold:
                    duplicate_of = earlier.node.node_id
                    break
            if duplicate_of:
                self.dropped.append({"item_id": candidate.node.node_id, "reason": "duplicate_content", "stage": "producer", "duplicate_of": duplicate_of})
            else:
                kept.append(candidate)
        return kept


def retrieve(query: str, top_k: int, *, scale: float, near_duplicate_jaccard: float) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run the pipeline for one query. Returns the producer batch and a report of how it ran."""
    started = time.perf_counter()
    all_nodes = corpus.nodes()
    retriever = BM25Retriever.from_defaults(nodes=all_nodes, similarity_top_k=top_k)
    # Equal scores are ordered newest first, so a tie between a chunk and its copy is broken by freshness, the same
    # tie-break the route's default order_by uses; the order is then the same however the index was built.
    retrieved = sorted(retriever.retrieve(query), key=lambda hit: (-(hit.score or 0.0), -instant(hit.node.metadata["freshness"]).timestamp()))
    dedupe = NearDuplicatePostprocessor(threshold=near_duplicate_jaccard)
    kept = dedupe.postprocess_nodes(retrieved, query_str=query)
    summaries = load("summaries.json")
    items = []
    for hit in kept:
        meta = hit.node.metadata
        chunk_id = hit.node.node_id
        variants = []
        if chunk_id in summaries:
            variants.append({"id": f"{chunk_id}~summary", "method": "summarised", "lineage": "summarised", "body": summaries[chunk_id]})
        fields: dict[str, Any] = dict(
            id=chunk_id, slot="evidence.knowledge", source=f"kb:{meta['tenant']}:{meta['doc']}", source_version=meta["version"],
            authority="reference_only", trust="unverified", freshness=meta["freshness"],
            scope={"tenant": meta["tenant"]},
            relevance=round(min((hit.score or 0.0) / scale, 1.0), 3),
            variants=variants,
            eligibility=f"support-entitlement/v1: tenant of the request; rerank at least 0.3 (BM25 score / {scale:g}, capped at 1)",
            body=hit.node.get_content(),
        )
        if meta.get("expires"):
            fields["expires"] = meta["expires"]
        items.append(item(**fields))
    batch = {"producer": PRODUCER, "items": items, "excluded": list(dedupe.dropped)}
    report = {
        "kind": "retrieval",
        "framework": "LlamaIndex",
        "pipeline": [f"{len(all_nodes)} nodes from {len({n.metadata['doc'] + n.metadata['tenant'] for n in all_nodes})} documents",
                     f"BM25Retriever(similarity_top_k={top_k})",
                     f"NearDuplicatePostprocessor(threshold={near_duplicate_jaccard})",
                     f"CWA batch: relevance = score / {scale:g}, capped at 1; source = document; variants from summaries.json"],
        "query": query,
        "retrieved": [{"id": n.node.node_id, "score": round(n.score or 0.0, 3)} for n in retrieved],
        "emitted": len(items),
        "reported_excluded": len(dedupe.dropped),
        "ms": round((time.perf_counter() - started) * 1000),
    }
    return batch, report
