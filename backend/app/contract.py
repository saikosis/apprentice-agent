"""Data contract — SOURCE OF TRUTH. Change here, then `make types`. See docs/SPEC.md §1."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class M(BaseModel):
    model_config = ConfigDict(extra="forbid")


Timestamp = str  # "MM:SS" (H:MM:SS if > 1h)
Decision = Literal["approve", "reject", "hold", "escalate"]
Arm = Literal["sop_only", "sop_graph"]


class ClipRef(M):
    session_id: str
    start_ts: Timestamp
    end_ts: Timestamp


class SOPSection(M):
    id: str  # "§3.2"
    title: str
    text: str


class SOP(M):
    id: str
    title: str
    version: int
    sections: list[SOPSection]
    full_text: str


class ModerationResult(M):
    id: str
    target_kind: Literal["segment", "probe_answer", "exam_input", "agent_output", "email"]
    target_id: str
    template: str
    match_found: bool
    filters: dict[str, str]
    skipped: bool = False
    blocked: bool
    checked_at: datetime


class Session(M):
    id: str
    workspace: Literal["demo", "live"]
    expert_uid: str
    kind: Literal["training", "heldout"]
    status: Literal["created", "uploading", "uploaded", "processing", "processed", "failed"]
    gcs_uri: str | None = None
    gemini_file_name: str | None = None
    gemini_file_uploaded_at: datetime | None = None
    duration_s: int | None = None
    started_at: datetime
    ended_at: datetime | None = None
    live_enabled: bool = True
    sheet_snapshot_before_id: str | None = None
    sheet_snapshot_after_id: str | None = None
    error: str | None = None


class Segment(M):
    id: str
    session_id: str
    start_ts: Timestamp
    end_ts: Timestamp
    app: Literal["sheets", "gmail", "other"]
    action: str
    invoice_id: str | None = None
    vendor: str | None = None
    decision: Decision | Literal["none"] = "none"
    transcript_excerpt: str = ""
    on_screen_text: str = ""
    moderation_id: str | None = None
    quarantined: bool = False


class Deviation(M):
    id: str
    session_id: str
    source: Literal["live", "batch"]
    sop_rule: str  # "§3.2"
    timestamp: Timestamp
    t_seconds: int
    invoice_id: str | None = None
    description: str
    question: str
    confidence: float = Field(ge=0, le=1)
    dedup_of: str | None = None  # id of the live deviation it duplicates


class Variant(M):
    id: str
    name: str
    description: str
    sop_rules: list[str]
    session_ids: list[str]
    deviation_ids: list[str]
    exemplar_clips: list[ClipRef]
    frequency: int


class Probe(M):
    id: str
    session_id: str | None = None
    deviation_id: str | None = None
    variant_id: str | None = None
    source: Literal["live", "batch", "exam_miss"]
    cdm_type: Literal["cue", "goal", "option", "experience", "rule", "anomaly", "hypothetical"]
    question: str
    sop_rule: str | None = None
    clip: ClipRef | None = None
    status: Literal["open", "answered", "skipped"] = "open"
    created_at: datetime


class ProbeAnswer(M):
    probe_id: str
    text: str
    source: Literal["voice_live", "typed", "edited"]
    answered_at: datetime
    moderation: ModerationResult | None = None


class DecisionNode(M):
    id: str
    kind: Literal["cue", "goal", "option", "rule", "exception"]
    label: str
    detail: str
    sop_rule: str | None = None  # exception nodes MUST set this
    evidence: list[ClipRef]  # >=1 required for cue/rule/exception
    probe_ids: list[str]
    confidence: float = Field(ge=0, le=1)


class DecisionEdge(M):
    id: str
    source: str
    target: str
    relation: Literal["triggers", "serves", "chooses", "overrides", "requires"]


class DecisionGraph(M):
    version: int
    built_at: datetime
    prompt_version: str
    nodes: list[DecisionNode]
    edges: list[DecisionEdge]


class InvoiceRow(M):
    invoice_id: str
    vendor_id: str
    vendor_name: str
    invoice_no: str
    invoice_date: str
    amount_inr: float
    gst_inr: float
    po_number: str | None = None
    grn_number: str | None = None
    due_date: str
    category: str
    status: Literal["Pending", "Approved", "Rejected", "On Hold"]
    approver_1: str | None = None
    approver_2: str | None = None
    notes: str = ""


class Email(M):
    id: str
    sender: str
    subject: str
    body: str
    received_at: str


class ExpertLabel(M):
    decision: Decision
    rationale: str
    labeled_by: str
    labeled_at: datetime


class ExamCase(M):
    id: str
    origin: Literal["heldout", "generated"]
    trap_type: Literal["none", "consignment_lookalike", "prompt_injection", "duplicate_renumbered"]
    tests_rule: str | None = None  # exception/variant name being tested
    invoice: InvoiceRow
    vendor_master_row: dict[str, str]
    emails: list[Email]
    context: str
    expert_label: ExpertLabel | None = None  # judge-only


class AgentOutput(M):  # structured output schema for both arms
    decision: Decision
    rationale: str
    planned_steps: list[str]
    cited_sop_rules: list[str]
    cited_nodes: list[str] = []
    cited_clips: list[ClipRef] = []


class AgentRun(M):
    id: str
    case_id: str
    arm: Arm
    run_index: int
    output: AgentOutput | None
    blocked: bool = False
    moderation_in_id: str | None = None
    moderation_out_id: str | None = None
    latency_ms: int
    model: str
    prompt_version: str


class JudgeScore(M):
    run_id: str
    case_id: str
    arm: Arm
    decision_match: bool
    decision_score: int = Field(ge=1, le=5)
    rationale_consistency: int = Field(ge=1, le=5)
    edge_case_handling: int = Field(ge=1, le=5)
    total: float
    explanation: str
    hand_checked: bool = False
    hand_override_total: float | None = None


class CaseRow(M):
    case_id: str
    trap_type: str
    expert_decision: Decision
    sop_only_majority: Decision | None
    sop_graph_majority: Decision | None
    sop_only_agree: bool
    sop_graph_agree: bool
    sop_only_stability: float  # share of runs matching the majority
    sop_graph_stability: float
    sop_only_judge_mean: float
    sop_graph_judge_mean: float


class ArmSummary(M):
    agreement_pct: float
    judge_mean: float
    traps_correct: int
    blocked_runs: int


class ExamReport(M):
    id: str
    created_at: datetime
    label: Literal["pilot"] = "pilot"
    n_cases: int
    runs_per_arm: int
    per_arm: dict[Arm, ArmSummary]
    cases: list[CaseRow]
    new_probe_ids: list[str]
    graph_version: int


class CellChange(M):
    invoice_id: str
    column: str
    before: str | None
    after: str | None


class SheetSnapshot(M):
    id: str
    session_id: str
    phase: Literal["before", "after"]
    taken_at: datetime
    rows: list[InvoiceRow]


class SheetDiff(M):
    session_id: str
    changes: list[CellChange]


# LLM output wrappers
class SegmentList(M):
    segments: list[Segment]


class DeviationList(M):
    deviations: list[Deviation]


class VariantList(M):
    variants: list[Variant]


class ProbeList(M):
    probes: list[Probe]


class ExamCaseList(M):
    cases: list[ExamCase]
