"""The support-document corpus: markdown files with a front matter of id, title, tenant, version, freshness and an
optional expires, then one chunk per paragraph. Chunks become LlamaIndex nodes with the document's metadata. A chunk
id names the tenant, the document, its version and the paragraph, so a shared index across tenants cannot collide."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from llama_index.core.schema import TextNode

from .data import SOURCE

CORPUS = SOURCE / "corpus"


@dataclass(frozen=True)
class Chunk:
    id: str
    doc: str
    tenant: str
    version: str
    title: str
    freshness: str
    expires: str | None
    index: int
    text: str


def _front_matter(text: str) -> tuple[dict[str, str], str]:
    head, sep, body = text.partition("\n---\n")
    if not text.startswith("---\n") or not sep:
        raise ValueError("a corpus file starts with a --- front matter block")
    fields = {}
    for line in head.splitlines()[1:]:
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields, body


def chunks() -> list[Chunk]:
    """Every chunk of every document, in a stable order: by tenant directory, then file name, then paragraph."""
    found: list[Chunk] = []
    for path in sorted(CORPUS.rglob("*.md")):
        fields, body = _front_matter(path.read_text(encoding="utf-8"))
        paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
        for index, paragraph in enumerate(paragraphs):
            found.append(Chunk(
                id=f"kb:{fields['tenant']}:{fields['id']}:{fields['version']}#{index}",
                doc=fields["id"], tenant=fields["tenant"], version=fields["version"], title=fields.get("title", fields["id"]),
                freshness=fields["freshness"], expires=fields.get("expires"), index=index, text=paragraph,
            ))
    return found


def nodes() -> list[TextNode]:
    """The corpus as LlamaIndex nodes. Metadata travels with the node into retrieval and postprocessing."""
    return [
        TextNode(
            id_=chunk.id, text=chunk.text,
            metadata={"doc": chunk.doc, "tenant": chunk.tenant, "version": chunk.version, "title": chunk.title,
                      "freshness": chunk.freshness, "expires": chunk.expires or "", "index": chunk.index},
            excluded_embed_metadata_keys=["doc", "tenant", "version", "title", "freshness", "expires", "index"],
            excluded_llm_metadata_keys=["doc", "tenant", "version", "title", "freshness", "expires", "index"],
        )
        for chunk in chunks()
    ]
