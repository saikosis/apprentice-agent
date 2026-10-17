"""Run the successor exam and draw the pilot chart. docs/SPEC.md §9.

uv run --env-file .env python -m scripts.run_exam --ws live --runs 3
LOCAL_DB=data/local.json uv run --env-file .env python -m scripts.run_exam --runs 3   (before Firestore)
uv run python -m scripts.run_exam --chart-only r-xxxx                                 (redraw a stored report)
"""

import argparse
import asyncio
import sys
from pathlib import Path

from backend.app.contract import ExamReport
from backend.app.store import Store, new_id

CHART = Path("eval/pilot_chart.png")


def chart(report: ExamReport, out: Path = CHART, scenario: str = "ap") -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    so, sg = report.per_arm["sop_only"], report.per_arm["sop_graph"]
    fig, axes = plt.subplots(1, 2, figsize=(9, 4))
    for ax, title, vals, top in (
        (axes[0], "Decision agreement %", (so.agreement_pct, sg.agreement_pct), 100),
        (axes[1], "Judge mean (1–5)", (so.judge_mean, sg.judge_mean), 5),
    ):
        bars = ax.bar(["SOP only", "SOP + graph"], vals, color=["#f28c38", "#4c8bf5"], width=0.55)
        ax.bar_label(bars, fmt="%.1f" if top == 5 else "%.0f")
        ax.set_ylim(0, top * 1.12)
        ax.set_title(title)
        ax.spines[["top", "right"]].set_visible(False)
    fig.suptitle(
        f"Pilot — n={report.n_cases} cases, {report.runs_per_arm} runs/arm, synthetic {scenario} data"
    )
    fig.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=160)
    plt.close(fig)
    return out


async def main(args: argparse.Namespace) -> None:
    store = Store(args.ws, scenario=args.scenario)
    if args.chart_only:
        r = await store.exam_reports.get(args.chart_only)
        if r is None:
            raise SystemExit(f"no report {args.chart_only}")
    else:
        from backend.app.exam import report

        rid = new_id("r")
        await store.put_job(rid, "running")
        r = await report.run_exam(store, rid, args.runs)
    so, sg = r.per_arm["sop_only"], r.per_arm["sop_graph"]
    print(
        f"report {r.id}: SOP only {so.agreement_pct:.0f}% (judge {so.judge_mean}), "
        f"SOP + graph {sg.agreement_pct:.0f}% (judge {sg.judge_mean}); {len(r.new_probe_ids)} new questions"
    )
    out = CHART if args.scenario == "ap" else CHART.with_stem(f"pilot_chart_{args.scenario}")
    print(f"chart: {chart(r, out, args.scenario)}")


def cli() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # ₹ on Windows consoles
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--ws", choices=["live", "demo"], default="live")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--scenario", choices=["ap", "essays", "volunteers"], default="ap")
    ap.add_argument("--chart-only", metavar="REPORT_ID")
    asyncio.run(main(ap.parse_args()))


if __name__ == "__main__":
    cli()
