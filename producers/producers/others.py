"""The state, memory, conversation and policy producers. Each reads its store and returns a batch and a report."""
from __future__ import annotations

import time
from typing import Any

from .data import instant, item, load


def state(scope: dict[str, str], assembly_time: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """The account service: the user's row as state.user, and the task as state.task, both observed now."""
    started = time.perf_counter()
    account = load("accounts.json")[scope["user"]]
    items = [
        item(id=f"user:{scope['user']}:plan", slot="state.user", source="accounts-db:workspaces", source_version=account["source_version"],
             authority="state", trust="verified", freshness=account["observed"], scope={"tenant": scope["tenant"], "user": scope["user"]},
             conflict_policy="governs", lineage="extracted", injection_risk="none",
             eligibility="support-entitlement/v1: tenant and user of the request; observed within 300 s",
             body=f"plan={account['plan']}; seats={account['seats']}; region={account['region']}; renewal={account['renewal']}"),
        item(id=f"task:{scope['task']}", slot="state.task", source="app:task", source_version="1", authority="state", trust="verified",
             freshness=assembly_time, scope={"tenant": scope["tenant"], "task": scope["task"]}, conflict_policy="governs", lineage="extracted",
             injection_risk="none", eligibility="support-entitlement/v1: tenant and task of the request; observed within 300 s",
             body="task=entitlement_question; channel=in-app chat"),
    ]
    batch = {"producer": {"id": "state-svc", "kind": "state"}, "items": items, "excluded": []}
    report = {"kind": "state", "framework": "accounts.json", "pipeline": ["read the workspace row for the user", "one state.user item, one state.task item"],
              "emitted": len(items), "reported_excluded": 0, "ms": round((time.perf_counter() - started) * 1000)}
    return batch, report


def memory(scope: dict[str, str], assembly_time: str, *, leak_other_user: bool) -> tuple[dict[str, Any], dict[str, Any]]:
    """The memory store: this tenant's memories, expired ones suppressed and reported without their body (R-14).
    With leak_other_user, it filters by tenant only, so another user's memory reaches admission."""
    started = time.perf_counter()
    now = instant(assembly_time)
    items, excluded = [], []
    for memory in load("memories.json")["memories"]:
        if memory["tenant"] != scope["tenant"]:
            continue
        if memory["user"] != scope["user"] and not leak_other_user:
            continue
        if instant(memory["expires"]) <= now:
            excluded.append({"item_id": memory["id"], "reason": "expired", "stage": "producer"})
            continue
        items.append(item(id=memory["id"], slot="interaction.memory", source=memory["source"], source_version="1", authority="generated",
                          trust="unverified", freshness=memory["freshness"], expires=memory["expires"],
                          scope={"tenant": memory["tenant"], "user": memory["user"]}, lineage="summarised",
                          eligibility="support-entitlement/v1: tenant and user of the request; not expired; source turn:",
                          body=memory["body"]))
    batch = {"producer": {"id": "memory-svc", "kind": "memory"}, "items": items, "excluded": excluded}
    report = {"kind": "memory", "framework": "memories.json",
              "pipeline": [f"filter by tenant{'' if leak_other_user else ' and user'}", "suppress expired memories and report them without their body"],
              "emitted": len(items), "reported_excluded": len(excluded), "ms": round((time.perf_counter() - started) * 1000)}
    return batch, report


def conversation(question: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """This session's prior turns, each with its supplied summary as a variant, and the live query: the step's question."""
    started = time.perf_counter()
    history = load("history.json")
    items = []
    for turn in history["turns"]:
        generated = turn["role"] == "assistant"
        items.append(item(id=turn["id"], slot="interaction.history", source=f"conversation:{turn['id'].split(':')[1]}", source_version="1",
                          authority="untrusted" if generated else "user", trust="unverified", freshness=turn["at"],
                          lineage="generated" if generated else "verbatim",
                          variants=[{"id": f"{turn['id']}~summary", "method": "summarised", "lineage": "summarised", "body": turn["summary"]}],
                          body=turn["body"]))
    query = history["query"]
    items.append(item(id=query["id"], slot="interaction.query", source=f"conversation:{query['id'].split(':')[1]}", source_version="1",
                      authority="user", trust="unverified", freshness=query["at"], body=question))
    batch = {"producer": {"id": "conversation", "kind": "interaction"}, "items": items, "excluded": []}
    report = {"kind": "interaction", "framework": "history.json", "pipeline": ["every prior turn as history with its supplied summary variant", "the live query"],
              "emitted": len(items), "reported_excluded": 0, "ms": round((time.perf_counter() - started) * 1000)}
    return batch, report


def policy() -> tuple[dict[str, Any], dict[str, Any]]:
    """The policy registry's instructions."""
    started = time.perf_counter()
    items = [item(id=p["id"], slot="governance.instructions", source=p["source"], source_version=p["source_version"], authority="governing",
                  trust="verified", freshness=p["freshness"], conflict_policy=p["conflict_policy"], injection_risk="none", body=p["body"])
             for p in load("policy.json")["items"]]
    batch = {"producer": {"id": "policy-registry", "kind": "policy"}, "items": items, "excluded": []}
    report = {"kind": "policy", "framework": "policy.json", "pipeline": ["the route's instructions, verified"], "emitted": len(items),
              "reported_excluded": 0, "ms": round((time.perf_counter() - started) * 1000)}
    return batch, report
