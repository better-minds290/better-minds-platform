import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";
import SprintContentModal from "./SprintContentModal";

interface VocabularyItem {
  word: string;
  definition: string;
  example: string;
}

interface ExerciseItem {
  instruction: string;
  content: string;
}

interface SprintContentData {
  title: string;
  objectives: string;
  vocabulary: VocabularyItem[];
  reading_material: string;
  exercises: ExerciseItem[];
}

interface CourseOption {
  id: string;
  name: string;
  level: string;
  total_sprints: number;
}

const emptyContent: SprintContentData = {
  title: "",
  objectives: "",
  vocabulary: [],
  reading_material: "",
  exercises: [],
};

export default function AdminSprintContent() {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedCourse, setSelectedCourse] = useState<CourseOption | null>(null);
  const [selectedSprintNum, setSelectedSprintNum] = useState<number>(1);
  const [content, setContent] = useState<SprintContentData>(emptyContent);
  const [contentId, setContentId] = useState<string | null>(null);

  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  // SprintContentModal state
  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);

  // Fetch courses
  useEffect(() => {
    const fetchCourses = async () => {
      setLoadingCourses(true);
      try {
        const { data, error } = await supabase
          .from("courses")
          .select("id, name, level, total_sprints")
          .order("name", { ascending: true });

        if (error) throw error;
        setCourses(data || []);
      } catch (err) {
        console.error("Failed to fetch courses:", err);
      } finally {
        setLoadingCourses(false);
      }
    };
    fetchCourses();
  }, [supabase]);

  // When course changes, reset
  const handleCourseChange = (courseId: string) => {
    setSelectedCourseId(courseId);
    const course = courses.find((c) => c.id === courseId) || null;
    setSelectedCourse(course);
    setSelectedSprintNum(1);
    setContent(emptyContent);
    setContentId(null);
  };

  // Fetch content when course + sprint number changes
  useEffect(() => {
    if (!selectedCourseId) {
      setContent(emptyContent);
      setContentId(null);
      return;
    }

    const fetchContent = async () => {
      setLoadingContent(true);
      try {
        const { data, error } = await supabase
          .from("course_sprint_templates")
          .select("*")
          .eq("course_id", selectedCourseId)
          .eq("sprint_number", selectedSprintNum)
          .maybeSingle();

        if (error && !error.message.includes("No rows found")) throw error;

        if (data) {
          setContentId(data.id);
          setContent({
            title: data.title || "",
            objectives: data.objectives || "",
            vocabulary: data.vocabulary || [],
            reading_material: data.reading_material || "",
            exercises: data.exercises || [],
          });
        } else {
          setContentId(null);
          setContent(emptyContent);
        }
      } catch (err) {
        console.error("Failed to fetch content:", err);
      } finally {
        setLoadingContent(false);
      }
    };
    fetchContent();
  }, [selectedCourseId, selectedSprintNum, supabase]);

  const handleSave = useCallback(async () => {
    if (!selectedCourseId) return;
    setSaving(true);
    setSaveStatus("idle");
    try {
      // Fetch existing record to preserve sessions_data
      const { data: existing } = await supabase
        .from("course_sprint_templates")
        .select("sessions_data")
        .eq("course_id", selectedCourseId)
        .eq("sprint_number", selectedSprintNum)
        .maybeSingle();

      const payload: Record<string, unknown> = {
        course_id: selectedCourseId,
        sprint_number: selectedSprintNum,
        ...content,
      };

      // Preserve sessions_data from existing record
      if (existing?.sessions_data) {
        payload.sessions_data = existing.sessions_data;
      }

      if (contentId) {
        const { error } = await supabase
          .from("course_sprint_templates")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", contentId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("course_sprint_templates")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        if (data) setContentId(data.id);
      }
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      console.error("Failed to save content:", err);
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }, [selectedCourseId, selectedSprintNum, contentId, content, supabase]);

  const updateField = (field: keyof SprintContentData, value: string) => {
    setContent((prev) => ({ ...prev, [field]: value }));
  };

  const addVocabularyItem = () => {
    setContent((prev) => ({
      ...prev,
      vocabulary: [...prev.vocabulary, { word: "", definition: "", example: "" }],
    }));
  };

  const updateVocabularyItem = (idx: number, field: keyof VocabularyItem, value: string) => {
    setContent((prev) => {
      const updated = [...prev.vocabulary];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, vocabulary: updated };
    });
  };

  const removeVocabularyItem = (idx: number) => {
    setContent((prev) => ({
      ...prev,
      vocabulary: prev.vocabulary.filter((_, i) => i !== idx),
    }));
  };

  const addExercise = () => {
    setContent((prev) => ({
      ...prev,
      exercises: [...prev.exercises, { instruction: "", content: "" }],
    }));
  };

  const updateExercise = (idx: number, field: keyof ExerciseItem, value: string) => {
    setContent((prev) => {
      const updated = [...prev.exercises];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, exercises: updated };
    });
  };

  const removeExercise = (idx: number) => {
    setContent((prev) => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== idx),
    }));
  };

  const selectedCourseName = selectedCourse?.name || "";
  const totalSprints = selectedCourse?.total_sprints || 1;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-heading text-xl font-bold text-foreground-950 mb-1">
              Sprint Content Management
            </h2>
            <p className="text-sm text-foreground-500">
              Manage self-study materials for each sprint. Content is shown to learners during Session 1 (Self-Study).
            </p>
          </div>
          {selectedCourseId && (
            <button
              onClick={() => setSessionsModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold bg-secondary-500 text-background-50 hover:bg-secondary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer"
            >
              <i className="ri-vidicon-line"></i>
              Sessions &amp; Meeting Links
            </button>
          )}
        </div>
      </div>

      {/* Course & Sprint Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 p-5 rounded-lg bg-background-100 border border-background-200/70">
        <div>
          <label className="block text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">
            Select Course
          </label>
          {loadingCourses ? (
            <div className="h-10 bg-background-200 rounded-lg animate-pulse"></div>
          ) : (
            <select
              value={selectedCourseId}
              onChange={(e) => handleCourseChange(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all cursor-pointer"
            >
              <option value="">-- Select a course --</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.level}) — {c.total_sprints} sprints
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">
            Select Sprint
          </label>
          <select
            value={selectedSprintNum}
            onChange={(e) => setSelectedSprintNum(Number(e.target.value))}
            disabled={!selectedCourseId}
            className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {Array.from({ length: totalSprints }, (_, i) => i + 1).map((num) => (
              <option key={num} value={num}>
                Sprint {num}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Content Editor */}
      {loadingContent ? (
        <div className="animate-pulse space-y-4 p-6 rounded-lg bg-background-50 border border-background-200">
          <div className="h-8 bg-background-200 rounded w-1/3"></div>
          <div className="h-24 bg-background-200 rounded"></div>
          <div className="h-24 bg-background-200 rounded"></div>
          <div className="h-32 bg-background-200 rounded"></div>
        </div>
      ) : selectedCourseId ? (
        <div className="space-y-6 p-6 rounded-lg bg-background-50 border border-background-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-heading text-lg font-bold text-foreground-950">
                {selectedCourseName} — Sprint {selectedSprintNum}
              </h3>
              <p className="text-xs text-foreground-400 mt-0.5">Self-Study Session Materials</p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Saving...
                </>
              ) : (
                <>
                  <i className="ri-save-line"></i>
                  Save Content
                </>
              )}
            </button>
          </div>

          {saveStatus === "success" && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-accent-100 text-accent-700 text-sm">
              <i className="ri-check-line"></i> Content saved successfully!
            </div>
          )}
          {saveStatus === "error" && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-accent-100 text-accent-700 text-sm">
              <i className="ri-error-warning-line"></i> Failed to save. Please try again.
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-foreground-700 mb-1.5">
              Sprint Title <span className="text-accent-500">*</span>
            </label>
            <input
              type="text"
              value={content.title}
              onChange={(e) => updateField("title", e.target.value)}
              placeholder="e.g. Unit 1: Everyday Communication"
              className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all"
            />
          </div>

          {/* Objectives */}
          <div>
            <label className="block text-sm font-semibold text-foreground-700 mb-1.5">
              Learning Objectives
            </label>
            <textarea
              value={content.objectives}
              onChange={(e) => updateField("objectives", e.target.value)}
              placeholder="Describe what learners will achieve in this self-study session..."
              rows={3}
              className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all resize-none"
            />
          </div>

          {/* Vocabulary */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-foreground-700">Vocabulary</label>
              <button
                onClick={addVocabularyItem}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-add-line"></i> Add Word
              </button>
            </div>
            {content.vocabulary.length === 0 ? (
              <p className="text-xs text-foreground-400 py-3 text-center bg-background-100 rounded-lg border border-dashed border-background-300">
                No vocabulary items yet. Click "Add Word" to start.
              </p>
            ) : (
              <div className="space-y-3">
                {content.vocabulary.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-3 rounded-lg bg-background-100 border border-background-200">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={item.word}
                        onChange={(e) => updateVocabularyItem(idx, "word", e.target.value)}
                        placeholder="Word / Phrase"
                        className="px-3 py-2 text-sm bg-background-50 border border-background-200 rounded-md focus:outline-none focus:border-primary-400 transition-all"
                      />
                      <input
                        type="text"
                        value={item.definition}
                        onChange={(e) => updateVocabularyItem(idx, "definition", e.target.value)}
                        placeholder="Definition"
                        className="px-3 py-2 text-sm bg-background-50 border border-background-200 rounded-md focus:outline-none focus:border-primary-400 transition-all"
                      />
                      <input
                        type="text"
                        value={item.example}
                        onChange={(e) => updateVocabularyItem(idx, "example", e.target.value)}
                        placeholder="Example sentence"
                        className="px-3 py-2 text-sm bg-background-50 border border-background-200 rounded-md focus:outline-none focus:border-primary-400 transition-all"
                      />
                    </div>
                    <button
                      onClick={() => removeVocabularyItem(idx)}
                      className="w-8 h-8 flex items-center justify-center rounded-md text-foreground-400 hover:text-accent-600 hover:bg-accent-50 transition-colors cursor-pointer flex-shrink-0"
                    >
                      <i className="ri-delete-bin-line"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reading Material */}
          <div>
            <label className="block text-sm font-semibold text-foreground-700 mb-1.5">
              Reading Material
            </label>
            <textarea
              value={content.reading_material}
              onChange={(e) => updateField("reading_material", e.target.value)}
              placeholder="Provide reading material, articles, or passages for learners to study..."
              rows={6}
              className="w-full px-4 py-2.5 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all resize-none"
            />
          </div>

          {/* Exercises */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-foreground-700">Exercises</label>
              <button
                onClick={addExercise}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-secondary-100 text-secondary-700 hover:bg-secondary-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-add-line"></i> Add Exercise
              </button>
            </div>
            {content.exercises.length === 0 ? (
              <p className="text-xs text-foreground-400 py-3 text-center bg-background-100 rounded-lg border border-dashed border-background-300">
                No exercises yet. Click "Add Exercise" to start.
              </p>
            ) : (
              <div className="space-y-3">
                {content.exercises.map((ex, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-background-100 border border-background-200">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-semibold text-foreground-400">
                        Exercise {idx + 1}
                      </span>
                      <button
                        onClick={() => removeExercise(idx)}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-foreground-400 hover:text-accent-600 hover:bg-accent-50 transition-colors cursor-pointer"
                      >
                        <i className="ri-delete-bin-line"></i>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={ex.instruction}
                      onChange={(e) => updateExercise(idx, "instruction", e.target.value)}
                      placeholder="e.g. Fill in the blanks with the correct form of the verb..."
                      className="w-full px-3 py-2 text-sm bg-background-50 border border-background-200 rounded-md mb-2 focus:outline-none focus:border-primary-400 transition-all"
                    />
                    <textarea
                      value={ex.content}
                      onChange={(e) => updateExercise(idx, "content", e.target.value)}
                      placeholder="Exercise content / questions..."
                      rows={4}
                      className="w-full px-3 py-2 text-sm bg-background-50 border border-background-200 rounded-md focus:outline-none focus:border-primary-400 transition-all resize-none"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bottom save button */}
          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Saving...
                </>
              ) : (
                <>
                  <i className="ri-save-line"></i>
                  Save Content
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 bg-background-50 border border-dashed border-background-300 rounded-lg">
          <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-background-200 text-foreground-400 mb-4">
            <i className="ri-file-text-line text-2xl"></i>
          </div>
          <h3 className="text-lg font-bold text-foreground-700 mb-1">Select a Course</h3>
          <p className="text-sm text-foreground-500 max-w-sm mx-auto">
            Choose a course and sprint above to edit its self-study content.
          </p>
        </div>
      )}

      {/* Session Management Modal */}
      <SprintContentModal
        open={sessionsModalOpen}
        onClose={() => setSessionsModalOpen(false)}
        courseId={selectedCourseId}
        courseName={selectedCourseName}
      />
    </div>
  );
}