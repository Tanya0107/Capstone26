/**
 * TypeScript mirror of backend/app/core/schemas.py and the Firestore schema
 * (project book, Fig 4). If you change one side, change the other. This pair
 * IS the API contract (Phase 2).
 *
 * Answer protection (R6): stored exercise docs are student safe. The
 * protected answer fields live in exerciseSolutions, readable by teachers
 * only and served to the tutor server side. See docs/API_CONTRACT.md.
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
  status: "draft" | "published";
  // Denormalized at publish time so rules can gate student reads and queries
  assignedStudentKeys: string[];
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
  scaffoldSteps?: string[]; // FR10
  // Denormalized at publish time, mirrors the parent module audience
  assignedStudentKeys: string[];
  // SECURITY (FR11, R6): answer fields are present only in the pipeline
  // output reviewed by teachers. Stored exercise docs never contain them,
  // they live in exerciseSolutions and never reach the student client.
  correctAnswer?: string;
  socraticHints?: SocraticHint[];
}

export interface ExerciseSolution {
  solutionId: string; // same id as the paired exercise doc
  exerciseKey: string;
  moduleKey: string;
  correctAnswer: string;
  socraticHints: SocraticHint[];
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

// ---------- Analytics (FR8, FR13) ----------
export interface StudentAnalyticsRow {
  studentKey: string;
  attSeconds?: number;
  tcvSeconds?: number;
  hsr?: number;
  ngs?: number;
  completed: boolean;
}

export interface AssignmentAnalytics {
  assignmentKey: string;
  students: StudentAnalyticsRow[];
}

// ---------- Feedback Memory Bank (FR6) ----------
export interface FeedbackIngestResponse {
  semanticDistance: number;
  stored: boolean;
}

export interface TeacherEditRecord {
  teacherKey: string;
  moduleKey: string;
  originalText: string;
  editedText: string;
}

// Backend only collection (Admin SDK). Mirrored here for contract parity.
export interface FeedbackMemoryRecord {
  memoryId: string;
  teacherKey: string;
  moduleKey: string;
  teacherModifications: string;
  semanticDistance: number;
  adaptedContextVector: number[];
  createdAt: string;
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

// GET /api/generation/subjects. The Goals screen offers only servable
// subjects, so the form cannot submit something the route would 422.
// grades is per subject because the snapshots do not cover the same ones,
// and a grade outside the list means an empty standards slice.
export interface SubjectOption {
  subject: string;
  subjectType: string;
  grades: string[];
  // True while the standards snapshot is still pending team validation.
  // The form must label the subject a draft rather than stay silent (R1).
  draftCorpus: boolean;
}

export interface SubjectCatalog {
  subjects: SubjectOption[];
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
  // A similarity score is meaningless without its reference. referenceValidated
  // is false while the gold unit is still DRAFT, and the Review Dashboard must
  // label the score a diagnostic rather than a metric when it is (R1, D17).
  referenceUnit?: string;
  referenceValidated?: boolean;
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
  summary?: string;
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

export interface ChatMessage {
  role: "student" | "tutor";
  text: string;
}

export interface TelemetrySnapshot {
  attSeconds: number;
  tcvSeconds?: number;
  hsr?: number;
  idleSeconds: number;
}

export interface TutorTurnRequest {
  studentKey: string;
  assignmentKey: string;
  exerciseKey: string;
  studentMessage: string;
  conversationHistory: ChatMessage[];
  telemetrySnapshot?: TelemetrySnapshot;
}

export interface TutorTurnResponse {
  hintText: string;
  hintLevel: number;
  affectiveState: AffectiveState;
  tone: "neutral" | "encouraging" | "energizing";
}
