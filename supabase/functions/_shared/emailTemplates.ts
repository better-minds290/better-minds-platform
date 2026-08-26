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

function optionalCourse(courseName?: string): { vi: string; en: string } {
  const name = (courseName || "").trim();
  if (!name) return { vi: "", en: "" };
  const safe = field(name);
  return { vi: ` (${safe})`, en: ` (${safe})` };
}

function durationPhrase(minutes?: number): { vi: string; en: string } {
  if (!minutes || minutes <= 0 || !Number.isFinite(minutes)) return { vi: "", en: "" };
  const n = Math.round(minutes);
  return { vi: ` (${n} phút)`, en: ` (${n} min)` };
}

function meetingBlock(meetingLink?: string): { vi: string; en: string } {
  const link = (meetingLink || "").trim();
  if (!link) {
    return {
      vi: "<p>Link họp sẽ được gửi trong ứng dụng nếu có.</p>",
      en: "<p>The meeting link will be available in the app if provided.</p>",
    };
  }
  const safe = field(link);
  const isHttp = /^https?:\/\//i.test(link);
  if (!isHttp) {
    return {
      vi: `<p>Link họp: ${safe}</p>`,
      en: `<p>Meeting link: ${safe}</p>`,
    };
  }
  return {
    vi: `<p>Link họp: <a href="${safe}">${safe}</a></p>`,
    en: `<p>Meeting link: <a href="${safe}">${safe}</a></p>`,
  };
}

function wrapBilingual(args: {
  headingVi: string;
  headingEn: string;
  bodyVi: string;
  bodyEn: string;
}): string {
  return (
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">' +
    `<div style="background:#f0f9f0;border-radius:12px;padding:20px 24px">` +
    `<p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#166534">${args.headingVi}</p>` +
    `<p style="margin:0;font-size:14px;color:#166534">${args.headingEn}</p>` +
    "</div>" +
    `<div lang="vi" style="padding:20px 0 8px">${args.bodyVi}</div>` +
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:8px 0">' +
    `<div lang="en" style="padding:8px 0 0">${args.bodyEn}</div>` +
    '<p style="font-size:13px;color:#888;margin:16px 0 0">— Better Minds</p>' +
    "</div>"
  );
}

function renderMissedBooking(data: MissedBookingData): RenderedEmail {
  const name = field(data.learner_name);
  const sessionsVi = field(data.late_sessions_vi);
  const sessionsEn = field(data.late_sessions_en);
  const sprint = field(data.sprint_number);
  const course = optionalCourse(data.course_name);
  return {
    template: "missed_booking",
    subject:
      "Nhắc lịch đăng ký — Admin sẽ hỗ trợ xếp lớp / Booking reminder — Admin will help arrange your class",
    html: wrapBilingual({
      headingVi: "Nhắc nhở đăng ký lớp",
      headingEn: "Booking reminder",
      bodyVi:
        `<p>Chào ${name},</p>` +
        `<p>Cửa sổ đăng ký Chủ nhật đã kết thúc. ${sessionsVi} trong Sprint ${sprint}${course.vi} chưa được đặt.</p>` +
        "<p>Admin sẽ xếp lớp giúp bạn. Vui lòng theo dõi email để nhận lịch học.</p>",
      bodyEn:
        `<p>Hi ${name},</p>` +
        `<p>Sunday booking has closed. ${sessionsEn} in Sprint ${sprint}${course.en} still need a class.</p>` +
        "<p>Admin will arrange a class for you. Please watch your email for the assignment.</p>",
    }),
  };
}

