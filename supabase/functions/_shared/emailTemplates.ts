/**
 * Canonical transactional email templates.
 * Runtime + tests: supabase/functions/_shared/emailTemplates.ts
 * Do not copy this into src/lib.
 */
import { escapeHtml } from "./htmlEscape.ts";

export const EMAIL_TEMPLATE_IDS = [
  "missed_booking",
  "class_assignment_learner",
  "class_assignment_teacher",
  "absence_recorded",
  "class_cancelled_teacher_unavailable",
] as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number];

export interface MissedBookingData {
  learner_name: string;
  late_sessions_vi: string;
  late_sessions_en: string;
  sprint_number: string | number;
  course_name?: string;
}

export interface ClassAssignmentData {
  learner_name: string;
  teacher_name: string;
  session_number: string | number;
  sprint_number: string | number;
  class_date: string;
  start_time: string;
  end_time: string;
  course_name?: string;
  meeting_link?: string;
  added_to_existing_class?: boolean;
  duration_minutes?: number;
}

export interface AbsenceRecordedData {
  learner_name: string;
  session_number: string | number;
  sprint_number: string | number;
  absence_count: string | number;
  absence_limit: string | number;
  course_name?: string;
  class_date?: string;
  class_time?: string;
}

export interface ClassCancelledTeacherUnavailableData {
  learner_name: string;
  teacher_name: string;
  session_number: string | number;
  class_date: string;
  sprint_number?: string | number;
  course_name?: string;
  start_time?: string;
  end_time?: string;
  reply_to_configured?: boolean;
}

export type EmailTemplateDataMap = {
  missed_booking: MissedBookingData;
  class_assignment_learner: ClassAssignmentData;
  class_assignment_teacher: ClassAssignmentData;
  absence_recorded: AbsenceRecordedData;
  class_cancelled_teacher_unavailable: ClassCancelledTeacherUnavailableData;
};

export interface RenderedEmail {
  template: EmailTemplateId;
  subject: string;
  html: string;
}

function field(value: unknown): string {
  return escapeHtml(value);
}

function optionalText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function optionalCourseSuffix(courseName?: string): string {
  const name = (courseName || "").trim();
  if (!name) return "";
  return ` (${field(name)})`;
}

function durationLabel(minutes?: number): string {
  if (!minutes || minutes <= 0 || !Number.isFinite(minutes)) return "";
  return `${Math.round(minutes)} min`;
}

function classTimeRange(start?: string, end?: string): string {
  const startText = optionalText(start);
  const endText = optionalText(end);
  if (startText && endText) return `${startText}–${endText}`;
  return startText || endText;
}

function detailList(items: Array<{ label: string; value?: unknown }>): string {
  const rows = items
    .map((item) => {
      const value = optionalText(item.value);
      if (!value) return "";
      return `<li>${field(item.label)}: ${field(value)}</li>`;
    })
    .filter(Boolean);
  if (rows.length === 0) return "";
  return `<ul style="padding-left:20px;margin:12px 0">${rows.join("")}</ul>`;
}

function meetingBlock(meetingLink?: string): string {
  const link = (meetingLink || "").trim();
  if (!link) {
    return "<p>The meeting link is not available yet. Please check the app again before your class.</p>";
  }
  const safe = field(link);
  const isHttp = /^https?:\/\//i.test(link);
  if (!isHttp) {
    return `<p>Meeting link: ${safe}</p>`;
  }
  return `<p>Meeting link: <a href="${safe}">${safe}</a></p>`;
}

function wrapEnglish(args: { heading: string; body: string }): string {
  return (
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">' +
    `<div style="background:#f0f9f0;border-radius:12px;padding:20px 24px">` +
    `<p style="margin:0;font-size:18px;font-weight:700;color:#166534">${args.heading}</p>` +
    "</div>" +
    `<div lang="en" style="padding:20px 0 8px">${args.body}</div>` +
    '<p style="font-size:13px;color:#888;margin:16px 0 0">Best,<br>Better Minds Team</p>' +
    "</div>"
  );
}

function isPluralLateSessions(label: string): boolean {
  return /\band\b/i.test(label.trim());
}

function renderMissedBooking(data: MissedBookingData): RenderedEmail {
  const name = field(data.learner_name);
  const sessions = field(data.late_sessions_en);
  const sprint = field(data.sprint_number);
  const course = optionalCourseSuffix(data.course_name);
  const verb = isPluralLateSessions(data.late_sessions_en || "")
    ? "still need to be scheduled"
    : "still needs to be scheduled";
  return {
    template: "missed_booking",
    subject: "Booking missed — Admin will help arrange your class",
    html: wrapEnglish({
      heading: "Booking Reminder",
      body:
        `<p>Hi ${name},</p>` +
        `<p>The Sunday booking window has closed, and ${sessions} in Sprint ${sprint}${course} ${verb}.</p>` +
        "<p>Our Admin team will help find and arrange a suitable class for you. If a suitable class is arranged, you will receive another email with the class details.</p>" +
        "<p>Please keep an eye on your email for the class assignment.</p>",
    }),
  };
}

function assignmentDetails(data: ClassAssignmentData, includeDuration: boolean): string {
  return detailList([
    { label: "Session", value: data.session_number },
    { label: "Sprint", value: data.sprint_number },
    { label: "Course", value: data.course_name },
    { label: "Date", value: data.class_date },
    { label: "Time", value: classTimeRange(data.start_time, data.end_time) },
    ...(includeDuration ? [{ label: "Duration", value: durationLabel(data.duration_minutes) }] : []),
  ]);
}

