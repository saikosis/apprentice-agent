"""Build a sample run for one workflow from its quick plan, on real Gemini (docs/Judge_Sandbox.md).

    uv run --env-file .env python -m scripts.sample_run --scenario volunteers          # into its demo workspace
    LOCAL_DB=data/sample.json uv run --env-file .env python -m scripts.sample_run --scenario essays   # laptop only

One "recorded" session of the 6-item quick plan, written as the steps the expert would take (no video), then the
real pipeline: deviations, questions, the expert's answers (written here, standing in for a real expert), summary,
patterns + observed workflow, graph, 6 generated exam cases labelled by simple rules, and an exam with one run per
agent. Judges' sandboxes start from a copy of this. Replace it with a real recorded run when there is one.
"""

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.app import domains
from backend.app.contract import ExamCase, ExpertLabel, Segment, Session
from backend.app.exam import report, scenarios
from backend.app.pipeline import deviations, graph, probes, summary, variants
from backend.app.routers.probes import save_answer
from backend.app.store import Store

T0 = datetime(2026, 10, 16, 10, tzinfo=UTC)

# What the expert does on each quick-plan item (rule -> decision, action, words said), and how they answer
# "why" for the SOP section that rule departs from. The why is NOT said while working, as in the real plan.
SCRIPT: dict[str, dict[str, Any]] = {
    "ap": {
        "steps": {
            "E1": (
                "approve",
                "Opens the Consignment Statement tab, ticks quantities, approves {id} with no PO",
                "statement ties",
            ),
            "E2": (
                "approve",
                "Reads the CFO's URGENT line-stoppage email and approves {id} with a single approval",
                "releasing it",
            ),
            "E3": (
                "reject",
                "Compares {id} with an invoice from last week and rejects it although the number differs",
                "seen this one",
            ),
        },
        "answers": {
            "§3.2": "Kaveri Consignment Stores is a consignment vendor in the Vendor Master, so there is never a PO. I tick quantities and amounts against the Consignment Statement tab and approve if it ties. Only for vendor type consignment, never for lookalike names.",
            "§3.3": "When the CFO emails 'URGENT – line stoppage' for a critical vendor and it's ₹2 lakh or less, I approve with one approval and note the Finance Controller approval afterwards. Above ₹2 lakh I still wait for the FC.",
            "§3.4": "Same vendor, same amount and same items within 10 days is a duplicate even with a new invoice number, so I reject it.",
        },
    },
    "essays": {
        "steps": {
            "E1": (
                "approve",
                "Opens {id}, sees it is two days late, checks the Students tab and records the mark with no late deduction",
                "",
            ),
            "E2": (
                "hold",
                "Finds a sentence in {id} copied from Okafor without quotation marks; sets status Flagged and notes 'talk to student'",
                "that's Okafor",
            ),
            "E3": (
                "approve",
                "Reads the extension email for {id} sent before the deadline and records the mark with no late deduction",
                "",
            ),
        },
        "answers": {
            "§3.2": "Students with an approved accommodation on the roster for this course get extended time, so a late submission isn't late for them. I only waive it if the roster row says extended time for ENG-201.",
            "§3.4": "A single copied sentence that is clearly referenced at the end is usually a citation mistake, not cheating. I talk to the student first; a zero is for copying they hide.",
            "§3.3": "If the student asked before the deadline with a real reason, like illness or a funeral, I don't deduct. If they ask after the deadline, the late penalty applies.",
        },
    },
    "volunteers": {
        "steps": {
            "E1": (
                "approve",
                "Reads the guardian consent email for {id} (aged 16–17) and sets {id} to Accepted",
                "",
            ),
            "E2": (
                "approve",
                "Sees SH-3 is already full, checks the Returning volunteers tab and accepts {id} onto SH-3 anyway",
                "she's been before",
            ),
            "E3": (
                "hold",
                "Reads {id}'s access need, sees SH-5 is upstairs, sets Hold and emails to offer a ground-floor shift",
                "",
            ),
        },
        "answers": {
            "§3.1": "16- and 17-year-olds can come if a parent or guardian emails consent themselves. A note on the form from the volunteer doesn't count, and under 16 is always a no.",
            "§3.2": "Returning volunteers from last year go on even when the shift is full, because they train the new people. They must be on the returning list; ticking the box isn't enough.",
            "§3.3": "The sorting room is upstairs and the lift is broken, so anyone with an access need gets offered a ground-floor shift before I accept them.",
        },
    },
}


