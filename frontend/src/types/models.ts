/**
 * TypeScript mirror of backend/app/core/schemas.py and the Firestore schema
 * (project book, Fig 4). If you change one side, change the other — this pair
 * IS the API contract (Phase 2).
 */

export type Role = "teacher" | "student";
export type AssignmentStatus = "active" | "used";
export type AffectiveState = "engaged" | "frustrated" | "bored" | "unknown";

// ---------- Content Bank ----------
export interface School {
  schoolId: string;
  schoolName: string;
  location: string;
  createdAt: string; // ISO timestamp
}

export interface User {
  userId: string;
  name: string;
  avatar: string;
  role: Role;
  schoolKey: string;
}

export interface CurriculumModule {
  moduleId: string;
  title: string;
  subject: string;
  gradeLevel: string;
  difficultyLevel: 1 | 2 | 3 | 4 | 5;
  creatorTeacherKey: string;
  createdAt: string;
  status?: "draft" | "published";
}

export interface SocraticHint {
  hintOrder: number;
  hintText: string;
}

export interface Exercise {
  exerciseId: string;
  moduleKey: string;
  order: number;
  prompt: string;
  // SECURITY (FR11): correctAnswer + socraticHints must never be fetched by
  // the student client — teacher views only; the tutor gets them server-side.
  correctAnswer?: string;
  socraticHints?: SocraticHint[];
  scaffoldSteps?: string[]; // FR10
}

// ---------- Distribution & Progress Bank ----------
export interface Assignment {
  assignmentId: string;
  moduleKey: string;
  teacherKey: string;
  assignedTo: string[]; // studentKeys
  status: AssignmentStatus;
  publishedAt: string;
}

export interface StudentProgress {
  progressId: string;
  assignmentKey: string;
  studentKey: string;
  currentExerciseOrder: number;
  isCompleted: boolean;
  startedAt: string;
  completedAt?: string;
}

// ---------- Logs & Analytics Bank ----------
export interface TelemetryEvent {
  eventId: string;
  studentKey: string;
  exerciseKey: string;
  assignmentKey: string;
  attSeconds: number;
  hsrcCount: number;
  timestamp: string;
}

// ---------- API payloads ----------
export interface GenerationRequest {
  teacherKey: string;
  schoolKey: string;
  subject: string;
  goals: string;
  topics: string[];
  gradeLevel: string;
  difficultyLevel: number;
  standardsHint?: string;
}

export interface CriticIssue {
  exerciseOrder: number;
  issueType:
    | "wrong_answer"
    | "hallucinated_step"
    | "factual_error"
    | "unsupported_claim"
    | "ambiguous_prompt"
    | "taxonomy_gap"
    | "equity_flag";
  detail: string;
}

export interface CriticReport {
  approved: boolean;
  issues: CriticIssue[];
  regenerationCyclesUsed: number;
}

export interface QualityScores {
  bertscoreF1?: number;
  rougeL?: number;
  bleu?: number;
}

export interface LessonUnit {
  title: string;
  objectives: string[];
  hook: string;
  exercises: Exercise[];
}

export interface AssessmentBundle {
  rubric: string;
  diagnostics: string[];
  exitTickets: string[];
}

export interface CurriculumPackage {
  moduleKey?: string;
  title: string;
  subject: string;
  gradeLevel: string;
  difficultyLevel: number;
  weeklySequence: string[];
  lessons: LessonUnit[];
  assessment: AssessmentBundle;
  criticReport: CriticReport;
  qualityScores: QualityScores;
  generationLatencySeconds?: number;
}

export interface TutorTurnRequest {
  studentKey: string;
  assignmentKey: string;
  exerciseKey: string;
  studentMessage: string;
  conversationHistory: { role: "student" | "tutor"; text: string }[];
}

export interface TutorTurnResponse {
  hintText: string;
  hintLevel: number;
  affectiveState: AffectiveState;
  tone: "neutral" | "encouraging" | "energizing";
}
