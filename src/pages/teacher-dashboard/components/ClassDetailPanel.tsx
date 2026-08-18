import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { formatVietnamDate, formatVietnamDateTime, getUiDateLocale } from "@/lib/datetime";
import AttendanceModal from "./AttendanceModal";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface ClassDetailPanelProps {
  classId: string;
  className: string;
  classSubject: string;
}

type SubTab = "students" | "feedback" | "materials";

interface StudentProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  role: string;
}

interface EnrollmentData {
  id: string;
  class_id: string;
  student_id: string;
  enrolled_at: string;
}

interface Material {
  id: string;
  class_id: string;
  teacher_id: string;
  title: string;
  description: string;
  file_name: string;
  file_url: string;
  file_size: number;
  file_type: string;
  created_at: string;
}

interface SubmittedSummary {
  sessionId: string;
  sprintId: string;
  sprintNumber: number;
  sessionNumber: number;
  studentId: string;
  studentName: string;
  studentEmail: string;
  lessonSummary: {
    what_learned: string;
    key_vocabulary: string;
    grammar_points: string;
    questions: string;
    self_assessment: number;
    submitted_at: string;
  };
  feedback: string | null;
  sessionStatus: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string, locale: string): string {
  if (!dateStr) return "-";
  return formatVietnamDateTime(dateStr, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }, locale);
}

function getFileIcon(fileType: string): string {
  if (fileType.includes("pdf")) return "ri-file-pdf-line";
  if (fileType.includes("word") || fileType.includes("document")) return "ri-file-word-line";
  if (fileType.includes("presentation") || fileType.includes("powerpoint")) return "ri-file-ppt-line";
  if (fileType.includes("image")) return "ri-image-line";
  if (fileType.includes("spreadsheet") || fileType.includes("excel")) return "ri-file-excel-line";
  return "ri-file-line";
}

