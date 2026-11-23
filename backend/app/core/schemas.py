"""Pydantic models, the single source of truth for the API contract (Phase 2).

These mirror the Firestore schema (book Fig 4) and the JSON curriculum format
returned by POST /api/generation. Keep frontend/src/types/models.ts in sync.

Answer protection (R6): persisted exercises are split into student safe
exercise docs and teacher only exerciseSolutions docs. The pipeline level
Exercise model below still carries the answer because it is produced by the
generator and reviewed by the teacher. The split happens on persist in
core/firestore.py. Design note in docs/API_CONTRACT.md.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """Base for every contract model. The wire format and the Firestore doc
    format are camelCase to match frontend/src/types/models.ts and the
    security rules. Python code keeps snake_case attribute names."""
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------------------------------------------------------------- enums
class Role(str, Enum):
    teacher = "teacher"
    student = "student"


class AssignmentStatus(str, Enum):
    active = "active"
    used = "used"


class AffectiveState(str, Enum):
    """FR12, inferred (never measured biometrically) from ATT/TCV/HSR telemetry."""
    engaged = "engaged"
    frustrated = "frustrated"
    bored = "bored"
    unknown = "unknown"


class ModuleStatus(str, Enum):
    draft = "draft"
    published = "published"


# ------------------------------------------------- generation request (FR1)
class GenerationRequest(ApiModel):
    """Payload of POST /api/generation, the teacher Goals Enrichment Screen."""
    teacher_key: str
    school_key: str
    subject: str = Field(..., description="Subject key, must exist in the standards corpus (D8), e.g. math, science, history")
    goals: str = Field(..., description="Free text enrichment goals and themes")
    topics: list[str] = Field(default_factory=list)
    grade_level: str
    difficulty_level: int = Field(..., ge=1, le=5)
    standards_hint: Optional[str] = None


# ------------------------------------------------- curriculum content (Fig 4)
class SocraticHint(ApiModel):
    hint_order: int = Field(..., ge=1)
    hint_text: str = Field(..., description="Pedagogical scaffolding question, never the answer")


class Exercise(ApiModel):
    """Pipeline output and teacher review view. Persisted split per R6:
    prompt, order and scaffold_steps go to the exercises collection,
    correct_answer and socratic_hints go to exerciseSolutions."""
    exercise_id: Optional[str] = None      # exerciseKey, assigned on persist
    module_key: Optional[str] = None
    order: int
    prompt: str
    # For quantitative subjects this is the exact answer. For open ended
    # subjects it holds a model answer plus acceptance criteria (D8).
    correct_answer: str
    socratic_hints: list[SocraticHint] = Field(default_factory=list)
    scaffold_steps: list[str] = Field(default_factory=list, description="FR10 task breakdown")


class ExerciseSolution(ApiModel):
    """Teacher only Firestore doc holding the protected answer fields (R6).
    Served to the Socratic tutor server side, never to the student client."""
    solution_id: Optional[str] = None      # same id as the paired exercise doc
    exercise_key: str
    module_key: str
    correct_answer: str
    socratic_hints: list[SocraticHint] = Field(default_factory=list)


class LessonUnit(ApiModel):
    title: str
    objectives: list[str]
    hook: str = Field(..., description="Introductory engagement hook (Lesson Design Agent)")
    exercises: list[Exercise]


class AssessmentBundle(ApiModel):
    rubric: str
    diagnostics: list[str]
    exit_tickets: list[str]


class CriticIssue(ApiModel):
    exercise_order: int
    issue_type: Literal["wrong_answer", "hallucinated_step", "factual_error",
                        "unsupported_claim", "ambiguous_prompt",
                        "taxonomy_gap", "equity_flag"]
    detail: str


class CriticReport(ApiModel):
    """Output of the Equity and Quality (Critic) Agent, FR3 agentic self-correction."""
    approved: bool
    issues: list[CriticIssue] = Field(default_factory=list)
    regeneration_cycles_used: int = 0


class QualityScores(ApiModel):
    """FR4 automated algorithmic scoring attached to every draft.

    NOTE: these are per draft diagnostics. The Phase B thresholds
    (BERTScore>=0.80 etc.) are evaluated offline in /evaluation and are
    TARGETS, not results.
    """
    bertscore_f1: Optional[float] = None
    rouge_l: Optional[float] = None
    bleu: Optional[float] = None


class CurriculumPackage(ApiModel):
    """Structured JSON teacher guide returned by the pipeline (Curriculum Package Agent)."""
    module_key: Optional[str] = None
    title: str
    subject: str
    grade_level: str
    difficulty_level: int
    weekly_sequence: list[str] = Field(default_factory=list, description="Scope & Sequence output")
    lessons: list[LessonUnit]
    assessment: AssessmentBundle
    critic_report: CriticReport
    quality_scores: QualityScores
    generation_latency_seconds: Optional[float] = None  # NFR2 observability


# ------------------------------------------------- tutoring (FR11, FR12)
class ChatMessage(ApiModel):
    role: Literal["student", "tutor"]
    text: str


class TutorTurnRequest(ApiModel):
    student_key: str
    assignment_key: str
    exercise_key: str
    student_message: str
    conversation_history: list[ChatMessage] = Field(default_factory=list)
    telemetry_snapshot: Optional["TelemetrySnapshot"] = None


class TutorTurnResponse(ApiModel):
    hint_text: str
    hint_level: int = Field(..., description="Graduated hint ladder position (1 = gentlest)")
    affective_state: AffectiveState = AffectiveState.unknown
    tone: Literal["neutral", "encouraging", "energizing"] = "neutral"


class TelemetrySnapshot(ApiModel):
    """Rolling behavioral metrics used by the Adaptive Strategy module (FR12)."""
    att_seconds: float = 0.0     # Active Time on Task
    tcv_seconds: Optional[float] = None  # Task Completion Velocity
    hsr: Optional[float] = None  # Help-Seeking Ratio
    idle_seconds: float = 0.0


# ------------------------------------------------- analytics (FR8, FR13)
class StudentAnalyticsRow(ApiModel):
    """Aggregates for one student in one assignment. Values are None until
    enough telemetry exists. Computation lands in Phase 5, Step 5.2."""
    student_key: str
    att_seconds: Optional[float] = None
    tcv_seconds: Optional[float] = None
    hsr: Optional[float] = None
    ngs: Optional[float] = None
    completed: bool = False


class AssignmentAnalytics(ApiModel):
    assignment_key: str
    students: list[StudentAnalyticsRow] = Field(default_factory=list)


# ------------------------------------------------- feedback loop (FR6)
class FeedbackIngestResponse(ApiModel):
    semantic_distance: float
    stored: bool


class TeacherEditRecord(ApiModel):
    teacher_key: str
    module_key: str
    original_text: str
    edited_text: str


class FeedbackMemoryRecord(ApiModel):
    memory_id: Optional[str] = None
    teacher_key: str
    module_key: str
    teacher_modifications: str
    semantic_distance: float = Field(..., description="1 - cosine(sim) between draft and edit embeddings")
    adapted_context_vector: list[float] = Field(default_factory=list)
    created_at: Optional[datetime] = None


# ------------------------------------------------- telemetry (Fig 4, Logs Bank)
class TelemetryEvent(ApiModel):
    """NFR5: contains keys only, never names, emails or PII."""
    event_id: Optional[str] = None
    student_key: str
    exercise_key: str
    assignment_key: str
    att_seconds: float
    hsrc_count: int = 0          # Help-Seeking Request count for this exercise
    timestamp: Optional[datetime] = None


# ------------------------------------------------- Firestore docs (Fig 4)
# Mirrors of the stored document shapes used by core/firestore.py repos.
# assigned_student_keys on module and exercise docs is denormalized at
# publish time so security rules can gate student reads and queries.
class School(ApiModel):
    school_id: Optional[str] = None
    school_name: str
    location: str = ""
    created_at: Optional[datetime] = None


class UserDoc(ApiModel):
    user_id: Optional[str] = None
    name: str
    avatar: str = ""
    role: Role
    school_key: str


class CurriculumModule(ApiModel):
    module_id: Optional[str] = None
    title: str
    subject: str
    grade_level: str
    difficulty_level: int = Field(..., ge=1, le=5)
    creator_teacher_key: str
    status: ModuleStatus = ModuleStatus.draft
    assigned_student_keys: list[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None


class Assignment(ApiModel):
    assignment_id: Optional[str] = None
    module_key: str
    teacher_key: str
    assigned_to: list[str] = Field(default_factory=list)
    status: AssignmentStatus = AssignmentStatus.active
    published_at: Optional[datetime] = None


class StudentProgress(ApiModel):
    progress_id: Optional[str] = None
    assignment_key: str
    student_key: str
    current_exercise_order: int = 0
    is_completed: bool = False
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
