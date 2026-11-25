/**
 * Client-side telemetry capture (feeds ATT / TCV / HSR — book §Metrics).
 *
 * Design (Phase 4, Step 4.5):
 *  - Heartbeat every 15s while the workspace tab is focused and the student
 *    has interacted since the last beat (keystroke/pointer) -> att accrual.
 *  - Idle gaps > IDLE_CUTOFF are excluded client-side AND server-side.
 *  - Every "Ask the tutor" click increments hsrcCount for that exercise.
 *  - Batched writes to telemetryEvents; NFR7 — on network failure, buffer to
 *    localStorage and flush on reconnect (never lose progress).
 *  - NFR5 — payloads contain keys only, never names or emails.
 *
 * The block above is the specification, kept as written. The notes below are
 * how it lands and why.
 *
 * Client side, idle time is excluded by a beat not happening at all. The
 * interval fires every 15s and writes a beat only when the tab is visible
 * and something has been typed or pointed at since the previous beat. A
 * student who walks away accrues nothing, so no subtraction is ever needed.
 * Server side the exclusion is a comparison of two consecutive beat
 * timestamps against IDLE_CUTOFF_SECONDS in backend/app/core/telemetry.py.
 * That comparison only works if the server sees individual beats, which is
 * why every beat is its own document with its own timestamp, and why
 * attSeconds is the active time of that one interval rather than a running
 * total. compute_hsr sums hsrcCount across events, which wants per event
 * counts for the same reason.
 *
 * The timestamp is the client clock at the beat, not a serverTimestamp. A
 * beat buffered through ten minutes offline would otherwise arrive stamped
 * with the moment of the reconnect, which would collapse the very gaps the
 * idle cutoff reads and quietly turn idle time into active time. Only the
 * spacing between one student's own beats is ever compared, so clock skew
 * between devices does not matter. Clock trust does, and these numbers are
 * behavioural research data rather than a grade. Recorded as D22.
 *
 * Two properties of the security rules shape the rest, both measured in
 * firebase/rules.test.ts rather than assumed. A student cannot read the log
 * back, so the client cannot deduplicate by looking first. And the log is
 * append only, so a write onto an id that already exists is refused. Beat
 * ids are therefore deterministic, which turns a replayed beat into a
 * harmless refusal instead of a double count.
 *
 * Nothing here may break the workspace. Telemetry is instrumentation and a
 * child's lesson outranks it, so every path fails quietly.
 */
