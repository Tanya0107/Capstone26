/** Teacher surface UI strings, Hebrew per D5 and R10. */
export const strings = {
  // Goals Enrichment Screen (FR1, book Fig 6)
  goalsTitle: "יצירת יחידת העשרה",
  goalsIntro:
    "תארו את מטרות ההעשרה והמערכת תבנה יחידה מלאה: רצף שבועי, שיעורים, תרגילים והערכה.",

  subjectLabel: "מקצוע",
  subjectPlaceholder: "בחרו מקצוע",
  subjectTypeQuantitative: "מקצוע חישובי",
  subjectTypeOpenEnded: "מקצוע עיוני",
  subjectDraftCorpus: "מאגר התקנים למקצוע זה עדיין בטיוטה ומחכה לאימות",

  gradeLabel: "כיתה",
  gradePlaceholder: "בחרו כיתה",
  gradeNeedsSubject: "בחרו מקצוע כדי לראות את הכיתות הזמינות",

  goalsLabel: "מטרות ההעשרה",
  goalsHint: "לדוגמה: להעמיק את תחושת השבר דרך הקשרים מהחיים",

  topicsLabel: "נושאים",
  topicsHint: "הקלידו נושא והקישו Enter להוספה",
  topicsAdd: "הוספה",
  topicsRemove: "הסרת הנושא",
  topicsEmpty: "לא נבחרו נושאים. אפשר להמשיך בלעדיהם.",

  difficultyLabel: "רמת קושי",
  difficultyHint: "1 היא הרמה הבסיסית, 5 היא המאתגרת",

  standardsHintLabel: "הנחיה לגבי תקנים",
  standardsHintOptional: "אופציונלי",
  standardsHintHint: "אם יש תקן או נושא מתוכנית הלימודים שחייב להופיע, כתבו אותו כאן",

  submit: "בנו את היחידה",
  submitting: "בונה...",

  // Validation, mirrors GenerationRequest
  errorSubjectRequired: "יש לבחור מקצוע",
  errorGradeRequired: "יש לבחור כיתה",
  errorGradeUnavailable: "הכיתה הזו אינה נתמכת במקצוע שנבחר",
  errorGoalsRequired: "יש לתאר את מטרות ההעשרה",
  errorDifficultyRange: "רמת הקושי חייבת להיות בין 1 ל-5",

  // Catalog loading
  catalogLoading: "טוען מקצועות...",
  catalogFailed: "לא ניתן לטעון את רשימת המקצועות",
  catalogRetry: "נסו שוב",
  catalogEmpty: "אין מקצועות זמינים ליצירה כרגע",

  // NFR7 degradation
  errorTimeoutTitle: "היצירה חרגה ממסגרת הזמן",
  errorTimeoutBody:
    "הפרטים שמילאתם נשמרו. אפשר לנסות שוב, או לצמצם את מספר הנושאים ולהוריד את רמת הקושי כדי לקצר את התהליך.",
  errorForbiddenTitle: "אין הרשאה ליצירה",
  errorForbiddenBody: "התחברו מחדש ונסו שוב.",
  errorValidationTitle: "הבקשה נדחתה",
  errorNetworkTitle: "התקשורת עם השרת נכשלה",
  errorNetworkBody: "הפרטים שמילאתם נשמרו. בדקו את החיבור ונסו שוב.",
  errorServerTitle: "שגיאה בשרת",
  errorServerBody: "הפרטים שמילאתם נשמרו. אפשר לנסות שוב.",
  errorRetry: "נסו שוב",
  errorDismiss: "חזרה לטופס",
} as const;