export default function ClassDetailPanel({ classId, className, classSubject }: ClassDetailPanelProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = getUiDateLocale(i18n.language);
  const { profile } = useAuth();
  const supabase = getSupabase();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("students");

  // Students state
  const [enrollments, setEnrollments] = useState<EnrollmentData[]>([]);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [stuLoading, setStuLoading] = useState(true);
  const [stuError, setStuError] = useState(false);

  // Feedback state
  const [submissions, setSubmissions] = useState<SubmittedSummary[]>([]);
  const [fbLoading, setFbLoading] = useState(true);
  const [fbError, setFbError] = useState(false);
  const [fbFilter, setFbFilter] = useState<"pending" | "reviewed" | "all">("pending");
  const [expandedFbId, setExpandedFbId] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [activeFeedbackId, setActiveFeedbackId] = useState<string | null>(null);
  const [savingFeedback, setSavingFeedback] = useState(false);

  // Materials state
  const [materials, setMaterials] = useState<Material[]>([]);
  const [matLoading, setMatLoading] = useState(true);
  const [matError, setMatError] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Attendance state
  const [schedules, setSchedules] = useState<{ id: string; date: string; start_time: string; end_time: string; type: string; status: string }[]>([]);
  const [attendanceTarget, setAttendanceTarget] = useState<{ scheduleId: string; date: string; time: string } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // ---- Fetch Students ----
  const fetchStudents = useCallback(async () => {
    if (!classId) return;
    setStuLoading(true);
    setStuError(false);
    try {
      const { data: enrData, error: enrErr } = await supabase
        .from("class_enrollments")
        .select("*")
        .eq("class_id", classId);

      if (enrErr) throw enrErr;
      const enrs = (enrData || []) as EnrollmentData[];
      setEnrollments(enrs);

      if (enrs.length > 0) {
        const studentIds = [...new Set(enrs.map((e) => e.student_id))];
        const { data: stuData, error: stuErr } = await supabase
          .from("profiles")
          .select("*")
          .in("id", studentIds);

        if (stuErr) throw stuErr;
        setStudents((stuData || []) as StudentProfile[]);
      } else {
        setStudents([]);
      }
    } catch {
      setStuError(true);
    } finally {
      setStuLoading(false);
    }
  }, [classId, supabase]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  // ---- Fetch Feedback ----
  const fetchFeedback = useCallback(async () => {
    if (!classId) return;
    setFbLoading(true);
    setFbError(false);
    try {
      // Get students in this class
      const { data: enrData } = await supabase
        .from("class_enrollments")
        .select("student_id")
        .eq("class_id", classId);

      if (!enrData || enrData.length === 0) {
        setSubmissions([]);
        setFbLoading(false);
        return;
      }
      const studentIds = enrData.map((e: any) => e.student_id);

      // Get student profiles
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", studentIds);

      const profileMap: Record<string, { name: string; email: string }> = {};
      (profilesData || []).forEach((p: any) => {
        profileMap[p.id] = { name: p.full_name, email: p.email };
      });

      // Get enrollments
      const { data: courseEnrollments } = await supabase
        .from("enrollments")
        .select("id, learner_id, course_id")
        .in("learner_id", studentIds)
        .eq("status", "active");

      if (!courseEnrollments || courseEnrollments.length === 0) {
        setSubmissions([]);
        setFbLoading(false);
        return;
      }

      const enrollmentIds = courseEnrollments.map((e: any) => e.id);
      const studentEnrollmentMap: Record<string, { enrollmentId: string }> = {};
      courseEnrollments.forEach((e: any) => {
        studentEnrollmentMap[e.learner_id] = { enrollmentId: e.id };
      });

      // Get sprints
      const { data: sprintsData } = await supabase
        .from("learning_sprints")
        .select("id, enrollment_id, sprint_number")
        .in("enrollment_id", enrollmentIds);

      if (!sprintsData || sprintsData.length === 0) {
        setSubmissions([]);
        setFbLoading(false);
        return;
      }

      const sprintIds = sprintsData.map((s: any) => s.id);
      const sprintMap: Record<string, { enrollmentId: string; sprintNumber: number }> = {};
      sprintsData.forEach((s: any) => {
        sprintMap[s.id] = { enrollmentId: s.enrollment_id, sprintNumber: s.sprint_number };
      });

      // Get sprint_sessions with lesson_summary
      const { data: sessionsData } = await supabase
        .from("sprint_sessions")
        .select("id, sprint_id, session_number, status, lesson_summary, feedback")
        .in("sprint_id", sprintIds)
        .not("lesson_summary", "is", null)
        .order("session_number", { ascending: false })
        .limit(30);

      if (!sessionsData || sessionsData.length === 0) {
        setSubmissions([]);
        setFbLoading(false);
        return;
      }

      const result: SubmittedSummary[] = [];
      sessionsData.forEach((session: any) => {
        const sprint = sprintMap[session.sprint_id];
        if (!sprint) return;

        const enrollment = courseEnrollments.find((e: any) => e.id === sprint.enrollmentId);
        if (!enrollment) return;

        const studentProfile = profileMap[enrollment.learner_id];
        if (!studentProfile) return;

        let summaryObj: SubmittedSummary["lessonSummary"];
        try {
          summaryObj = JSON.parse(session.lesson_summary);
        } catch {
          summaryObj = {
            what_learned: session.lesson_summary || "",
            key_vocabulary: "",
            grammar_points: "",
            questions: "",
            self_assessment: 0,
            submitted_at: "",
          };
        }

        result.push({
          sessionId: session.id,
          sprintId: session.sprint_id,
          sprintNumber: sprint.sprintNumber,
          sessionNumber: session.session_number,
          studentId: enrollment.learner_id,
          studentName: studentProfile.name,
          studentEmail: studentProfile.email,
          lessonSummary: summaryObj,
          feedback: session.feedback,
          sessionStatus: session.status,
        });
      });

      setSubmissions(result);
    } catch {
      setFbError(true);
    } finally {
      setFbLoading(false);
    }
  }, [classId, supabase]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  // ---- Fetch Materials ----
  const fetchMaterials = useCallback(async () => {
    if (!classId) return;
    setMatLoading(true);
    setMatError(false);
    try {
      const { data, error: err } = await supabase
        .from("class_materials")
        .select("*")
        .eq("class_id", classId)
        .order("created_at", { ascending: false });

      if (err) throw err;
      setMaterials((data || []) as Material[]);
    } catch {
      setMatError(true);
    } finally {
      setMatLoading(false);
    }
  }, [classId, supabase]);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  // ---- Fetch Schedules for Attendance ----
  const fetchSchedules = useCallback(async () => {
    if (!classId) return;
    try {
      const { data, error: err } = await supabase
        .from("class_schedules")
        .select("id, date, start_time, end_time, type, status")
        .eq("class_id", classId)
        .order("date", { ascending: true });

      if (err) throw err;
      setSchedules((data || []) as { id: string; date: string; start_time: string; end_time: string; type: string; status: string }[]);
    } catch {
      // non-critical
    }
  }, [classId, supabase]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  // ---- Materials handlers ----
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setToast({ message: t("teacher.materialsError"), type: "error" });
        return;
      }
      setUploadFile(file);
    }
  };

  const handleUpload = async () => {
    if (!uploadTitle.trim()) { setToast({ message: t("teacher.materialsTitleRequired"), type: "error" }); return; }
    if (!uploadFile) { setToast({ message: t("teacher.materialsFileRequired"), type: "error" }); return; }
    if (!classId || !profile?.id) return;

    setUploading(true);
    try {
      const reader = new FileReader();
      const fileUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(uploadFile);
      });

      const { error: insertErr } = await supabase.from("class_materials").insert({
        class_id: classId,
        teacher_id: profile.id,
        title: uploadTitle.trim(),
        description: uploadDesc.trim(),
        file_name: uploadFile.name,
        file_url: fileUrl,
        file_size: uploadFile.size,
        file_type: uploadFile.type,
      });
      if (insertErr) throw insertErr;

      setToast({ message: t("teacher.materialsUploaded"), type: "success" });
      setShowUploadForm(false);
      setUploadTitle("");
      setUploadDesc("");
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchMaterials();
    } catch {
      setToast({ message: t("teacher.materialsError"), type: "error" });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteMaterial = async () => {
    if (!deleteTarget) return;
    try {
      const { error: delErr } = await supabase.from("class_materials").delete().eq("id", deleteTarget.id);
      if (delErr) throw delErr;
      setMaterials((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      setToast({ message: t("teacher.materialsDeleted"), type: "success" });
    } catch {
      setToast({ message: t("teacher.materialsError"), type: "error" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleDownload = (material: Material) => {
    const link = document.createElement("a");
    link.href = material.file_url;
    link.download = material.file_name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ---- Feedback handlers ----
  const toggleExpandFb = (sessionId: string) => {
    setExpandedFbId(expandedFbId === sessionId ? null : sessionId);
    if (activeFeedbackId !== sessionId) {
      setActiveFeedbackId(null);
      setFeedbackDraft("");
    }
  };

  const openFeedback = (sessionId: string, existing: string | null) => {
    setActiveFeedbackId(sessionId);
    setFeedbackDraft(existing || "");
  };

  const submitFeedback = async (sessionId: string) => {
    if (!feedbackDraft.trim()) return;
    setSavingFeedback(true);
    try {
      const { error } = await supabase
        .from("sprint_sessions")
        .update({ feedback: feedbackDraft.trim() })
        .eq("id", sessionId);
      if (error) throw error;

      const submission = submissions.find((s) => s.sessionId === sessionId);
      if (submission) {
        await supabase.from("notifications").insert({
          user_id: submission.studentId,
          title: t("teacher.feedbackNotificationTitle"),
          message: t("teacher.feedbackNotificationMsg", { sprint: submission.sprintNumber, session: submission.sessionNumber }),
          type: "feedback",
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }

      setSubmissions((prev) =>
        prev.map((s) => (s.sessionId === sessionId ? { ...s, feedback: feedbackDraft.trim() } : s))
      );
      setActiveFeedbackId(null);
      setFeedbackDraft("");
      setToast({ message: t("teacher.feedbackSavedToast"), type: "success" });
    } catch {
      setToast({ message: t("teacher.feedbackSaveErrorToast"), type: "error" });
    } finally {
      setSavingFeedback(false);
    }
  };

  const filteredSubmissions = submissions.filter((s) => {
    if (fbFilter === "pending") return !s.feedback;
    if (fbFilter === "reviewed") return !!s.feedback;
    return true;
  });

  const pendingCount = submissions.filter((s) => !s.feedback).length;
  const reviewedCount = submissions.filter((s) => !!s.feedback).length;

  const subTabs: { key: SubTab; label: string; icon: string; count?: number }[] = [
    { key: "students", label: t("teacher.navStudents"), icon: "ri-group-line", count: students.length },
    { key: "feedback", label: t("teacher.navFeedback"), icon: "ri-chat-1-line", count: pendingCount },
    { key: "materials", label: t("teacher.navMaterials"), icon: "ri-folder-line", count: materials.length },
  ];

  return (
    <div className="border-t border-background-200/70 pt-4">
      {/* Sub-tab navigation */}
      <div className="flex items-center bg-background-100 rounded-full p-0.5 mb-4 w-fit flex-wrap">
        {subTabs.map((st) => (
          <button
            key={st.key}
            onClick={() => setActiveSubTab(st.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
              activeSubTab === st.key
                ? "bg-background-50 text-foreground-950 shadow-sm"
                : "text-foreground-500 hover:text-foreground-700"
            }`}
          >
            <i className={`${st.icon} text-base`}></i>
            {st.label}
            {st.count !== undefined && st.count > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                activeSubTab === st.key
                  ? "bg-primary-500 text-background-50"
                  : "bg-background-200 text-foreground-500"
              }`}>
                {st.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* === STUDENTS SUB-TAB === */}
      {activeSubTab === "students" && (
        <div>
          {/* Upcoming schedules with quick attendance */}
          {schedules.filter(s => s.status !== "completed").length > 0 && (
            <div className="mb-4 p-3 rounded-lg bg-accent-50/50 border border-accent-200/50">
              <p className="text-xs font-semibold text-foreground-600 mb-2 flex items-center gap-1.5">
                <i className="ri-calendar-check-line text-accent-600"></i>
                {t("teacher.classDetailUpcomingSchedules")}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {schedules.filter(s => s.status !== "completed").slice(0, 4).map((sched) => (
                  <button
                    key={sched.id}
                    onClick={() => setAttendanceTarget({ scheduleId: sched.id, date: sched.date, time: `${sched.start_time} - ${sched.end_time}` })}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-100 text-accent-700 hover:bg-accent-200 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-clipboard-line text-[10px]"></i>
                    {formatVietnamDate(sched.date, { month: "short", day: "numeric" }, dateLocale)} {sched.start_time.slice(0, 5)}
                  </button>
                ))}
                {schedules.filter(s => s.status !== "completed").length > 4 && (
                  <span className="text-xs text-foreground-400">{t("teacher.classDetailMoreCount", { count: schedules.filter(s => s.status !== "completed").length - 4 })}</span>
                )}
              </div>
            </div>
          )}

          {stuLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-background-100"></div>)}
            </div>
          ) : stuError ? (
            <div className="p-6 text-center">
              <p className="text-sm text-foreground-500">{t("teacher.fetchError")}</p>
              <button onClick={fetchStudents} className="mt-2 text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap">
                <i className="ri-refresh-line mr-1"></i>{t("teacher.retry")}
              </button>
            </div>
          ) : students.length === 0 ? (
            <div className="p-6 text-center rounded-lg bg-background-50 border border-background-200/70">
              <div className="w-10 h-10 mx-auto flex items-center justify-center rounded-xl bg-accent-100 text-accent-600 mb-2">
                <i className="ri-user-search-line"></i>
              </div>
              <p className="text-sm text-foreground-500">{t("teacher.noStudents")}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {students.map((student) => {
                const enr = enrollments.find((e) => e.student_id === student.id);
                return (
                  <div key={student.id} className="flex items-center gap-3 p-3 rounded-lg bg-background-50 border border-background-200/70">
                    <div className="w-8 h-8 flex items-center justify-center rounded-full bg-accent-100 text-accent-700 font-semibold text-xs shrink-0">
                      {student.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground-900 truncate">{student.full_name}</p>
                      <p className="text-xs text-foreground-500 truncate">{student.email}</p>
                    </div>
                    {student.phone && (
                      <span className="text-xs text-foreground-400 hidden sm:inline">{student.phone}</span>
                    )}
                    {enr && (
                      <span className="text-[10px] text-foreground-400 hidden sm:inline">
                        {formatVietnamDate(enr.enrolled_at, { month: "short", day: "numeric" }, dateLocale)}
                      </span>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-foreground-400 mt-1">{students.length} {t("teacher.students")}</p>
            </div>
          )}
        </div>
      )}

      {/* === FEEDBACK SUB-TAB === */}
      {activeSubTab === "feedback" && (
        <div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {(["pending", "reviewed", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFbFilter(f)}
                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap ${
                  fbFilter === f
                    ? f === "pending" ? "bg-secondary-500 text-background-50"
                    : f === "reviewed" ? "bg-accent-500 text-background-50"
                    : "bg-foreground-800 text-background-50"
                    : "bg-background-100 text-foreground-600 hover:bg-background-200"
                }`}
              >
                {f === "pending" ? t("teacher.feedbackPending") : f === "reviewed" ? t("teacher.feedbackReviewed") : t("teacher.feedbackAll")}
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-background-50/20">
                  {f === "pending" ? pendingCount : f === "reviewed" ? reviewedCount : submissions.length}
                </span>
              </button>
            ))}
          </div>

          {fbLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2].map((i) => <div key={i} className="h-20 rounded-lg bg-background-100"></div>)}
            </div>
          ) : fbError ? (
            <div className="p-6 text-center">
              <p className="text-sm text-foreground-500">{t("teacher.fetchError")}</p>
              <button onClick={fetchFeedback} className="mt-2 text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap">
                <i className="ri-refresh-line mr-1"></i>{t("teacher.retry")}
              </button>
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="p-6 text-center rounded-lg bg-background-50 border border-background-200/70">
              <div className="w-10 h-10 mx-auto flex items-center justify-center rounded-xl bg-accent-100 text-accent-600 mb-2">
                <i className="ri-file-text-line"></i>
              </div>
              <p className="text-sm text-foreground-500">{t("teacher.feedbackNoSubmissions")}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {filteredSubmissions.map((sub) => {
                const isExpanded = expandedFbId === sub.sessionId;
                return (
                  <div key={sub.sessionId} className="rounded-lg border border-background-200/70 bg-background-50">
                    <div onClick={() => toggleExpandFb(sub.sessionId)} className="flex items-center gap-3 p-3 cursor-pointer">
                      <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-100 text-primary-700 font-semibold text-xs shrink-0">
                        {sub.studentName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground-900">{sub.studentName}</p>
                        <p className="text-xs text-foreground-500">{t("feedback.sprintSessionLabel", { sprint: sub.sprintNumber, session: sub.sessionNumber })}</p>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                        sub.feedback ? "bg-accent-100 text-accent-700" : "bg-secondary-100 text-secondary-700"
                      }`}>
                        {sub.feedback ? t("teacher.feedbackGiven") : t("teacher.feedbackAwaiting")}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-background-100">
                        <div className="mt-3 p-3 rounded-lg bg-background-50 border border-background-100">
                          <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-1">
                            {t("session.whatILearned")}
                          </p>
                          <p className="text-sm text-foreground-700 whitespace-pre-wrap line-clamp-4">
                            {sub.lessonSummary.what_learned}
                          </p>
                        </div>

                        {sub.feedback && activeFeedbackId !== sub.sessionId ? (
                          <div className="mt-2 p-3 rounded-lg bg-accent-50 border border-accent-200/70">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[11px] font-semibold text-accent-700">{t("teacher.yourFeedback")}</p>
                              <button
                                onClick={() => openFeedback(sub.sessionId, sub.feedback)}
                                className="text-xs text-accent-600 hover:text-accent-800 cursor-pointer whitespace-nowrap"
                              >
                                <i className="ri-edit-line mr-0.5"></i>{t("teacher.editFeedback")}
                              </button>
                            </div>
                            <p className="text-sm text-foreground-700 whitespace-pre-wrap">{sub.feedback}</p>
                          </div>
                        ) : activeFeedbackId === sub.sessionId ? (
                          <div className="mt-2">
                            <textarea
                              value={feedbackDraft}
                              onChange={(e) => setFeedbackDraft(e.target.value)}
                              rows={3}
                              maxLength={500}
                              className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-y"
                              placeholder={t("teacher.feedbackPlaceholder")}
                            />
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-xs text-foreground-400">{500 - feedbackDraft.length} {t("session.charactersLeft")}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { setActiveFeedbackId(null); setFeedbackDraft(""); }}
                                  className="px-3 py-1.5 rounded text-xs font-medium text-foreground-600 hover:bg-background-100 cursor-pointer whitespace-nowrap"
                                >
                                  {t("teacher.cancel")}
                                </button>
                                <button
                                  onClick={() => submitFeedback(sub.sessionId)}
                                  disabled={savingFeedback || !feedbackDraft.trim()}
                                  className="px-3 py-1.5 rounded text-xs font-medium bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                                >
                                  {savingFeedback ? t("teacher.saving") : t("teacher.submitFeedback")}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2">
                            <button
                              onClick={() => openFeedback(sub.sessionId, null)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-primary-500 text-background-50 hover:bg-primary-600 cursor-pointer whitespace-nowrap"
                            >
                              <i className="ri-chat-1-line"></i>{t("teacher.writeFeedback")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* === MATERIALS SUB-TAB === */}
      {activeSubTab === "materials" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-foreground-500">
              {matLoading ? "..." : t("teacher.materialsCountLabel", { count: materials.length })}
            </p>
            <button
              onClick={() => { setShowUploadForm(true); setUploadTitle(""); setUploadDesc(""); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-500 text-background-50 hover:bg-primary-600 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-upload-line"></i>{t("teacher.materialsUpload")}
            </button>
          </div>

          {/* Upload form */}
          {showUploadForm && (
            <div className="mb-3 p-4 rounded-lg bg-background-50 border border-primary-200">
              <div className="space-y-3">
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder={t("teacher.materialsTitlePlaceholder")}
                  maxLength={200}
                  className="w-full text-sm rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
                <textarea
                  value={uploadDesc}
                  onChange={(e) => setUploadDesc(e.target.value)}
                  placeholder={t("teacher.materialsDescriptionPlaceholder")}
                  maxLength={500}
                  rows={2}
                  className="w-full text-sm rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-background-100 text-foreground-700 hover:bg-background-200 cursor-pointer whitespace-nowrap border border-background-200"
                  >
                    <i className="ri-attachment-2"></i>{t("teacher.materialsSelectFile")}
                  </button>
                  <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.gif,.webp" />
                  {uploadFile && (
                    <span className="text-xs text-foreground-600 truncate max-w-[200px]">{uploadFile.name} ({formatFileSize(uploadFile.size)})</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-500 text-background-50 hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                  >
                    {uploading ? t("teacher.materialsSaving") : t("teacher.materialsSave")}
                  </button>
                  <button
                    onClick={() => { setShowUploadForm(false); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-foreground-600 hover:text-foreground-900 hover:bg-background-100 cursor-pointer whitespace-nowrap"
                  >
                    {t("teacher.materialsCancel")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {matLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-background-100"></div>)}
            </div>
          ) : matError ? (
            <div className="p-4 text-center">
              <p className="text-sm text-foreground-500">{t("teacher.materialsLoadError")}</p>
              <button onClick={fetchMaterials} className="mt-1 text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap">
                <i className="ri-refresh-line mr-1"></i>{t("teacher.retry")}
              </button>
            </div>
          ) : materials.length === 0 ? (
            <div className="p-6 text-center rounded-lg bg-background-50 border border-background-200/70">
              <div className="w-10 h-10 mx-auto flex items-center justify-center rounded-xl bg-accent-100 text-accent-600 mb-2">
                <i className="ri-file-copy-line"></i>
              </div>
              <p className="text-sm text-foreground-500">{t("teacher.materialsNoFiles")}</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {materials.map((mat) => (
                <div key={mat.id} className="flex items-center gap-3 p-3 rounded-lg bg-background-50 border border-background-200/70">
                  <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-accent-100 text-accent-600 shrink-0">
                    <i className={`${getFileIcon(mat.file_type)} text-sm`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground-900 truncate">{mat.title}</p>
                    <div className="flex items-center gap-2 text-xs text-foreground-500 flex-wrap">
                      <span className="truncate">{mat.file_name}</span>
                      <span>{formatFileSize(mat.file_size)}</span>
                      <span className="hidden sm:inline">{formatDate(mat.created_at, dateLocale)}</span>
                    </div>
                  </div>
                  <button onClick={() => handleDownload(mat)} className="w-7 h-7 flex items-center justify-center rounded text-foreground-400 hover:text-primary-600 hover:bg-primary-50 cursor-pointer" title={t("teacher.materialsDownload")}>
                    <i className="ri-download-line text-sm"></i>
                  </button>
                  <button onClick={() => setDeleteTarget(mat)} className="w-7 h-7 flex items-center justify-center rounded text-foreground-400 hover:text-accent-600 hover:bg-accent-50 cursor-pointer" title={t("teacher.materialsDelete")}>
                    <i className="ri-delete-bin-line text-sm"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTarget(null)}>
          <div className="bg-background-50 rounded-2xl p-6 mx-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 mx-auto flex items-center justify-center rounded-2xl bg-accent-100 text-accent-600 mb-4">
              <i className="ri-delete-bin-line text-xl"></i>
            </div>
            <h4 className="text-base font-semibold text-foreground-950 text-center mb-1">{t("teacher.materialsDeleteConfirm")}</h4>
            <p className="text-sm text-foreground-500 text-center mb-6">{t("teacher.materialsDeleteDesc")}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-background-100 text-foreground-700 hover:bg-background-200 cursor-pointer whitespace-nowrap">
                {t("teacher.materialsCancel")}
              </button>
              <button onClick={handleDeleteMaterial} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-background-50 hover:bg-accent-600 cursor-pointer whitespace-nowrap">
                {t("teacher.materialsDelete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Modal */}
      {attendanceTarget && (
        <AttendanceModal
          scheduleId={attendanceTarget.scheduleId}
          classId={classId}
          scheduleDate={attendanceTarget.date}
          scheduleTime={attendanceTarget.time}
          className={className}
          onClose={() => {
            setAttendanceTarget(null);
            fetchSchedules();
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-lg transition-all duration-300 ${
          toast.type === "success" ? "bg-primary-500 text-background-50" : "bg-accent-500 text-background-50"
        }`}>
          <div className="flex items-center gap-2">
            <i className={`text-base ${toast.type === "success" ? "ri-checkbox-circle-line" : "ri-close-circle-line"}`}></i>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}