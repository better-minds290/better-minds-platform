import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getSupabase } from "@/lib/supabase";

interface MaterialFile {
  file_name: string;
  file_path: string;
  file_size?: number;
}

interface SessionData {
  session_number: number;
  title: string;
  description: string;
  materials: MaterialFile[];
}

interface SprintTemplate {
  id: string;
  course_id: string;
  sprint_number: number;
  title: string;
  objectives: string;
  vocabulary: unknown[];
  reading_material: string;
  exercises: unknown[];
  sessions_data: SessionData[];
}

interface SprintContentModalProps {
  open: boolean;
  onClose: () => void;
  courseId: string;
  courseName: string;
}

const EMPTY_SESSIONS: SessionData[] = [
  { session_number: 1, title: "", description: "", materials: [] },
  { session_number: 2, title: "", description: "", materials: [] },
  { session_number: 3, title: "", description: "", materials: [] },
];

const SESSION_LABELS = ["Session 1", "Session 2", "Session 3"];

export default function SprintContentModal({ open, onClose, courseId, courseName }: SprintContentModalProps) {
  const { t } = useTranslation();
  const supabase = getSupabase();

  const [templates, setTemplates] = useState<SprintTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [expandedSprint, setExpandedSprint] = useState<string | null>(null);
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});
  const [toastMap, setToastMap] = useState<Record<string, { type: "success" | "error"; message: string }>>({});
  const [uploadingMap, setUploadingMap] = useState<Record<string, boolean>>({});

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    setExpandedSprint(null);
    try {
      const { data, error } = await supabase
        .from("course_sprint_templates")
        .select("*")
        .eq("course_id", courseId)
        .order("sprint_number", { ascending: true });

      if (error) throw error;
      setTemplates((data || []) as SprintTemplate[]);
    } catch (err) {
      console.error("Failed to fetch sprint templates:", err);
    } finally {
      setLoadingTemplates(false);
    }
  }, [courseId, supabase]);

  useEffect(() => {
    if (!open || !courseId) return;
    fetchTemplates();
  }, [open, courseId, fetchTemplates]);

  const handleToggleSprint = (sprintId: string) => {
    setExpandedSprint((prev) => (prev === sprintId ? null : sprintId));
  };

  const updateTemplate = (sprintId: string, updater: (t: SprintTemplate) => SprintTemplate) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === sprintId ? updater(t) : t))
    );
  };

  const updateSessionTitle = (sprintId: string, sessionIdx: number, value: string) => {
    updateTemplate(sprintId, (t) => {
      const updated = [...t.sessions_data];
      updated[sessionIdx] = { ...updated[sessionIdx], title: value };
      return { ...t, sessions_data: updated };
    });
  };

  const updateSessionDescription = (sprintId: string, sessionIdx: number, value: string) => {
    updateTemplate(sprintId, (t) => {
      const updated = [...t.sessions_data];
      updated[sessionIdx] = { ...updated[sessionIdx], description: value };
      return { ...t, sessions_data: updated };
    });
  };

  const getContentTypeFromExt = (file: File): string => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      txt: "text/plain",
      zip: "application/zip",
    };
    // Fallback: if browser says zip but weird type, force to application/zip
    if (ext === "zip" || file.type === "application/x-zip-compressed") return "application/zip";
    return mimeMap[ext || ""] || file.type || "application/octet-stream";
  };

  const handleFileUpload = async (sprintId: string, sessionIdx: number, file: File) => {
    const uploadKey = `${sprintId}-${sessionIdx}`;
    setUploadingMap((prev) => ({ ...prev, [uploadKey]: true }));

    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `course-${courseId}/sprint-${sprintId}/${fileName}`;
      const contentType = getContentTypeFromExt(file);

      let uploadResult;
      // Workaround: Supabase Storage rejects application/x-zip-compressed.
      // Convert to ArrayBuffer so Supabase trusts our contentType instead of re-detecting.
      if (file.type === "application/x-zip-compressed" || file.type === "application/x-compressed") {
        const arrayBuffer = await file.arrayBuffer();
        uploadResult = await supabase.storage
          .from("sprint-materials")
          .upload(filePath, arrayBuffer, { upsert: false, contentType });
      } else {
        uploadResult = await supabase.storage
          .from("sprint-materials")
          .upload(filePath, file, { upsert: false, contentType });
      }

      const { data: uploadData, error: uploadErr } = uploadResult;

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from("sprint-materials")
        .getPublicUrl(filePath);

      const newMaterial: MaterialFile = {
        file_name: file.name,
        file_path: urlData.publicUrl,
        file_size: file.size,
      };

      updateTemplate(sprintId, (t) => {
        const updated = [...t.sessions_data];
        updated[sessionIdx] = {
          ...updated[sessionIdx],
          materials: [...updated[sessionIdx].materials, newMaterial],
        };
        return { ...t, sessions_data: updated };
      });

      setToastMap((prev) => ({
        ...prev,
        [sprintId]: { type: "success", message: `"${file.name}" uploaded!` },
      }));
      setTimeout(() => {
        setToastMap((prev) => {
          const next = { ...prev };
          delete next[sprintId];
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error("Upload error:", err);
      setToastMap((prev) => ({
        ...prev,
        [sprintId]: { type: "error", message: "Upload failed. Try again." },
      }));
    } finally {
      setUploadingMap((prev) => ({ ...prev, [uploadKey]: false }));
    }
  };

  const handleRemoveFile = async (sprintId: string, sessionIdx: number, fileIdx: number) => {
    const template = templates.find((t) => t.id === sprintId);
    if (!template) return;

    const fileToRemove = template.sessions_data[sessionIdx]?.materials[fileIdx];
    if (!fileToRemove) return;

    try {
      const publicUrl = fileToRemove.file_path;
      const bucketPath = publicUrl.split("sprint-materials/")[1];
      if (bucketPath) {
        const { error: deleteErr } = await supabase.storage
          .from("sprint-materials")
          .remove([decodeURIComponent(bucketPath)]);
        if (deleteErr) {
          console.error("Storage delete error:", deleteErr);
        }
      }
    } catch (err) {
      console.error("Failed to delete from storage:", err);
    }

    updateTemplate(sprintId, (t) => {
      const updated = [...t.sessions_data];
      updated[sessionIdx] = {
        ...updated[sessionIdx],
        materials: updated[sessionIdx].materials.filter((_, i) => i !== fileIdx),
      };
      return { ...t, sessions_data: updated };
    });
  };

  const handleSave = async (sprintId: string) => {
    const template = templates.find((t) => t.id === sprintId);
    if (!template) return;

    setSavingMap((prev) => ({ ...prev, [sprintId]: true }));
    try {
      const { error } = await supabase
        .from("course_sprint_templates")
        .update({
          sessions_data: template.sessions_data,
          title: template.title,
          objectives: template.objectives,
          vocabulary: template.vocabulary,
          reading_material: template.reading_material,
          exercises: template.exercises,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sprintId);

      if (error) throw error;

      setToastMap((prev) => ({
        ...prev,
        [sprintId]: { type: "success", message: "Content saved!" },
      }));
      setTimeout(() => {
        setToastMap((prev) => {
          const next = { ...prev };
          delete next[sprintId];
          return next;
        });
      }, 3000);
    } catch (err) {
      console.error("Save error:", err);
      setToastMap((prev) => ({
        ...prev,
        [sprintId]: { type: "error", message: "Save failed." },
      }));
    } finally {
      setSavingMap((prev) => ({ ...prev, [sprintId]: false }));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-foreground-950/40 backdrop-blur-sm"
        onClick={onClose}
      ></div>

      <div className="relative w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto bg-background-50 rounded-2xl border border-background-200 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-background-200 bg-background-50 rounded-t-2xl">
          <div>
            <h3 className="font-heading text-lg font-semibold text-foreground-950">
              Sprint Content — {courseName}
            </h3>
            <p className="text-xs text-foreground-400 mt-0.5">
              Manage session titles and in-class materials for each sprint
            </p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-200 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>

        <div className="p-6">
          {loadingTemplates ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-16 bg-background-100 rounded-lg animate-pulse"></div>
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 mx-auto flex items-center justify-center rounded-2xl bg-background-100 text-foreground-400 mb-3">
                <i className="ri-run-line text-xl"></i>
              </div>
              <p className="text-sm text-foreground-500 font-medium">No sprint templates yet</p>
              <p className="text-xs text-foreground-400 mt-1">
                Create a new course to auto-generate sprint templates ready for content editing (up to 24 sprints).
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => {
                const isExpanded = expandedSprint === template.id;
                const isSaving = savingMap[template.id];
                const toast = toastMap[template.id];

                return (
                  <div
                    key={template.id}
                    className="rounded-xl border border-background-200 bg-background-50 overflow-hidden transition-all duration-200"
                  >
                    {/* Sprint Header — clickable */}
                    <button
                      onClick={() => handleToggleSprint(template.id)}
                      className="w-full flex items-center justify-between px-5 py-4 hover:bg-background-100 transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-primary-100 text-primary-700 font-bold text-sm">
                          {template.sprint_number}
                        </div>
                        <div>
                          <span className="text-sm font-semibold text-foreground-900">
                            Sprint {template.sprint_number}
                          </span>
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-background-200 text-foreground-500 whitespace-nowrap">
                            template
                          </span>
                        </div>
                      </div>
                      <i
                        className={`ri-arrow-down-s-line text-foreground-400 transition-transform duration-200 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      ></i>
                    </button>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t border-background-200 px-5 py-5 bg-background-50">
                        <div className="space-y-5">
                          {template.sessions_data.map((session, sIdx) => {
                            const uploadKey = `${template.id}-${sIdx}`;
                            const isUploading = uploadingMap[uploadKey];

                            return (
                              <div
                                key={session.session_number}
                                className="p-4 rounded-lg bg-background-100 border border-background-200"
                              >
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-secondary-100 text-secondary-700 text-xs font-bold">
                                    {session.session_number}
                                  </span>
                                  <label className="text-sm font-semibold text-foreground-700">
                                    {SESSION_LABELS[sIdx]}
                                  </label>
                                </div>

                                {/* Session Title */}
                                <div className="mb-3">
                                  <label className="block text-xs font-medium text-foreground-500 mb-1">
                                    Session Title
                                  </label>
                                  <input
                                    type="text"
                                    value={session.title}
                                    onChange={(e) => updateSessionTitle(template.id, sIdx, e.target.value)}
                                    placeholder={`e.g. Introduction to Unit ${template.sprint_number}`}
                                    className="w-full px-3.5 py-2 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all"
                                  />
                                </div>

                                {/* Session Description */}
                                <div className="mb-3">
                                  <label className="block text-xs font-medium text-foreground-500 mb-1">
                                    Session Description
                                  </label>
                                  <textarea
                                    value={session.description || ""}
                                    onChange={(e) => updateSessionDescription(template.id, sIdx, e.target.value)}
                                    placeholder="Describe what this session covers, learning goals, activities..."
                                    rows={3}
                                    maxLength={500}
                                    className="w-full px-3.5 py-2 text-sm bg-background-50 border border-background-200 rounded-lg text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all resize-none"
                                  />
                                  <p className="text-[11px] text-foreground-400 mt-1">
                                    Brief description of this session — visible to both learners and teachers alongside materials.
                                  </p>
                                </div>

                                {/* In-class Materials */}
                                <div>
                                  <label className="block text-xs font-medium text-foreground-500 mb-2">
                                    In-class Materials
                                  </label>

                                  {/* Existing files */}
                                  {session.materials.length > 0 && (
                                    <div className="space-y-1.5 mb-2.5">
                                      {session.materials.map((mat, mIdx) => (
                                        <div
                                          key={mIdx}
                                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-background-50 border border-background-200"
                                        >
                                          <a
                                            href={mat.file_path}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 flex-1 min-w-0 text-sm text-primary-600 hover:text-primary-700 transition-colors cursor-pointer"
                                          >
                                            <i className="ri-file-line text-foreground-400 flex-shrink-0"></i>
                                            <span className="truncate">{mat.file_name}</span>
                                            {mat.file_size && (
                                              <span className="text-xs text-foreground-400 flex-shrink-0 whitespace-nowrap">
                                                {(mat.file_size / 1024).toFixed(0)} KB
                                              </span>
                                            )}
                                          </a>
                                          <button
                                            onClick={() => handleRemoveFile(template.id, sIdx, mIdx)}
                                            className="w-6 h-6 flex items-center justify-center rounded-md text-foreground-400 hover:text-accent-500 hover:bg-accent-50 transition-colors cursor-pointer flex-shrink-0"
                                            title="Remove file"
                                          >
                                            <i className="ri-close-line text-sm"></i>
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Upload button */}
                                  <label
                                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium border border-dashed border-background-300 bg-background-50 hover:border-primary-400 hover:bg-primary-50/50 transition-all cursor-pointer whitespace-nowrap ${
                                      isUploading ? "opacity-60 pointer-events-none" : ""
                                    }`}
                                  >
                                    {isUploading ? (
                                      <>
                                        <div className="w-3.5 h-3.5 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin"></div>
                                        Uploading...
                                      </>
                                    ) : (
                                      <>
                                        <i className="ri-upload-line text-sm"></i>
                                        Upload File
                                      </>
                                    )}
                                    <input
                                      type="file"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleFileUpload(template.id, sIdx, file);
                                        e.target.value = "";
                                      }}
                                      accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.zip"
                                    />
                                  </label>
                                  <span className="ml-2 text-[11px] text-foreground-400">
                                    PDF, DOC, PPT, images, ZIP up to 50MB
                                  </span>
                                </div>
                              </div>
                            );
                          })}

                          {/* Toast */}
                          {toast && (
                            <div
                              className={`flex items-center gap-2 p-3 rounded-md text-sm ${
                                toast.type === "success"
                                  ? "bg-accent-100 text-accent-700"
                                  : "bg-accent-100 text-accent-700"
                              }`}
                            >
                              <i className={toast.type === "success" ? "ri-check-line" : "ri-error-warning-line"}></i>
                              {toast.message}
                            </div>
                          )}

                          {/* Save Button */}
                          <div className="flex justify-end pt-1">
                            <button
                              onClick={() => handleSave(template.id)}
                              disabled={isSaving}
                              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-semibold bg-primary-500 text-background-50 hover:bg-primary-600 transition-colors duration-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
                            >
                              {isSaving ? (
                                <>
                                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <i className="ri-save-line"></i>
                                  Save Sprint {template.sprint_number}
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}