function renderAssignmentLearner(data: ClassAssignmentData): RenderedEmail {
  const learner = field(data.learner_name);
  const teacher = field(data.teacher_name);
  const session = field(data.session_number);
  const sprint = field(data.sprint_number);
  const date = field(data.class_date);
  const start = field(data.start_time);
  const end = field(data.end_time);
  const course = optionalCourse(data.course_name);
  const meeting = meetingBlock(data.meeting_link);
  const duration = durationPhrase(data.duration_minutes);
  const group = !!data.added_to_existing_class;
  const whenVi = `${date}, ${start}–${end}${duration.vi}`;
  const whenEn = `${date}, ${start}–${end}${duration.en}`;
  const detailVi = group
    ? `<p>Bạn đã được xếp vào lớp hiện có với ${teacher}, Buổi ${session}, Sprint ${sprint}${course.vi} vào ${whenVi}.</p>`
    : `<p>Bạn đã được xếp với ${teacher}, Buổi ${session}, Sprint ${sprint}${course.vi} vào ${whenVi}.</p>`;
  const detailEn = group
    ? `<p>You have been added to an existing class with ${teacher} for Session ${session}, Sprint ${sprint}${course.en} on ${whenEn}.</p>`
    : `<p>You are booked with ${teacher} for Session ${session}, Sprint ${sprint}${course.en} on ${whenEn}.</p>`;
  return {
    template: "class_assignment_learner",
    subject: group
      ? `Đã xếp vào lớp — Buổi ${session} / Added to class — Session ${session}`
      : `Đã xếp lớp — Buổi ${session} / Your class is scheduled — Session ${session}`,
    html: wrapBilingual({
      headingVi: group ? "Bạn đã được xếp vào lớp" : "Lịch học đã được xếp",
      headingEn: group ? "You've been added to a class" : "Your class is scheduled",
      bodyVi:
        `<p>Chào ${learner},</p>` +
        detailVi +
        meeting.vi +
        "<p>Vui lòng chuẩn bị bài và vào đúng giờ.</p>",
      bodyEn:
        `<p>Hi ${learner},</p>` +
        detailEn +
        meeting.en +
        "<p>Please prepare for the lesson and join on time.</p>",
    }),
  };
}

function renderAssignmentTeacher(data: ClassAssignmentData): RenderedEmail {
  const learner = field(data.learner_name);
  const teacher = field(data.teacher_name);
  const session = field(data.session_number);
  const sprint = field(data.sprint_number);
  const date = field(data.class_date);
  const start = field(data.start_time);
  const end = field(data.end_time);
  const course = optionalCourse(data.course_name);
  const meeting = meetingBlock(data.meeting_link);
  const duration = durationPhrase(data.duration_minutes);
  const group = !!data.added_to_existing_class;
  const whenVi = `${date}, ${start}–${end}${duration.vi}`;
  const whenEn = `${date}, ${start}–${end}${duration.en}`;
  const detailVi = group
    ? `<p>${learner} đã được xếp thêm vào lớp hiện có của bạn, Buổi ${session}, Sprint ${sprint}${course.vi} vào ${whenVi}.</p>`
    : `<p>${learner} đã được xếp vào Buổi ${session}, Sprint ${sprint}${course.vi} vào ${whenVi}.</p>`;
  const detailEn = group
    ? `<p>${learner} has been added to your existing class for Session ${session}, Sprint ${sprint}${course.en} on ${whenEn}.</p>`
    : `<p>${learner} is in your Session ${session}, Sprint ${sprint}${course.en} on ${whenEn}.</p>`;
  return {
    template: "class_assignment_teacher",
    subject: `Học viên mới — ${learner} / New learner assigned — ${learner}`,
    html: wrapBilingual({
      headingVi: group ? "Học viên mới được xếp vào lớp hiện có" : "Học viên mới được xếp vào lớp",
      headingEn: group ? "Learner added to your class" : "New learner assigned",
      bodyVi:
        `<p>Chào ${teacher},</p>` +
        detailVi +
        meeting.vi +
        "<p>Vui lòng chuẩn bị bài và bắt đầu đúng giờ.</p>",
      bodyEn:
        `<p>Hello ${teacher},</p>` +
        detailEn +
        meeting.en +
        "<p>Please prepare for the lesson and start on time.</p>",
    }),
  };
}