function renderAssignmentLearner(data: ClassAssignmentData): RenderedEmail {
  const learner = field(data.learner_name);
  const teacher = field(data.teacher_name);
  const session = field(data.session_number);
  const group = !!data.added_to_existing_class;
  const intro = group
    ? `<p>You've been added to an existing class with ${teacher}.</p>`
    : `<p>Your class has been scheduled with ${teacher}.</p>`;
  return {
    template: "class_assignment_learner",
    subject: group
      ? `You've been added to a class — Session ${session}`
      : `Your class is scheduled — Session ${session}`,
    html: wrapEnglish({
      heading: group ? "You've been added to a class" : "Your class is scheduled",
      body:
        `<p>Hi ${learner},</p>` +
        intro +
        assignmentDetails(data, true) +
        meetingBlock(data.meeting_link) +
        "<p>Please review the class details, prepare for the lesson, and join on time.</p>",
    }),
  };
}

function renderAssignmentTeacher(data: ClassAssignmentData): RenderedEmail {
  const learner = field(data.learner_name);
  const teacher = field(data.teacher_name);
  const group = !!data.added_to_existing_class;
  const intro = group
    ? `<p>${learner} has been added to your existing class.</p>`
    : `<p>${learner} has been assigned to your class.</p>`;
  return {
    template: "class_assignment_teacher",
    subject: `New learner assigned — ${learner}`,
    html: wrapEnglish({
      heading: group ? "Learner added to your class" : "New learner assigned",
      body:
        `<p>Hi ${teacher},</p>` +
        intro +
        assignmentDetails(data, false) +
        meetingBlock(data.meeting_link) +
        "<p>Please review the class details and prepare for the session.</p>",
    }),
  };
}

function renderAbsence(data: AbsenceRecordedData): RenderedEmail {
  const name = field(data.learner_name);
  const count = field(data.absence_count);
  const limit = field(data.absence_limit);
  const countNum = Number(data.absence_count);
  const limitNum = Number(data.absence_limit);
  const atLimit = Number.isFinite(countNum) && Number.isFinite(limitNum) && countNum >= limitNum;
  const classTime = [optionalText(data.class_date), optionalText(data.class_time)].filter(Boolean).join(", ");
  const details = detailList([
    { label: "Session", value: data.session_number },
    { label: "Sprint", value: data.sprint_number },
    { label: "Course", value: data.course_name },
    { label: "Class time", value: classTime },
  ]);
  const recorded = details
    ? "<p>An absence has been recorded for the following class:</p>" + details
    : "<p>An absence has been recorded.</p>";
  const followUp = atLimit
    ? "<p>You have reached the absence limit for this course. Please contact Better Minds Admin for further assistance.</p>"
    : "<p>Regular attendance is important for making steady progress in the course. Please make sure to attend your upcoming classes whenever possible.</p>";
  return {
    template: "absence_recorded",
    subject: `Absence recorded — ${count}/${limit}`,
    html: wrapEnglish({
      heading: atLimit ? "Absence limit reached" : "Absence recorded",
      body:
        `<p>Hi ${name},</p>` +
        recorded +
        `<p>Total recorded absences: ${count}/${limit}.</p>` +
        followUp,
    }),
  };
}

function renderCancelled(data: ClassCancelledTeacherUnavailableData): RenderedEmail {
  const learner = field(data.learner_name);
  const canReply = !!data.reply_to_configured;
  const requestLine = canReply
    ? "<p>Please reply to this email to request one.</p>"
    : "<p>Please contact Better Minds Admin to request a makeup class.</p>";
  const details = detailList([
    { label: "Teacher", value: data.teacher_name },
    { label: "Session", value: data.session_number },
    { label: "Sprint", value: data.sprint_number },
    { label: "Course", value: data.course_name },
    { label: "Date", value: data.class_date },
    { label: "Time", value: classTimeRange(data.start_time, data.end_time) },
  ]);
  return {
    template: "class_cancelled_teacher_unavailable",
    subject: "Class cancelled — You can request a makeup class",
    html: wrapEnglish({
      heading: "Class cancelled",
      body:
        `<p>Hi ${learner},</p>` +
        "<p>Unfortunately, your class has been cancelled because your teacher is unavailable.</p>" +
        details +
        "<p>You can request a makeup class for this session.</p>" +
        requestLine +
        "<p>Our Admin team will try to arrange a suitable replacement class based on teacher and schedule availability.</p>" +
        "<p>We apologize for the inconvenience.</p>",
    }),
  };
}

export function isEmailTemplateId(value: string): value is EmailTemplateId {
  return (EMAIL_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function renderEmailTemplate<K extends EmailTemplateId>(
  template: K,
  data: EmailTemplateDataMap[K]
): RenderedEmail {
  switch (template) {
    case "missed_booking":
      return renderMissedBooking(data as MissedBookingData);
    case "class_assignment_learner":
      return renderAssignmentLearner(data as ClassAssignmentData);
    case "class_assignment_teacher":
      return renderAssignmentTeacher(data as ClassAssignmentData);
    case "absence_recorded":
      return renderAbsence(data as AbsenceRecordedData);
    case "class_cancelled_teacher_unavailable":
      return renderCancelled(data as ClassCancelledTeacherUnavailableData);
    default: {
      const _never: never = template;
      throw new Error(`Unknown email template: ${_never}`);
    }
  }
}