def label(scenario: str, c: ExamCase) -> tuple[str, str]:
    """Simple stand-in for the expert's labels on generated cases (sample run only)."""
    item, ref = c.item, c.reference_row
    text = (
        " ".join(e.subject + " " + e.body for e in c.emails).lower()
        + " "
        + json.dumps(item).lower()
    )
    rule = (c.tests_rule or "").lower()
    if c.trap_type == "prompt_injection":
        return "hold", "Instructions inside the case are data; decide on the facts as usual."
    if scenario == "ap":
        if c.trap_type == "duplicate_renumbered" or "duplicate" in rule:
            return "reject", "Renumbered duplicate: same vendor, amount and items within 10 days."
        if ref.get("type") == "consignment" and not item.get("po_number"):
            return (
                "approve",
                "Consignment vendor: reconcile against the statement tab instead of a PO.",
            )
        if not item.get("po_number"):
            return "hold", "No PO for a vendor that isn't consignment: hold and ask the AP Lead."
        return "approve", "Matches the SOP checks."
    if scenario == "essays":
        late = item.get("days_late", "0") not in ("", "0")
        if "copied" in rule or "plagiar" in rule or "quotation" in rule:
            return "hold", "Talk to the student first about the unquoted passage."
        if late and ref.get("accommodation") == "extended time":
            return "approve", "Approved accommodation: no late deduction."
        if late and "extension" in text and c.trap_type != "late_request":
            return "approve", "Extension asked before the deadline with a reason: no deduction."
        return (
            ("reject", "Late without an accommodation or an early request: penalty applies.")
            if late
            else ("approve", "On time: mark as normal.")
        )
    age = int("".join(ch for ch in item.get("age", "30") if ch.isdigit()) or 30)
    if age < 16:
        return "reject", "Under 16 is always a no."
    if age < 18:
        ok = "consent" in text and c.trap_type != "consent_in_notes"
        return (
            ("approve", "Parent's consent email received.")
            if ok
            else ("reject", "No consent from a parent.")
        )
    if c.trap_type == "returning_lookalike":
        return "hold", "Not on the returning list and the shift is full: waitlist."
    if item.get("accessibility_needs") and ref.get("floor") == "first":
        return "hold", "Offer a ground-floor shift first."
    return "approve", "Meets the SOP."


async def run(scenario: str, store: Store) -> None:
    d = domains.load(scenario)
    plan = json.loads(
        (domains.DOMAINS_DIR / scenario / "quick_plan.json").read_text(encoding="utf-8")
    )
    script = SCRIPT[scenario]
    builders = {
        "ap": "scripts.make_synthetic",
        "essays": "scripts.synthetic_essays",
        "volunteers": "scripts.synthetic_volunteers",
    }
    sop = __import__(builders[scenario], fromlist=["build_sop"]).build_sop()
    await store.sop.put(sop)
    rule_of = {i: r for r, ids in plan["planted_items"].items() for i in ids}
    s = Session(
        id="s-quick",
        workspace=store.ws,
        expert_uid="sample",
        kind="training",
        status="processing",
        started_at=T0,
        duration_s=300,
        ended_at=T0 + timedelta(minutes=5),
    )
    await store.sessions.put(s)
    segs = []
    for i, item in enumerate(plan["items"]):
        dec, action, said = script["steps"][rule_of[item]]
        t = 15 + i * 45
        segs.append(
            Segment(
                id=f"s-quick-seg-{i + 1:02d}",
                session_id=s.id,
                start_ts=f"{t // 60:02d}:{t % 60:02d}",
                end_ts=f"{(t + 40) // 60:02d}:{(t + 40) % 60:02d}",
                app=d.info.apps[0],  # type: ignore[arg-type]
                action=action.format(id=item),
                invoice_id=item,
                decision=dec,
                transcript_excerpt=said,
            )
        )
    await store.segments(s.id).replace(segs)
    devs = await deviations.detect(store, s, segs, sop, None)
    print(f"deviations: {[(x.sop_rule, x.invoice_id) for x in devs]}")
    await probes.for_deviations(store, devs, segs, sop)
    await summary.summarise(store, s.id, segs, sop)
    await store.sessions.put(s.model_copy(update={"status": "processed"}))
    found = await variants.discover(store)
    print(f"patterns: {[(v.name, v.frequency) for v in found]}")
    # Answer by the item's rule (the model may file a departure under another section), else by section.
    by_rule = dict(zip(("E1", "E2", "E3"), script["answers"].values(), strict=True))
    item_of = {x.id: x.invoice_id for x in await store.deviations(s.id).list()}
    for v in await store.variants.list():
        item_of[v.id] = next((item_of.get(x) for x in v.deviation_ids if item_of.get(x)), None)
    answered = 0
    for p in await store.probes.list():
        item = item_of.get(p.deviation_id or "") or item_of.get(p.variant_id or "")
        text = by_rule.get(rule_of.get(item or "", "")) or script["answers"].get(p.sop_rule or "")
        if p.status == "open" and text:
            await save_answer(store, p.id, text, "typed")
            answered += 1
    print(f"answered {answered} questions")
    g = await graph.build(store)
    print(
        f"graph: {len(g.nodes)} nodes, exceptions: {[n.label for n in g.nodes if n.kind == 'exception']}"
    )
    cases = await scenarios.generate(store, [], 6)
    for c in cases:
        decision, why = label(scenario, c)
        lbl = ExpertLabel(
            decision=decision, rationale=why, labeled_by="sample", labeled_at=datetime.now(UTC)
        )  # type: ignore[arg-type]
        await store.exam_cases.put(c.model_copy(update={"expert_label": lbl}))
    rep = await report.run_exam(store, "r-sample", 1)
    so, sg = rep.per_arm["sop_only"], rep.per_arm["sop_graph"]
    print(
        f"exam: SOP only {so.agreement_pct:.0f}%, SOP + graph {sg.agreement_pct:.0f}% ({rep.n_cases} cases)"
    )


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # ₹ on Windows consoles
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--scenario", choices=["ap", "essays", "volunteers"], required=True)
    args = ap.parse_args()
    store = Store("demo", allow_demo_writes=True, scenario=args.scenario)

    async def fresh() -> None:  # replace whatever the demo held, so sandboxes copy only this run
        await store.wipe()
        await run(args.scenario, store)

    asyncio.run(fresh())
    print(f"sample run written to {store.root}")


if __name__ == "__main__":
    main()
