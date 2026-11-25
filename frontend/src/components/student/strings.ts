/** Student surface UI strings, Hebrew per D5 and R10. */
export const strings = {
  // Dashboard (FR9, book Fig 8)
  dashTitle: "המשימות שלי",
  dashIntro: "כאן מופיעות יחידות ההעשרה שהמורה שלכם שלח. יחידה חדשה מופיעה מעצמה, בלי לרענן את הדף.",
  dashLoading: "טוען את המשימות...",
  dashErrorTitle: "לא ניתן לטעון את המשימות",
  dashRetry: "נסו שוב",
  dashEmptyTitle: "אין משימות כרגע",
  dashEmptyBody: "ברגע שהמורה יפרסם יחידת העשרה היא תופיע כאן מעצמה.",
  dashCount: "משימות",

  // Assignment card
  cardStart: "התחילו",
  cardContinue: "המשיכו מכאן",
  cardReview: "חזרו ליחידה",
  cardDone: "הושלמה",
  cardInProgress: "בעבודה",
  cardNew: "חדשה",
  cardGrade: "כיתה",
  cardExercises: "תרגילים",
  cardLessons: "שיעורים",
  cardDifficulty: "רמת קושי",
  cardProgressLabel: "התקדמות",
  cardProgressOf: "מתוך",
  cardMissing: "היחידה של המשימה הזו עדיין נטענת",

  // Workspace (FR10, book Fig 9)
  wsLoading: "טוען את היחידה...",
  wsNotFoundTitle: "המשימה לא נמצאה",
  wsNotFoundBody: "ייתכן שהמורה הסיר אותה. חזרו לרשימת המשימות.",
  wsForbiddenTitle: "המשימה הזו לא שייכת לכם",
  wsForbiddenBody: "אפשר לפתוח רק משימות שהמורה שלח אליכם.",
  wsErrorTitle: "משהו השתבש בטעינת היחידה",
  wsEmptyTitle: "ביחידה הזו אין עדיין תרגילים",
  wsEmptyBody: "חזרו מאוחר יותר, או פנו למורה.",
  wsBackToList: "לרשימת המשימות",
  wsLessonLabel: "שיעור",
  wsExerciseLabel: "תרגיל",
  wsOf: "מתוך",
  wsPrev: "התרגיל הקודם",
  wsNext: "התרגיל הבא",
  wsNextLocked: "כדי להמשיך, שלחו את התשובה לתרגיל הזה",
  wsJumpTo: "מעבר לתרגיל",

  // Answer box (NFR7)
  answerLabel: "התשובה שלי",
  answerPlaceholder: "כתבו כאן את הפתרון ואת הדרך שהגעתם אליו",
  answerSubmit: "שליחת התשובה",
  answerResubmit: "שליחה מחדש",
  answerEmpty: "כתבו תשובה לפני השליחה",
  answerSaved: "התשובה שמורה במחשב הזה",
  answerSavedOff: "הדפדפן הזה לא מאפשר שמירה מקומית, אל תסגרו את החלון לפני השליחה",
  answerSubmitted: "התשובה נשלחה",
  answerPending: "אין חיבור כרגע. התשובה שמורה אצלכם ותישלח כשהחיבור יחזור.",
  answerPendingOne: "שליחה אחת ממתינה לחיבור",
  answerPendingMany: "שליחות ממתינות לחיבור",

  // Scaffolding (FR10 progressive disclosure)
  scaffoldTitle: "צעדים לפתרון",
  scaffoldIntro: "נסו קודם לבד. אם נתקעתם, פתחו צעד אחד בכל פעם.",
  scaffoldReveal: "הציגו את הצעד הבא",
  scaffoldRevealFirst: "הציגו את הצעד הראשון",
  scaffoldHide: "סגרו את הצעדים",
  scaffoldAllShown: "אלו כל הצעדים לתרגיל הזה",
  scaffoldNone: "לתרגיל הזה לא הוגדרו צעדי פתרון",
  scaffoldStep: "צעד",

  // Progress summary (FR13)
  progressTitle: "ההתקדמות שלי",
  progressInUnit: "ביחידה הזו",
  progressSubmitted: "תרגילים שנשלחו",
  progressCompletedTitle: "סיימתם את היחידה",
  progressCompletedBody: "כל התרגילים נשלחו. אפשר לחזור ולקרוא כל תרגיל שוב.",
  progressHistoryTitle: "משימות קודמות",
  progressHistoryEmpty: "זו המשימה הראשונה שלכם כאן",
  progressHistoryDone: "הושלמה",
  progressHistoryOpen: "בעבודה",
  // R1: a learning gain needs a pre test and a post test, which belong to the
  // pilot in Phase 5. This screen shows what was submitted, nothing more.
  progressGainsNote:
    "מדדי שיפור בלמידה נמדדים במבחן לפני היחידה ואחריה, ולכן אינם מוצגים כאן.",
} as const;

/**
 * Subject keys are stored in English because the critic strategy map keys on
 * them (D8). A child should not meet an internal key, so they are labelled
 * here, with the key itself as the fallback for a subject added to the
 * backend before this map catches up.
 */
export const subjectLabels: Record<string, string> = {
  math: "מתמטיקה",
  physics: "פיזיקה",
  science: "מדעים",
  history: "היסטוריה",
  literature: "ספרות",
};

export function subjectLabel(subject: string): string {
  return subjectLabels[subject] ?? subject;
}