import { doc, setDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";

/** The design block's 15s beat. */
const BEAT_SECONDS = 15;
const BEAT_MS = BEAT_SECONDS * 1000;
/** Beats per write round trip, so one batch covers a minute of activity. */
const BATCH_SIZE = 4;
const QUEUE_KEY = "enrichment:pending-telemetry";
/** About an hour of beats. Past that the oldest go, never the newest. */
const QUEUE_LIMIT = 240;

/**
 * One queued beat. These are the TelemetryEvent contract fields and nothing
 * else, so the queue cannot carry what the document may not (NFR5).
 */
export interface PendingBeat {
  eventId: string;
  studentKey: string;
  assignmentKey: string;
  exerciseKey: string;
  attSeconds: number;
  hsrcCount: number;
  /** ISO, the client clock at the beat. See the timestamp note above. */
  timestamp: string;
}

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readQueue(): PendingBeat[] {
  const storage = store();
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingBeat[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(beats: PendingBeat[]): void {
  const storage = store();
  if (!storage) return;
  try {
    const kept = beats.length > QUEUE_LIMIT ? beats.slice(beats.length - QUEUE_LIMIT) : beats;
    storage.setItem(QUEUE_KEY, JSON.stringify(kept));
  } catch {
    // A student who cannot buffer still gets to work. The beat is lost, the
    // lesson is not.
  }
}

function enqueue(beat: PendingBeat): PendingBeat[] {
  const next = [...readQueue(), beat];
  writeQueue(next);
  return next;
}

function dropSettled(ids: string[]): void {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  writeQueue(readQueue().filter((beat) => !gone.has(beat.eventId)));
}

/** Exactly the TelemetryEvent contract fields, built one by one (NFR5). */
function toDoc(beat: PendingBeat): Record<string, string | number> {
  return {
    eventId: beat.eventId,
    studentKey: beat.studentKey,
    exerciseKey: beat.exerciseKey,
    assignmentKey: beat.assignmentKey,
    attSeconds: beat.attSeconds,
    hsrcCount: beat.hsrcCount,
    timestamp: beat.timestamp,
  };
}

function ref(beat: PendingBeat) {
  return doc(db, "telemetryEvents", beat.eventId);
}

/**
 * True when the write was refused rather than lost. The append only rule
 * answers permission-denied for an id already in the log, which is the
 * replay case and is settled rather than pending. A genuine rules problem
 * reads the same way and would also drop the beat, which is the right trade,
 * since the alternative is a queue that retries for ever.
 */
function alreadySettled(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "permission-denied";
}

async function sendIndividually(beats: PendingBeat[]): Promise<string[]> {
  const results = await Promise.allSettled(beats.map((beat) => setDoc(ref(beat), toDoc(beat))));
  return beats
    .filter((_, index) => {
      const result = results[index];
      return result.status === "fulfilled" || alreadySettled(result.reason);
    })
    .map((beat) => beat.eventId);
}

/**
 * Write every queued beat. Batched, which is one round trip for the common
 * case. A batch is atomic, so one replayed id would refuse the whole commit
 * and take fresh beats down with it. That is why a failed batch is retried
 * as individual writes, where a refusal costs only its own beat.
 */
export async function flushTelemetryQueue(): Promise<number> {
  const beats = readQueue();
  if (beats.length === 0) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;

  try {
    if (beats.length === 1) {
      await setDoc(ref(beats[0]), toDoc(beats[0]));
      dropSettled([beats[0].eventId]);
      return 1;
    }
    const batch = writeBatch(db);
    beats.forEach((beat) => batch.set(ref(beat), toDoc(beat)));
    await batch.commit();
    dropSettled(beats.map((beat) => beat.eventId));
    return beats.length;
  } catch (error) {
    if (beats.length === 1) {
      if (alreadySettled(error)) dropSettled([beats[0].eventId]);
      return 0;
    }
    const settled = await sendIndividually(beats).catch(() => [] as string[]);
    dropSettled(settled);
    return settled.length;
  }
}

interface Session {
  studentKey: string;
  assignmentKey: string;
  exerciseKey: string;
  /** Per session, so beat ids cannot collide across sessions or devices. */
  nonce: string;
  seq: number;
  /** Cleared by every beat. No interaction means no beat, which is the idle rule. */
  interacted: boolean;
  /** Client clock of the last beat, for the partial window on a help click. */
  lastBeatAt: number;
  timer: ReturnType<typeof setInterval> | null;
  teardown: Array<() => void>;
}

let session: Session | null = null;

function nextBeat(current: Session, attSeconds: number, hsrcCount: number): void {
  current.seq += 1;
  const beat: PendingBeat = {
    eventId: `${current.studentKey}__${current.nonce}__${current.seq}`,
    studentKey: current.studentKey,
    assignmentKey: current.assignmentKey,
    exerciseKey: current.exerciseKey,
    attSeconds,
    hsrcCount,
    timestamp: new Date().toISOString(),
  };
  current.lastBeatAt = Date.now();
  const queued = enqueue(beat);
  if (queued.length >= BATCH_SIZE) void flushTelemetryQueue();
}

function stopSession(): void {
  const current = session;
  if (!current) return;
  session = null;
  if (current.timer !== null) clearInterval(current.timer);
  current.teardown.forEach((off) => off());
  current.teardown = [];
  void flushTelemetryQueue();
}

/**
 * Begin accruing active time for one student on one exercise. Returns the
 * stop function, which flushes what it holds. Safe to call with no signed in
 * user or outside the browser, where it does nothing at all.
 */
export function startTelemetrySession(assignmentKey: string, exerciseKey: string): () => void {
  const noop = () => {};
  if (typeof window === "undefined") return noop;
  const studentKey = auth.currentUser?.uid;
  if (!studentKey || !assignmentKey || !exerciseKey) return noop;

  // One session at a time. Moving to the next exercise stops the previous one.
  if (session) stopSession();

  const current: Session = {
    studentKey,
    assignmentKey,
    exerciseKey,
    nonce: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    seq: 0,
    interacted: false,
    lastBeatAt: Date.now(),
    timer: null,
    teardown: [],
  };
  session = current;

  const markInteraction = () => {
    current.interacted = true;
  };
  const listen = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler);
    current.teardown.push(() => target.removeEventListener(type, handler));
  };

  // Keystroke or pointer, per the design block.
  listen(window, "keydown", markInteraction);
  listen(window, "pointerdown", markInteraction);
  listen(window, "visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushTelemetryQueue();
  });
  listen(window, "online", () => void flushTelemetryQueue());
  listen(window, "pagehide", () => void flushTelemetryQueue());

  current.timer = setInterval(() => {
    // Not focused is not active, and no interaction since the last beat is
    // idle. Either way no beat happens and nothing accrues.
    if (document.visibilityState === "hidden") return;
    if (!current.interacted) return;
    current.interacted = false;
    nextBeat(current, BEAT_SECONDS, 0);
  }, BEAT_MS);

  // Anything left by an earlier visit or an offline stretch goes now.
  void flushTelemetryQueue();

  return stopSession;
}

/**
 * One "Ask the tutor" click. Written straight away rather than held for the
 * next beat, because a student who asks for help and then leaves must still
 * be counted: HSR is help requests over problems attempted, and a lost click
 * understates it. The beat carries the active seconds since the previous
 * beat, capped at one interval, so that window is counted once and not twice.
 */
export function recordHelpRequest(exerciseKey: string): void {
  const current = session;
  if (!current) return;
  if (exerciseKey && exerciseKey !== current.exerciseKey) return;
  const elapsed = Math.round((Date.now() - current.lastBeatAt) / 1000);
  current.interacted = false;
  nextBeat(current, Math.max(0, Math.min(BEAT_SECONDS, elapsed)), 1);
  void flushTelemetryQueue();
}
