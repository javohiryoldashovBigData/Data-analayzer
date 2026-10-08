export type Lang = "uz" | "ru" | "en";
export type L10n = Record<Lang, string>;

export type Role = "director" | "teacher" | "student" | "parent";

export interface Subject {
  id: string;
  name: L10n;
  color: string;
  icon: string;
}

export interface Teacher {
  id: string;
  name: string;
  subjectIds: string[];
  homeroomClassId?: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  homeroomTeacherId: string;
}

export interface Student {
  id: string;
  name: string;
  classId: string;
  parentId: string;
  cardCode: string;
}

export interface Parent {
  id: string;
  name: string;
  phone: string;
  childIds: string[];
  channels: { app: boolean; telegram: boolean; sms: boolean };
}

/** One slot in the weekly timetable. day: 1 = Monday … 6 = Saturday. */
export interface Lesson {
  id: string;
  classId: string;
  day: number;
  period: number;
  subjectId: string;
  teacherId: string;
  room: string;
}

export type GradeKind = "oral" | "written" | "test" | "homework" | "weekly" | "exam";

export interface Grade {
  id: string;
  studentId: string;
  subjectId: string;
  date: string;
  value: number;
  kind: GradeKind;
  teacherId: string;
  comment?: string;
  aiSuggested?: boolean;
}

export type AttendanceStatus = "absent" | "late" | "excused";

/** Only non-present marks are stored; no record means the student was present. */
export interface LessonMark {
  id: string;
  studentId: string;
  date: string;
  lessonId: string;
  status: AttendanceStatus;
}

export interface GateEvent {
  id: string;
  studentId: string;
  date: string;
  time: string;
  type: "in" | "out";
}

export type AbsenceReason = "sick" | "doctor" | "family" | "other";

export interface AbsenceReport {
  id: string;
  studentId: string;
  parentId: string;
  date: string;
  reason: AbsenceReason;
  note: string;
  until?: string;
  status: "pending" | "accepted";
  createdAt: string;
}

export interface Homework {
  id: string;
  classId: string;
  subjectId: string;
  date: string;
  text: string;
  /** studentId -> submitted */
  done: Record<string, boolean>;
}

export interface LessonTopic {
  classId: string;
  subjectId: string;
  date: string;
  topic: string;
}

export type NotificationKind =
  | "arrived"
  | "late"
  | "left"
  | "notArrived"
  | "skipped"
  | "grade"
  | "absenceReported"
  | "absenceAccepted"
  | "testFlag";

export interface AppNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  params: Record<string, string>;
  createdAt: string;
  read: boolean;
}

export interface Question {
  id: string;
  type: "mcq" | "short";
  text: L10n;
  options?: L10n[];
  /** mcq: index of the right option; short: keywords that a good answer contains */
  answer: number | string[];
  /** model answer / explanation shown after the test */
  explain: L10n;
  topic: L10n;
  difficulty: 1 | 2 | 3;
}

export interface WeeklyTest {
  id: string;
  classId: string;
  subjectId: string;
  weekStart: string;
  title: L10n;
  questionIds: string[];
  status: "open" | "closed";
  createdBy: "ai" | "teacher";
}

export type FlagKind = "similar" | "samePattern" | "levelJump" | "tooFast" | "paste" | "leftWindow" | "followUpWeak";

export interface IntegrityFlag {
  kind: FlagKind;
  detail: Record<string, string>;
  weight: number;
}

export interface TestAttempt {
  id: string;
  testId: string;
  studentId: string;
  /** order of questions shown to this student */
  order: string[];
  /** per-question option order (mcq only), questionId -> shuffled option indices */
  optionOrder: Record<string, number[]>;
  answers: Record<string, number | string>;
  seconds: Record<string, number>;
  pasteCount: number;
  blurCount: number;
  submittedAt: string;
  score: number;
  maxScore: number;
  followUp?: { questionId: string; prompt: string; answer: string; verdict: "ok" | "weak" | "pending"; note?: string };
  review?: "ok" | "suspicious";
}

export interface Settings {
  apiKey: string;
  schoolStart: string;
  lateAfter: string;
}

export interface DB {
  version: number;
  seededOn: string;
  schoolName: string;
  subjects: Subject[];
  teachers: Teacher[];
  classes: SchoolClass[];
  students: Student[];
  parents: Parent[];
  lessons: Lesson[];
  grades: Grade[];
  marks: LessonMark[];
  gate: GateEvent[];
  absences: AbsenceReport[];
  homework: Homework[];
  topics: LessonTopic[];
  notifications: AppNotification[];
  questions: Question[];
  tests: WeeklyTest[];
  attempts: TestAttempt[];
  settings: Settings;
}

export interface Session {
  role: Role;
  id: string;
}
