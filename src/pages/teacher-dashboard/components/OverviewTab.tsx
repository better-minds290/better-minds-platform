import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { Link } from "react-router-dom";
import {
  calendarDateToLocalDate,
  formatVietnamDate,
  formatVietnamTime,
  getMondayOfWeek,
  getUiDateLocale,
  toLocalDateStr,
  toVietnamDateStr,
} from "@/lib/datetime";
import {
  buildBookedAvailabilityKeys,
  buildTeachingSessionUnits,
  filterUnbookedAvailabilitySlots,
  summarizeWeeklyBookedTeaching,
} from "@/lib/teacherHours";

interface OverviewTabProps {
  todayStr: string;
}

interface AvailabilitySlot {
  id: string;
  date: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

interface ClassData {
  id: string;
  name: string;
  teacher_id: string;
  subject: string;
  level: string;
  room: string;
  status: string;
  max_students: number;
  created_at: string;
}

interface ScheduleData {
  id: string;
  class_id: string;
  date: string;
  start_time: string;
  end_time: string;
  type: string;
  status: string;
}

interface SprintSession {
  id: string;
  sprint_id: string;
  session_number: number;
  session_type: string;
  teacher_id: string;
  scheduled_at: string | null;
  status: string;
  meeting_link: string | null;
  lesson_summary: string | null;
  sprint_number: number;
  sprint_status: string;
  course_name: string;
  student_name: string;
  learner_id: string;
  class_id: string | null;
}

function groupSprintSessions<T extends { class_id: string | null; session_number: number; session_type: string; scheduled_at: string | null; sprint_number: number; sprint_id: string; id: string }>(
  sessions: T[]
): T[][] {
  const groups = new Map<string, T[]>();
  sessions.forEach((s) => {
    const datePart = s.scheduled_at ? toVietnamDateStr(s.scheduled_at) || "no-date" : "no-date";
    const key = `${s.class_id || `sprint-${s.sprint_id}`}_${s.session_number}_${s.session_type}_${datePart}_${s.sprint_number}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  });
  return Array.from(groups.values());
}

export default function OverviewTab({ todayStr }: OverviewTabProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getUiDateLocale(i18n.language);
  const { profile } = useAuth();
  const [availability, setAvailability] = useState<Record<string, AvailabilitySlot[]>>();
  const [availLoading, setAvailLoading] = useState(true);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [schedules, setSchedules] = useState<ScheduleData[]>([]);
  const [sprintSessions, setSprintSessions] = useState<SprintSession[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const weekStart = getMondayOfWeek(calendarDateToLocalDate(todayStr));
  const weekEnd = (() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return toLocalDateStr(d);
  })();
  const weekStartStr = toLocalDateStr(weekStart);

  useEffect(() => {
    if (!profile?.id) {
      setAvailLoading(false);
      setDataLoading(false);
      return;
    }
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const supabase = getSupabase();

        const [availRes, classesRes, schedulesRes, sprintRes] = await Promise.all([
          supabase.from("teacher_availability").select("*").eq("teacher_id", profile.id).eq("is_active", true).gte("date", weekStartStr).lte("date", weekEnd).order("start_time", { ascending: true }),
          supabase.from("classes").select("*").eq("teacher_id", profile.id).order("created_at", { ascending: false }),
          supabase.from("class_schedules").select("*").eq("teacher_id", profile.id).order("date", { ascending: true }),
          supabase.from("sprint_sessions").select(`
            id, sprint_id, session_number, session_type, teacher_id,
            scheduled_at, status, meeting_link, lesson_summary, class_id,
            sprint:learning_sprints!sprint_id(
              sprint_number, status,
              enrollment:enrollments!learning_sprints_enrollment_id_fkey(
                learner_id,
                course:courses!enrollments_course_id_fkey(name)
              )
            )
          `).eq("teacher_id", profile.id).order("scheduled_at", { ascending: true }).order("session_number", { ascending: true }),
        ]);

        if (cancelled) return;

        if (availRes.error) throw availRes.error;
        if (classesRes.error) throw classesRes.error;
        if (schedulesRes.error) throw schedulesRes.error;
        if (sprintRes.error) throw sprintRes.error;

        const rawSprintSessions = (sprintRes.data || []) as any[];
        const sprintIds = [...new Set(rawSprintSessions.map((s: any) => s.sprint_id).filter(Boolean))];
        let sprintStatusMap: Record<string, string> = {};
        if (sprintIds.length > 0) {
          const { data: realSprints } = await supabase
            .from("learning_sprints")
            .select("id, status")
            .in("id", sprintIds);
          (realSprints || []).forEach((sp: any) => {
            sprintStatusMap[sp.id] = sp.status;
          });
        }

        const sprintMapped: SprintSession[] = rawSprintSessions.map((s: any) => ({
          id: s.id,
          sprint_id: s.sprint_id,
          session_number: s.session_number,
          session_type: s.session_type,
          teacher_id: s.teacher_id,
          scheduled_at: s.scheduled_at,
          status: s.status,
          meeting_link: s.meeting_link,
          lesson_summary: s.lesson_summary,
          class_id: s.class_id || null,
          sprint_number: s.sprint?.sprint_number ?? 0,
          sprint_status: sprintStatusMap[s.sprint_id] || s.sprint?.status || "active",
          course_name: s.sprint?.enrollment?.course?.name || t("teacher.unknownCourseName"),
          student_name: "",
          learner_id: s.sprint?.enrollment?.learner_id || "",
        }));

        // Auto-transition in_progress & active → awaiting_feedback for past sessions
        const nowTs = Date.now();
        const transitions: Promise<any>[] = [];
        sprintMapped.forEach((s) => {
          if (s.scheduled_at) {
            const oneHourAfter = new Date(new Date(s.scheduled_at).getTime() + 60 * 60 * 1000).getTime();
            const isPastSession = nowTs > oneHourAfter;
            const isTeacherLed = s.session_type === "vietnamese_teacher" || s.session_type === "foreign_teacher" || s.session_type === "live_session";

            // in_progress: teacher started but never completed → needs feedback
            if (s.status === "in_progress" && isPastSession) {
              transitions.push(
                supabase.from("sprint_sessions").update({ status: "awaiting_feedback" }).eq("id", s.id)
              );
              s.status = "awaiting_feedback";
            }

            // active: teacher never even started a past teacher-led session → needs feedback
            if (s.status === "active" && isPastSession && isTeacherLed) {
              transitions.push(
                supabase.from("sprint_sessions").update({ status: "awaiting_feedback" }).eq("id", s.id)
              );
              s.status = "awaiting_feedback";
            }
          }
        });
        if (transitions.length > 0) {
          await Promise.all(transitions);
        }

        if (sprintMapped.length > 0) {
          const learnerIds = [...new Set(sprintMapped.map((s) => s.learner_id).filter(Boolean))];
          if (learnerIds.length > 0) {
            const { data: profilesData } = await supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", learnerIds);
            const nameMap: Record<string, string> = {};
            (profilesData || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });
            sprintMapped.forEach((s) => { s.student_name = nameMap[s.learner_id] || t("teacher.unknownName"); });
          }
        }

        setSprintSessions(sprintMapped);

        const grouped: Record<string, AvailabilitySlot[]> = {};
        (availRes.data || []).forEach((row: AvailabilitySlot) => {
          const key = row.date || "";
          if (!key) return;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(row);
        });
        setAvailability(grouped);
        setClasses((classesRes.data || []) as ClassData[]);
        setSchedules((schedulesRes.data || []) as ScheduleData[]);
      } catch {
        if (!cancelled) setFetchError(true);
      } finally {
        if (!cancelled) {
          setAvailLoading(false);
          setDataLoading(false);
        }
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [profile?.id, weekStartStr, weekEnd]);

  const teachingUnits = useMemo(() => {
    if (!profile?.id) return [];
    return buildTeachingSessionUnits({
      schedules: schedules.map((s) => ({
        id: s.id,
        class_id: s.class_id,
        teacher_id: profile.id,
        date: s.date,
        start_time: s.start_time,
        end_time: s.end_time,
        status: s.status,
      })),
      sessions: sprintSessions.map((s) => ({
        id: s.id,
        class_id: s.class_id,
        teacher_id: s.teacher_id,
        status: s.status,
        session_number: s.session_number,
        session_type: s.session_type,
      })),
      classes: classes.map((c) => ({
        id: c.id,
        teacher_id: c.teacher_id,
        duration_minutes: null,
      })),
    });
  }, [schedules, sprintSessions, classes, profile?.id]);

  const bookedAvailabilityKeys = useMemo(
    () =>
      buildBookedAvailabilityKeys(
        schedules.map((s) => ({
          teacher_id: profile?.id || null,
          date: s.date,
          start_time: s.start_time,
          status: s.status,
        }))
      ),
    [schedules, profile?.id]
  );

  const stats = useMemo(() => {
    const todaySchedules = schedules.filter((s) => s.date === todayStr);
    const upcomingSchedules = schedules.filter(
      (s) => s.status !== "completed" && s.date >= todayStr
    );

    const todaySprintSessionsRaw = sprintSessions.filter((s) => {
      if (!s.scheduled_at) return false;
      if (s.sprint_status === "locked") return false;
      const datePart = toVietnamDateStr(s.scheduled_at);
      return datePart === todayStr;
    });
    const todaySprintSessions = groupSprintSessions(todaySprintSessionsRaw);

    const upcomingSprintSessionsRaw = sprintSessions.filter(
      (s) => s.status !== "completed" && s.status !== "awaiting_feedback" && s.status !== "locked" && s.sprint_status !== "locked"
    );

    // Deduplicate: sprint_sessions with class_id that already have a class_schedule
    const classScheduleKeys = new Set(
      upcomingSchedules.map((s) => `${s.class_id}|${s.date}`)
    );
    const dedupedUpcomingSprintSessionsRaw = upcomingSprintSessionsRaw.filter((s) => {
      if (!s.class_id || !s.scheduled_at) return true;
      const datePart = toVietnamDateStr(s.scheduled_at);
      return !classScheduleKeys.has(`${s.class_id}|${datePart}`);
    });
    const upcomingSprintSessions = groupSprintSessions(dedupedUpcomingSprintSessionsRaw);

    const uniqueLearnerIds = new Set(sprintSessions.map((s) => s.learner_id).filter(Boolean));

    const weekSchedules = schedules.filter(
      (s) => s.date >= weekStartStr && s.date <= weekEnd
    );

    const weeklyTeaching = profile?.id
      ? summarizeWeeklyBookedTeaching(teachingUnits, profile.id, { start: weekStartStr, end: weekEnd })
      : { classCount: 0, totalHours: 0 };

    return {
      upcomingCount: upcomingSchedules.length + upcomingSprintSessions.length,
      activeStudents: uniqueLearnerIds.size,
      weekHours: weeklyTeaching.totalHours,
      classesCount: weeklyTeaching.classCount,
      todaySchedules,
      todaySprintSessions,
      weekSchedules,
      sprintSessions,
    };
  }, [todayStr, schedules, sprintSessions, teachingUnits, profile?.id, weekStartStr, weekEnd]);

  const formatTimeDisplay = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
  };

  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  const weekDays = useMemo(() => {
    const days: {
      label: string;
      date: string;
      dayOfWeek: number;
      schedules: ScheduleData[];
      availSlots: AvailabilitySlot[];
      sprintSessions: SprintSession[][];
    }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dateStr = toLocalDateStr(d);
      const dow = d.getDay();
      const daySchedules = schedules.filter((s) => s.date === dateStr);
      const dayAvail = profile?.id
        ? filterUnbookedAvailabilitySlots(availability?.[dateStr] || [], profile.id, bookedAvailabilityKeys)
        : availability?.[dateStr] || [];
      const daySprintRaw = sprintSessions.filter((s) => {
        if (!s.scheduled_at) return false;
        const datePart = toVietnamDateStr(s.scheduled_at);
        return datePart === dateStr && s.sprint_status !== "locked" && s.status !== "locked";
      });
      const daySprint = groupSprintSessions(daySprintRaw);
      days.push({
        label: t(`teacher.${dayNames[dow]}`),
        date: dateStr,
        dayOfWeek: dow,
        schedules: daySchedules,
        availSlots: dayAvail,
        sprintSessions: daySprint,
      });
    }
    return days;
  }, [weekStart, schedules, availability, sprintSessions, profile?.id, bookedAvailabilityKeys, t]);

  const getClassById = (id: string) => classes.find((c) => c.id === id);

  const formatTimeShort = (time: string) => {
    const [h] = time.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${displayH}${period}`;
  };

  const totalAvailSlots = useMemo(() => {
    if (!availability || !profile?.id) return 0;
    return Object.values(availability).reduce(
      (sum, slots) =>
        sum + filterUnbookedAvailabilitySlots(slots, profile.id, bookedAvailabilityKeys).length,
      0
    );
  }, [availability, profile?.id, bookedAvailabilityKeys]);

  if (dataLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-background-50 border border-background-200/70"></div>
          ))}
        </div>
        <div className="h-48 rounded-xl bg-background-50 border border-background-200/70"></div>
        <div className="grid grid-cols-7 gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-36 rounded-xl bg-background-50 border border-background-200/70"></div>
          ))}
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-12 rounded-xl bg-background-50 border border-background-200/70 text-center">
        <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
          <i className="ri-error-warning-line text-2xl"></i>
        </div>
        <p className="text-sm text-foreground-700 font-medium mb-1">{t("teacher.fetchError")}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 cursor-pointer whitespace-nowrap"
        >
          <i className="ri-refresh-line"></i>
          {t("teacher.retry")}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="p-5 rounded-xl bg-background-50 border border-background-200/70">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600">
              <i className="ri-calendar-check-line text-lg"></i>
            </div>
          </div>
          <p className="text-2xl font-heading font-bold text-foreground-950">{stats.upcomingCount}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("teacher.upcomingLessons")}</p>
        </div>

        <div className="p-5 rounded-xl bg-background-50 border border-background-200/70">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-accent-100 text-accent-600">
              <i className="ri-user-star-line text-lg"></i>
            </div>
          </div>
          <p className="text-2xl font-heading font-bold text-foreground-950">{stats.activeStudents}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("teacher.activeStudents")}</p>
        </div>

        <div className="p-5 rounded-xl bg-background-50 border border-background-200/70">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-secondary-100 text-secondary-600">
              <i className="ri-time-line text-lg"></i>
            </div>
          </div>
          <p className="text-2xl font-heading font-bold text-foreground-950">{stats.weekHours}h</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("teacher.hoursThisWeek")}</p>
        </div>

        <div className="p-5 rounded-xl bg-background-50 border border-background-200/70">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600">
              <i className="ri-building-line text-lg"></i>
            </div>
          </div>
          <p className="text-2xl font-heading font-bold text-foreground-950">{stats.classesCount}</p>
          <p className="text-xs text-foreground-500 mt-0.5">{t("teacher.classesCount")}</p>
        </div>
      </div>

      {/* Today's Schedule */}
      <div className="mb-8">
        <h3 className="font-heading text-lg font-bold text-foreground-950 mb-4">{t("teacher.todaysSchedule")}</h3>
        {(stats.todaySchedules.length + stats.todaySprintSessions.length) === 0 ? (
          <div className="p-8 rounded-xl bg-background-50 border border-background-200/70 text-center">
            <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-xl bg-accent-100 text-accent-600 mb-3">
              <i className="ri-sun-line text-xl"></i>
            </div>
            <p className="text-sm text-foreground-500">{t("teacher.todayNoLessons")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stats.todaySchedules.map((schedule) => {
              const cls = getClassById(schedule.class_id);
              return (
                <div key={schedule.id} className="flex items-center gap-4 p-4 rounded-xl bg-background-50 border border-background-200/70">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary-100 text-primary-600 shrink-0">
                    <i className="ri-book-open-line"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground-900 truncate">{cls?.name || t("teacher.overviewUnknownClass")}</p>
                    <p className="text-xs text-foreground-500">{cls?.room || ""} {cls?.level ? `· ${cls.level}` : ""}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-foreground-900">
                      {formatTimeDisplay(schedule.start_time)} – {formatTimeDisplay(schedule.end_time)}
                    </p>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
                      {t("teacher.upcoming")}
                    </span>
                  </div>
                </div>
              );
            })}
            {stats.todaySprintSessions.map((group) => {
              const session = group[0];
              const studentCount = group.length;
              const studentNames = group.map((s) => s.student_name).filter(Boolean).join(", ");
              const sessionUrl = `/dashboard/sprint/${session.sprint_id}/session/${session.id}`;
              const typeLabel = session.session_type === "vietnamese_teacher" ? t("session.vietnameseTeacher") :
                session.session_type === "foreign_teacher" ? t("session.foreignTeacher") :
                session.session_type === "live_session" ? t("session.liveSession") : t("session.selfStudy");
              const typeColors: Record<string, string> = {
                vietnamese_teacher: "bg-secondary-100 text-secondary-700",
                foreign_teacher: "bg-accent-100 text-accent-700",
                live_session: "bg-accent-100 text-accent-700",
                self_study: "bg-primary-100 text-primary-700",
              };
              return (
                <Link
                  key={session.id}
                  to={sessionUrl}
                  className="flex items-center gap-4 p-4 rounded-xl bg-background-50 border border-background-200/70 hover:border-primary-200 transition-colors cursor-pointer group"
                >
                  <div className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${typeColors[session.session_type] || "bg-primary-100 text-primary-600"}`}>
                    <i className={session.session_type === "self_study" ? "ri-book-open-line" : session.session_type === "foreign_teacher" ? "ri-global-line" : "ri-user-voice-line"}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground-900 truncate">
                      {typeLabel} · {t("session.session")} {session.session_number} — {session.course_name}
                    </p>
                    <p className="text-xs text-foreground-500">
                      {studentNames || t("teacher.overviewStudent")}
                      {studentCount > 1 && ` · ${t("teacher.studentCountAbbr", { count: studentCount })}`} · {t("dashboard.sprint")} {session.sprint_number}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {session.scheduled_at ? (
                      <p className="text-sm font-medium text-foreground-900">
                        {formatVietnamTime(session.scheduled_at, { hour: "2-digit", minute: "2-digit" }, dateLocale)}
                      </p>
                    ) : (
                      <p className="text-sm text-foreground-400">-:--</p>
                    )}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                      session.status === "completed" ? "bg-accent-100 text-accent-700" :
                      session.status === "awaiting_feedback" ? "bg-secondary-100/60 text-secondary-600" :
                      session.status === "in_progress" ? "bg-secondary-100 text-secondary-700" :
                      "bg-primary-100 text-primary-700"
                    }`}>
                      {session.status === "completed" ? t("teacher.completed") :
                       session.status === "awaiting_feedback" ? t("teacher.overviewAwaitingFeedback") :
                       session.status === "in_progress" ? t("teacher.inProgress") :
                       session.status === "locked" ? t("dashboard.locked") : session.status}
                    </span>
                  </div>
                  <div className="hidden sm:block opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <i className="ri-arrow-right-line text-foreground-300"></i>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Weekly Calendar */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-lg font-bold text-foreground-950">
            {t("teacher.calendarWeek")} {formatVietnamDate(toLocalDateStr(weekStart), { month: "short", day: "numeric" }, dateLocale)}
          </h3>
          {!availLoading && totalAvailSlots > 0 && (
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-accent-200/80 border border-accent-300/60"></span>
                <span className="text-foreground-500">{t("teacher.availabilityPreview")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-secondary-200/80 border border-secondary-300/60"></span>
                <span className="text-foreground-500">{t("teacher.scheduleTitle")}</span>
              </div>
            </div>
          )}
        </div>
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {weekDays.map((day) => {
            const isToday = day.date === todayStr;
            const hasSchedules = day.schedules.length > 0;
            const hasAvail = day.availSlots.length > 0;
            const hasSprints = day.sprintSessions.length > 0;

            return (
              <div
                key={day.date}
                className={`rounded-xl border p-3 min-h-[140px] flex flex-col ${
                  isToday
                    ? "border-primary-300 bg-primary-50/50"
                    : "border-background-200/70 bg-background-50"
                }`}
              >
                <p className={`text-xs font-semibold mb-1 ${isToday ? "text-primary-700" : "text-foreground-500"}`}>
                  {day.label}
                </p>
                <p className={`text-lg font-heading font-bold mb-2 ${isToday ? "text-primary-700" : "text-foreground-900"}`}>
                  {parseInt(day.date.split("-")[2], 10)}
                </p>

                <div className="flex-1 space-y-1 overflow-hidden">
                  {hasAvail && day.availSlots.map((slot, ai) => (
                    <div
                      key={`avail-${ai}`}
                      className="text-[9px] leading-tight px-1.5 py-0.5 rounded bg-accent-100/80 border border-accent-200/70 text-accent-700 truncate"
                      title={t("teacher.availabilityFree") + `: ${slot.start_time}-${slot.end_time}`}
                    >
                      <span className="font-semibold">{formatTimeShort(slot.start_time)}-{formatTimeShort(slot.end_time)}</span>
                      <span className="ml-1 opacity-70">{t("teacher.availabilityFree")}</span>
                    </div>
                  ))}

                  {hasSchedules && day.schedules.slice(0, 3).map((s) => {
                    const cls = getClassById(s.class_id);
                    return (
                      <div
                        key={s.id}
                        className="text-[9px] leading-tight px-1.5 py-0.5 rounded bg-secondary-100/80 border border-secondary-200/70 text-secondary-700 truncate"
                        title={`${cls?.name}: ${s.start_time}-${s.end_time}`}
                      >
                        <span className="font-semibold">{formatTimeShort(s.start_time)}</span>
                        <span className="ml-1 opacity-80">{cls?.subject?.split(" ")[0]}</span>
                      </div>
                    );
                  })}

                  {hasSprints && day.sprintSessions.slice(0, 3).map((group) => {
                    const s = group[0];
                    const count = group.length;
                    const timeStr = s.scheduled_at
                      ? formatVietnamTime(s.scheduled_at, { hour: "2-digit", minute: "2-digit" }, dateLocale)
                      : "";
                    const statusBadge = s.status === "completed"
                      ? "bg-accent-100/80 border-accent-200/70 text-accent-700"
                      : s.status === "awaiting_feedback"
                        ? "bg-secondary-100/80 border-secondary-200/70 text-secondary-700"
                        : "bg-primary-100/80 border-primary-200/70 text-primary-700";
                    const label = s.status === "completed" ? t("teacher.overviewCompletedShort") : s.status === "awaiting_feedback" ? t("teacher.overviewAwaitingShort") : t("teacher.overviewSelfStudyShort");
                    return (
                      <Link
                        key={s.id}
                        to={`/dashboard/sprint/${s.sprint_id}/session/${s.id}`}
                        className="block text-[9px] leading-tight px-1.5 py-0.5 rounded border truncate cursor-pointer hover:opacity-80 transition-opacity"
                        title={t("feedback.sprintSessionLabel", { sprint: s.sprint_number, session: s.session_number }) + ` — ${s.course_name}`}
                      >
                        <span className={`inline-flex items-center gap-0.5 px-1 py-0 rounded-[2px] text-[8px] font-bold ${statusBadge}`}>
                          {label}{count > 1 ? ` +${count - 1}` : ""}
                        </span>
                        <span className="ml-1 opacity-80">{timeStr}</span>
                      </Link>
                    );
                  })}

                  {!hasSchedules && !hasAvail && !hasSprints && (
                    <p className="text-[10px] text-foreground-300">-</p>
                  )}
                </div>

                {(() => {
                  const totalItems = (hasAvail ? day.availSlots.length : 0) + day.schedules.length + day.sprintSessions.length;
                  const shown = day.schedules.slice(0, 3).length + (hasAvail ? day.availSlots.length : 0) + day.sprintSessions.slice(0, 3).length;
                  const remaining = totalItems - shown;
                  if (remaining > 0) {
                    return (
                      <p className="text-[9px] text-foreground-400 pl-1 mt-0.5">+{remaining} {t("teacher.overviewMore")}</p>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {/* Sessions Awaiting Feedback */}
      {stats.sprintSessions.filter((s) => s.status === "awaiting_feedback").length > 0 && (
        <div className="mt-8">
          <h3 className="font-heading text-lg font-bold text-foreground-950 mb-4">
            <i className="ri-feedback-line mr-2 text-secondary-500"></i>
            {t("teacher.overviewNeedsGrading")}
          </h3>
          <div className="space-y-2">
            {groupSprintSessions(stats.sprintSessions.filter((s) => s.status === "awaiting_feedback")).map((group) => {
              const session = group[0];
              const studentCount = group.length;
              const studentNames = group.map((s) => s.student_name).filter(Boolean).join(", ");
              const typeLabel = session.session_type === "vietnamese_teacher" ? t("session.vietnameseTeacher") :
                session.session_type === "foreign_teacher" ? t("session.foreignTeacher") :
                session.session_type === "live_session" ? t("session.liveSession") : t("session.selfStudy");
              const typeColors: Record<string, string> = {
                vietnamese_teacher: "bg-secondary-100 text-secondary-700 border-secondary-200",
                foreign_teacher: "bg-accent-100 text-accent-700 border-accent-200",
                self_study: "bg-primary-100 text-primary-700 border-primary-200",
              };
              return (
                <Link
                  key={session.id}
                  to={`/dashboard/sprint/${session.sprint_id}/session/${session.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-secondary-200 bg-secondary-50/40 hover:border-secondary-300 transition-colors cursor-pointer group"
                >
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap ${typeColors[session.session_type] || "bg-background-100 text-foreground-600"}`}>
                    {typeLabel}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground-800 truncate">
                      {t("feedback.sprintSessionLabel", { sprint: session.sprint_number, session: session.session_number })} — {session.course_name}
                    </p>
                    <p className="text-xs text-foreground-400">
                      {studentNames || t("teacher.overviewStudent")}
                      {studentCount > 1 && ` · ${t("teacher.studentCountAbbr", { count: studentCount })}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0 text-xs text-secondary-600 font-medium flex items-center gap-1">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary-500 text-background-50 whitespace-nowrap">
                      <i className="ri-time-line text-[9px]"></i>
                      {t("teacher.overviewPendingGrade")}
                    </span>
                    {session.scheduled_at ? formatVietnamDate(session.scheduled_at, { weekday: "short", month: "short", day: "numeric" }, dateLocale) : "-"}
                  </div>
                  <i className="ri-arrow-right-line text-foreground-300 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming Sprint Sessions */}
      {stats.sprintSessions.filter((s) => s.status !== "completed" && s.status !== "awaiting_feedback" && s.status !== "locked" && s.sprint_status !== "locked").length > 0 && (
        <div className="mt-8">
          <h3 className="font-heading text-lg font-bold text-foreground-950 mb-4">
            <i className="ri-calendar-check-line mr-2 text-foreground-400"></i>
            {t("teacher.upcomingSprintSessions")}
          </h3>
          <div className="space-y-2">
            {groupSprintSessions(stats.sprintSessions.filter((s) => s.status !== "completed" && s.status !== "awaiting_feedback" && s.status !== "locked" && s.sprint_status !== "locked")).slice(0, 5).map((group) => {
              const session = group[0];
              const studentCount = group.length;
              const studentNames = group.map((s) => s.student_name).filter(Boolean).join(", ");
              const typeLabel = session.session_type === "vietnamese_teacher" ? t("session.vietnameseTeacher") :
                session.session_type === "foreign_teacher" ? t("session.foreignTeacher") :
                session.session_type === "live_session" ? t("session.liveSession") : t("session.selfStudy");
              const typeColors: Record<string, string> = {
                vietnamese_teacher: "bg-secondary-100 text-secondary-700 border-secondary-200",
                foreign_teacher: "bg-accent-100 text-accent-700 border-accent-200",
                self_study: "bg-primary-100 text-primary-700 border-primary-200",
              };
              return (
                <Link
                  key={session.id}
                  to={`/dashboard/sprint/${session.sprint_id}/session/${session.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-background-200/70 bg-background-50 hover:border-primary-200 transition-colors cursor-pointer group"
                >
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap ${typeColors[session.session_type] || "bg-background-100 text-foreground-600"}`}>
                    {typeLabel}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground-800 truncate">
                      {t("feedback.sprintSessionLabel", { sprint: session.sprint_number, session: session.session_number })} — {session.course_name}
                    </p>
                    <p className="text-xs text-foreground-400">
                      {studentNames || t("teacher.overviewStudent")}
                      {studentCount > 1 && ` · ${t("teacher.studentCountAbbr", { count: studentCount })}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0 text-xs text-foreground-500">
                    {session.scheduled_at ? formatVietnamDate(session.scheduled_at, { weekday: "short", month: "short", day: "numeric" }, dateLocale) : "-"}
                  </div>
                  <i className="ri-arrow-right-line text-foreground-300 opacity-0 group-hover:opacity-100 transition-opacity"></i>
                </Link>
              );
            })}
            {groupSprintSessions(stats.sprintSessions.filter((s) => s.status !== "completed" && s.status !== "awaiting_feedback" && s.status !== "locked" && s.sprint_status !== "locked")).length > 5 && (
              <p className="text-xs text-foreground-400 text-center pt-1">
                {t("teacher.overviewMoreCount", { count: groupSprintSessions(stats.sprintSessions.filter((s) => s.status !== "completed" && s.status !== "awaiting_feedback" && s.status !== "locked" && s.sprint_status !== "locked")).length - 5 })} · <Link to="/teacher/dashboard?tab=sessions" className="text-primary-500 hover:text-primary-600 font-medium cursor-pointer">{t("teacher.viewAllSessions")}</Link>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}