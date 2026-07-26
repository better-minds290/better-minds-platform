import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface CourseOption {
  id: string;
  name: string;
}

interface TeacherOption {
  id: string;
  full_name: string;
  role: string;
}

interface ClassFormData {
  name: string;
  course_id: string;
  teacher_id: string;
  subject: string;
  level: string;
  room: string;
  max_students: number;
  status: string;
}

interface ClassModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editClass?: {
    id: string;
    name: string;
    course_id: string | null;
    teacher_id: string | null;
    subject: string;
    level: string;
    room: string;
    max_students: number;
    status: string;
  } | null;
}

const DEFAULT_FORM: ClassFormData = {
  name: "",
  course_id: "",
  teacher_id: "",
  subject: "",
  level: "",
  room: "",
  max_students: 15,
  status: "active",
};

export default function ClassModal({ open, onClose, onSuccess, editClass }: ClassModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ClassFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [subjectError, setSubjectError] = useState("");
  const [levelError, setLevelError] = useState("");

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [courseSearch, setCourseSearch] = useState("");
  const [courseDropdownOpen, setCourseDropdownOpen] = useState(false);

  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teacherDropdownOpen, setTeacherDropdownOpen] = useState(false);

  const isEdit = !!editClass;

  const fetchCourses = async () => {
    setCoursesLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error: fetchErr } = await supabase
        .from("courses")
        .select("id, name")
        .order("name", { ascending: true });

      if (!fetchErr && data) {
        setCourses(data);
      }
    } catch (err) {
      console.error("Failed to fetch courses:", err);
    } finally {
      setCoursesLoading(false);
    }
  };

  const fetchTeachers = async () => {
    setTeachersLoading(true);
    try {
      const supabase = getSupabase();
      const { data, error: fetchErr } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("role", ["vietnamese_teacher", "foreign_teacher"])
        .order("full_name", { ascending: true });

      if (!fetchErr && data) {
        setTeachers(data);
      }
    } catch (err) {
      console.error("Failed to fetch teachers:", err);
    } finally {
      setTeachersLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchCourses();
      fetchTeachers();
    }
  }, [open]);

  useEffect(() => {
    if (open && editClass) {
      setForm({
        name: editClass.name || "",
        course_id: editClass.course_id || "",
        teacher_id: editClass.teacher_id || "",
        subject: editClass.subject || "",
        level: editClass.level || "",
        room: editClass.room || "",
        max_students: editClass.max_students ?? 15,
        status: editClass.status || "active",
      });
      setNameError("");
      setSubjectError("");
      setLevelError("");
      setError("");
      setCourseSearch("");
      setTeacherSearch("");
      setCourseDropdownOpen(false);
      setTeacherDropdownOpen(false);
    } else if (open) {
      setForm(DEFAULT_FORM);
      setNameError("");
      setSubjectError("");
      setLevelError("");
      setError("");
      setCourseSearch("");
      setTeacherSearch("");
      setCourseDropdownOpen(false);
      setTeacherDropdownOpen(false);
    }
  }, [open, editClass]);

  const filteredCourses = courses.filter((c) =>
    !courseSearch || c.name.toLowerCase().includes(courseSearch.toLowerCase())
  );

  const filteredTeachers = teachers.filter((t) =>
    !teacherSearch || t.full_name.toLowerCase().includes(teacherSearch.toLowerCase())
  );

  const selectedCourse = courses.find((c) => c.id === form.course_id);
  const selectedTeacher = teachers.find((t) => t.id === form.teacher_id);

  const getRoleBadge = (role: string) => {
    if (role === "foreign_teacher") {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-accent-100 text-accent-700 whitespace-nowrap">
          {t("auth.adminCourseTeacherForeign")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-secondary-100 text-secondary-700 whitespace-nowrap">
        {t("auth.adminCourseTeacherVN")}
      </span>
    );
  };

  const validate = (): boolean => {
    let valid = true;
    if (!form.name.trim()) {
      setNameError(t("auth.adminClassNameRequired"));
      valid = false;
    } else {
      setNameError("");
    }
    if (!form.subject.trim()) {
      setSubjectError(t("auth.adminClassSubjectRequired"));
      valid = false;
    } else {
      setSubjectError("");
    }
    if (!form.level.trim()) {
      setLevelError(t("auth.adminClassLevelRequired"));
      valid = false;
    } else {
      setLevelError("");
    }
    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setSaving(true);
    try {
      const supabase = getSupabase();

      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        course_id: form.course_id || null,
        teacher_id: form.teacher_id || null,
        subject: form.subject.trim(),
        level: form.level.trim(),
        room: form.room.trim() || null,
        max_students: form.max_students,
        status: form.status,
      };

      if (isEdit) {
        const { error: updateErr } = await supabase
          .from("classes")
          .update(payload)
          .eq("id", editClass.id);

        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from("classes")
          .insert(payload);

        if (insertErr) throw insertErr;
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error("Class save error:", err);
      setError(t("auth.adminClassError"));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const title = isEdit ? t("auth.adminEditClass") : t("auth.adminCreateClass");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-foreground-950/40 backdrop-blur-sm"
        onClick={onClose}
      ></div>

      <div className="relative w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto bg-background-50 rounded-2xl border border-background-200 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-background-200 bg-background-50 rounded-t-2xl">
          <h3 className="font-heading text-lg font-semibold text-foreground-950">
            {title}
          </h3>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-200 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Class Name */}
          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("auth.adminClassName")} <span className="text-accent-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
                if (nameError) setNameError("");
              }}
              placeholder={t("auth.adminClassNamePlaceholder")}
              className={`w-full px-4 py-2.5 text-sm bg-background-50 border rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 transition-all duration-200 ${
                nameError
                  ? "border-accent-400 focus:border-accent-400 focus:ring-accent-400/20"
                  : "border-background-200 focus:border-primary-400 focus:ring-primary-400/20"
              }`}
            />
            {nameError && (
              <p className="mt-1 text-xs text-accent-500">{nameError}</p>
            )}
          </div>

          {/* Course */}
          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("auth.adminClassCourse")}
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setCourseDropdownOpen(!courseDropdownOpen);
                  setCourseSearch("");
                }}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 hover:border-background-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 cursor-pointer"
              >
                {selectedCourse ? (
                  <span className="text-foreground-900">{selectedCourse.name}</span>
                ) : (
                  <span className="text-foreground-400">{t("auth.adminClassCoursePlaceholder")}</span>
                )}
                <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform duration-200 ${courseDropdownOpen ? "rotate-180" : ""}`}></i>
              </button>

              {selectedCourse && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, course_id: "" }))}
                  className="absolute right-9 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-background-200 hover:bg-background-300 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                >
                  <i className="ri-close-line text-xs"></i>
                </button>
              )}

              {courseDropdownOpen && (
                <div className="absolute z-20 left-0 right-0 mt-1.5 max-h-52 overflow-y-auto bg-background-50 border border-background-200 rounded-xl shadow-lg">
                  <div className="sticky top-0 p-2 bg-background-50 border-b border-background-100">
                    <div className="relative">
                      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-xs"></i>
                      <input
                        type="text"
                        value={courseSearch}
                        onChange={(e) => setCourseSearch(e.target.value)}
                        placeholder={t("auth.adminSearchCourses")}
                        className="w-full pl-8 pr-3 py-2 text-xs bg-background-100 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  {coursesLoading ? (
                    <div className="px-4 py-3 text-xs text-foreground-400 flex items-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
                      {t("auth.adminClassLoading")}
                    </div>
                  ) : filteredCourses.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-foreground-400">
                      {t("auth.adminNoCourses")}
                    </div>
                  ) : (
                    filteredCourses.map((course) => (
                      <button
                        key={course.id}
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, course_id: course.id }));
                          setCourseDropdownOpen(false);
                          setCourseSearch("");
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-background-100 transition-colors cursor-pointer ${
                          form.course_id === course.id ? "bg-primary-50" : ""
                        }`}
                      >
                        <span className="text-foreground-900 flex-1 truncate">{course.name}</span>
                        {form.course_id === course.id && (
                          <i className="ri-check-line text-primary-500 text-sm flex-shrink-0"></i>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {courseDropdownOpen && (
              <div
                className="fixed inset-0 z-10"
                onClick={() => setCourseDropdownOpen(false)}
              ></div>
            )}
          </div>

          {/* Teacher */}
          <div>
            <label className="block text-sm font-medium text-foreground-800 mb-1.5">
              {t("auth.adminClassTeacher")}
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setTeacherDropdownOpen(!teacherDropdownOpen);
                  setTeacherSearch("");
                }}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 hover:border-background-300 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200 cursor-pointer"
              >
                {selectedTeacher ? (
                  <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-xs font-semibold text-primary-700">
                      {selectedTeacher.full_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-foreground-900">{selectedTeacher.full_name}</span>
                    {getRoleBadge(selectedTeacher.role)}
                  </span>
                ) : (
                  <span className="text-foreground-400">{t("auth.adminClassTeacherPlaceholder")}</span>
                )}
                <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform duration-200 ${teacherDropdownOpen ? "rotate-180" : ""}`}></i>
              </button>

              {selectedTeacher && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, teacher_id: "" }))}
                  className="absolute right-9 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-background-200 hover:bg-background-300 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
                >
                  <i className="ri-close-line text-xs"></i>
                </button>
              )}

              {teacherDropdownOpen && (
                <div className="absolute z-20 left-0 right-0 mt-1.5 max-h-52 overflow-y-auto bg-background-50 border border-background-200 rounded-xl shadow-lg">
                  <div className="sticky top-0 p-2 bg-background-50 border-b border-background-100">
                    <div className="relative">
                      <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-xs"></i>
                      <input
                        type="text"
                        value={teacherSearch}
                        onChange={(e) => setTeacherSearch(e.target.value)}
                        placeholder={t("auth.adminSearchTeachers")}
                        className="w-full pl-8 pr-3 py-2 text-xs bg-background-100 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  {teachersLoading ? (
                    <div className="px-4 py-3 text-xs text-foreground-400 flex items-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
                      {t("auth.adminClassLoading")}
                    </div>
                  ) : filteredTeachers.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-foreground-400">
                      {t("auth.adminNoTeachers")}
                    </div>
                  ) : (
                    filteredTeachers.map((teacher) => (
                      <button
                        key={teacher.id}
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, teacher_id: teacher.id }));
                          setTeacherDropdownOpen(false);
                          setTeacherSearch("");
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-background-100 transition-colors cursor-pointer ${
                          form.teacher_id === teacher.id ? "bg-primary-50" : ""
                        }`}
                      >
                        <span className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-xs font-semibold text-primary-700 flex-shrink-0">
                          {teacher.full_name.charAt(0).toUpperCase()}
                        </span>
                        <span className="text-foreground-900 flex-1 truncate">{teacher.full_name}</span>
                        {getRoleBadge(teacher.role)}
                        {form.teacher_id === teacher.id && (
                          <i className="ri-check-line text-primary-500 text-sm flex-shrink-0"></i>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {teacherDropdownOpen && (
              <div
                className="fixed inset-0 z-10"
                onClick={() => setTeacherDropdownOpen(false)}
              ></div>
            )}
          </div>

          {/* Subject & Level */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground-800 mb-1.5">
                {t("auth.adminSubject")} <span className="text-accent-500">*</span>
              </label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => {
                  setForm((f) => ({ ...f, subject: e.target.value }));
                  if (subjectError) setSubjectError("");
                }}
                placeholder={t("auth.adminClassSubjectPlaceholder")}
                className={`w-full px-4 py-2.5 text-sm bg-background-50 border rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 transition-all duration-200 ${
                  subjectError
                    ? "border-accent-400 focus:border-accent-400 focus:ring-accent-400/20"
                    : "border-background-200 focus:border-primary-400 focus:ring-primary-400/20"
                }`}
              />
              {subjectError && (
                <p className="mt-1 text-xs text-accent-500">{subjectError}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground-800 mb-1.5">
                {t("auth.adminLevel")} <span className="text-accent-500">*</span>
              </label>
              <input
                type="text"
                value={form.level}
                onChange={(e) => {
                  setForm((f) => ({ ...f, level: e.target.value }));
                  if (levelError) setLevelError("");
                }}
                placeholder={t("auth.adminClassLevelPlaceholder")}
                className={`w-full px-4 py-2.5 text-sm bg-background-50 border rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:ring-2 transition-all duration-200 ${
                  levelError
                    ? "border-accent-400 focus:border-accent-400 focus:ring-accent-400/20"
                    : "border-background-200 focus:border-primary-400 focus:ring-primary-400/20"
                }`}
              />
              {levelError && (
                <p className="mt-1 text-xs text-accent-500">{levelError}</p>
              )}
            </div>
          </div>

          {/* Room & Max Students */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground-800 mb-1.5">
                {t("auth.adminClassRoom")}
              </label>
              <input
                type="text"
                value={form.room}
                onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))}
                placeholder={t("auth.adminClassRoomPlaceholder")}
                className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground-800 mb-1.5">
                {t("auth.adminClassMaxStudents")}
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={form.max_students}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    max_students: Math.max(1, parseInt(e.target.value) || 15),
                  }))
                }
                className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all duration-200"
              />
            </div>
          </div>

          {/* Status Toggle */}
          <div className="flex items-center justify-between py-1">
            <div>
              <label className="text-sm font-medium text-foreground-800">
                {t("auth.adminClassIsActive")}
              </label>
              <p className="text-xs text-foreground-400">
                {form.status === "active" ? t("auth.adminActive") : t("auth.adminDraft")}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setForm((f) => ({ ...f, status: f.status === "active" ? "draft" : "active" }))
              }
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer ${
                form.status === "active" ? "bg-primary-500" : "bg-background-300"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                  form.status === "active" ? "left-[calc(100%-1.375rem)]" : "left-0.5"
                }`}
              ></span>
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-accent-50 border border-accent-200 text-sm text-accent-700 flex items-center gap-2">
              <i className="ri-error-warning-line text-base flex-shrink-0"></i>
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-foreground-700 bg-background-100 hover:bg-background-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {t("auth.adminCancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-background-50 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              )}
              {saving
                ? isEdit
                  ? t("auth.adminClassUpdating")
                  : t("auth.adminClassCreating")
                : isEdit
                  ? t("auth.adminSave")
                  : t("auth.adminCreateClass")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}