function renderAbsence(data: AbsenceRecordedData): RenderedEmail {
  const name = field(data.learner_name);
  const session = field(data.session_number);
  const sprint = field(data.sprint_number);
  const count = field(data.absence_count);
  const limit = field(data.absence_limit);
  const course = optionalCourse(data.course_name);
  const countNum = Number(data.absence_count);
  const limitNum = Number(data.absence_limit);
  const atLimit = Number.isFinite(countNum) && Number.isFinite(limitNum) && countNum >= limitNum;
  const date = (data.class_date || "").trim();
  const time = (data.class_time || "").trim();
  const whenRaw = [date, time].filter(Boolean).join(", ");
  const when = whenRaw
    ? {
        vi: `<p>Thời gian lớp: ${field(whenRaw)}.</p>`,
        en: `<p>Class time: ${field(whenRaw)}.</p>`,
      }
    : { vi: "", en: "" };
  const followUpVi = atLimit
    ? "<p>Bạn đã đạt giới hạn vắng học. Vui lòng liên hệ Admin để được hỗ trợ.</p>"
    : "<p>Đi học đều đặn giúp bạn và giáo viên. Vui lòng theo dõi lịch học sắp tới.</p>";
  const followUpEn = atLimit
    ? "<p>You have reached the absence limit. Please contact Admin for follow-up.</p>"
    : "<p>Regular attendance helps you and your teachers. Please watch your upcoming classes.</p>";
  return {
    template: "absence_recorded",
    subject: `Đã ghi nhận vắng học — ${count}/${limit} / Absence recorded — ${count}/${limit}`,
    html: wrapBilingual({
      headingVi: atLimit ? "Đã đạt giới hạn vắng học" : "Đã ghi nhận vắng học",
      headingEn: atLimit ? "Absence limit reached" : "Absence recorded",
      bodyVi:
        `<p>Chào ${name},</p>` +
        `<p>Buổi vắng (Buổi ${session}, Sprint ${sprint}${course.vi}) đã được ghi nhận.</p>` +
        when.vi +
        `<p>Tổng vắng khóa này: ${count}/${limit}.</p>` +
        followUpVi,
      bodyEn:
        `<p>Hi ${name},</p>` +
        `<p>An absence was recorded for Session ${session}, Sprint ${sprint}${course.en}.</p>` +
        when.en +
        `<p>Cumulative absences this course: ${count}/${limit}.</p>` +
        followUpEn,
    }),
  };
}

function renderCancelled(data: ClassCancelledTeacherUnavailableData): RenderedEmail {
  const learner = field(data.learner_name);
  const teacher = field(data.teacher_name);
  const session = field(data.session_number);
  const date = field(data.class_date);
  const sprintRaw = data.sprint_number != null && String(data.sprint_number).trim() !== ""
    ? field(data.sprint_number)
    : "";
  const sprintVi = sprintRaw ? `, Sprint ${sprintRaw}` : "";
  const sprintEn = sprintRaw ? `, Sprint ${sprintRaw}` : "";
  const course = optionalCourse(data.course_name);
  const start = (data.start_time || "").trim();
  const end = (data.end_time || "").trim();
  const timeRaw = start && end ? `${start}–${end}` : start || end;
  const timeVi = timeRaw ? `, ${field(timeRaw)}` : "";
  const timeEn = timeRaw ? `, ${field(timeRaw)}` : "";
  const canReply = !!data.reply_to_configured;
  const followVi = canReply
    ? "<p>Hãy trả lời email này nếu bạn muốn học bù (ghi rõ buổi). Admin sẽ sắp xếp nếu còn thời gian và chỗ trống.</p>"
    : "<p>Hãy liên hệ Admin Better Minds nếu bạn muốn học bù (ghi rõ buổi). Admin sẽ sắp xếp nếu còn thời gian và chỗ trống.</p>";
  const followEn = canReply
    ? "<p>Reply to this email if you want a makeup class (include the session). Admin will try to arrange it if time and availability allow.</p>"
    : "<p>Contact Better Minds Admin if you want a makeup class (include the session). Admin will try to arrange it if time and availability allow.</p>";
  return {
    template: "class_cancelled_teacher_unavailable",
    subject: "Lớp đã hủy — có thể yêu cầu học bù / Class cancelled — makeup available",
    html: wrapBilingual({
      headingVi: "Lớp đã hủy",
      headingEn: "Class cancelled",
      bodyVi:
        `<p>Chào ${learner},</p>` +
        `<p>Buổi ${session}${sprintVi}${course.vi} với ${teacher} ngày ${date}${timeVi} đã bị hủy vì giáo viên đột xuất bận lịch. Chúng tôi xin lỗi vì sự bất tiện này.</p>` +
        followVi,
      bodyEn:
        `<p>Hi ${learner},</p>` +
        `<p>Session ${session}${sprintEn}${course.en} with ${teacher} on ${date}${timeEn} was cancelled because the teacher has an unexpected schedule conflict. We apologize for the inconvenience.</p>` +
        followEn,
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
