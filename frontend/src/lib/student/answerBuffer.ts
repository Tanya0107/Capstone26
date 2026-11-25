/**
 * NFR7 answer buffering for the student workspace (Step 4.4).
 *
 * Two different things are buffered here and they are buffered for two
 * different reasons.
 *
 * A draft is the text in the answer box. It belongs to the student and to
 * this device, and it is written on every change so that a reload, a closed
 * tab or a flat battery does not cost a child their work. Nothing sends a
 * draft anywhere. The schema of Fig 4 has no collection for answer text and
 * Step 4.4 asks for localStorage buffering, so the draft stays local by
 * design rather than by omission. See docs/OPEN_QUESTIONS.md Q14.
 *
 * A pending update is a submitted answer whose progress write has not been
 * acknowledged by the server yet. The Firestore SDK already retries such a
 * write, but its queue lives in memory, so a reload while offline loses it
 * silently and the student's progress quietly goes backwards. This queue is
 * the durable copy, and because a progress document has a derived id and
 * holds a monotonic counter, replaying an entry is safe and collapsing two
 * entries for the same assignment to the later one is correct.
 *
 * Every access is wrapped. Storage throws rather than returns empty in a
 * private window, with site data blocked, and inside some embedded
 * webviews, and a student who cannot buffer must still be able to work.
 */

const DRAFT_PREFIX = "enrichment:answer:";
const QUEUE_KEY = "enrichment:pending-progress";

export interface PendingProgress {
  assignmentKey: string;
  studentKey: string;
  currentExerciseOrder: number;
  isCompleted: boolean;
  /** Client clock, for ordering the queue only. Never written to Firestore. */
  queuedAt: number;
}

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function draftKey(assignmentKey: string, exerciseKey: string): string {
  return `${DRAFT_PREFIX}${assignmentKey}:${exerciseKey}`;
}

/** True when drafts can actually be kept, which the UI has to be honest about. */
export function bufferingAvailable(): boolean {
  const storage = store();
  if (!storage) return false;
  try {
    const probe = `${DRAFT_PREFIX}probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readAnswerDraft(assignmentKey: string, exerciseKey: string): string {
  const storage = store();
  if (!storage) return "";
  try {
    return storage.getItem(draftKey(assignmentKey, exerciseKey)) ?? "";
  } catch {
    return "";
  }
}

export function writeAnswerDraft(
  assignmentKey: string,
  exerciseKey: string,
  text: string,
): void {
  const storage = store();
  if (!storage) return;
  try {
    if (text) storage.setItem(draftKey(assignmentKey, exerciseKey), text);
    else storage.removeItem(draftKey(assignmentKey, exerciseKey));
  } catch {
    // A full or blocked quota must not break typing.
  }
}

/**
 * Drafts survive submission on purpose. A student who sent an answer and
 * then wants to look at what they wrote should find it, and the exercise
 * stays readable after the unit is done.
 */
export function clearAnswerDraft(assignmentKey: string, exerciseKey: string): void {
  writeAnswerDraft(assignmentKey, exerciseKey, "");
}

function entryKey(entry: Pick<PendingProgress, "assignmentKey" | "studentKey">): string {
  return `${entry.assignmentKey}__${entry.studentKey}`;
}

export function readQueue(): PendingProgress[] {
  const storage = store();
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PendingProgress =>
        Boolean(entry) &&
        typeof entry.assignmentKey === "string" &&
        typeof entry.studentKey === "string" &&
        typeof entry.currentExerciseOrder === "number",
    );
  } catch {
    // Corrupt or foreign content in the slot is discarded rather than thrown.
    return [];
  }
}

function writeQueue(entries: PendingProgress[]): void {
  const storage = store();
  if (!storage) return;
  try {
    if (entries.length === 0) storage.removeItem(QUEUE_KEY);
    else storage.setItem(QUEUE_KEY, JSON.stringify(entries));
  } catch {
    // Nothing better to do here. The Firestore in-memory retry still runs.
  }
}

/**
 * Record the intent to advance, keeping only the furthest order per
 * assignment. Returns the queue as it now stands so a caller can show how
 * many submissions are still unacknowledged.
 */
export function queueProgress(entry: Omit<PendingProgress, "queuedAt">): PendingProgress[] {
  const next: PendingProgress = { ...entry, queuedAt: Date.now() };
  const current = readQueue();
  const others = current.filter((existing) => entryKey(existing) !== entryKey(next));
  const previous = current.find((existing) => entryKey(existing) === entryKey(next));
  const merged: PendingProgress = previous
    ? {
        ...next,
        currentExerciseOrder: Math.max(
          previous.currentExerciseOrder,
          next.currentExerciseOrder,
        ),
        isCompleted: previous.isCompleted || next.isCompleted,
      }
    : next;
  const queue = [...others, merged];
  writeQueue(queue);
  return queue;
}

export function dequeueProgress(
  entry: Pick<PendingProgress, "assignmentKey" | "studentKey">,
): PendingProgress[] {
  const queue = readQueue().filter((existing) => entryKey(existing) !== entryKey(entry));
  writeQueue(queue);
  return queue;
}

/**
 * Replay queued updates through send, dropping each one that is accepted.
 * An entry that fails stays queued, so the next flush tries again. Flushes
 * run on mount and when the browser reports it is back online.
 */
export async function flushQueue(
  send: (entry: PendingProgress) => Promise<void>,
): Promise<{ sent: number; left: number }> {
  let sent = 0;
  for (const entry of readQueue()) {
    try {
      await send(entry);
      dequeueProgress(entry);
      sent += 1;
    } catch {
      // Still offline or still refused. Keep it and stop pushing.
      break;
    }
  }
  return { sent, left: readQueue().length };
}
