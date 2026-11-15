import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import {
  addLessonLink,
  bindLessonMaterialsDb,
  canDeleteLessonMaterial,
  canReadLessonMaterial,
  canUploadLessonMaterial,
  createLessonMaterialDownloadUrl,
  deleteLessonMaterial,
  isLessonMaterialFailure,
  loadLessonMaterials,
  uploadLessonFile,
  validateMaterialLink,
  type LessonMaterialActor,
  type LessonMaterialErrorCode,
  type LessonMaterialRow,
} from "@/lib/lessonMaterials";

const ACCEPT = ".pdf,.docx,.pptx,.png,.jpg,.jpeg,.gif,.webp,.bmp";

function actorFor(
  profile: { id: string; role: string; is_active: boolean | null },
  scheduleTeacherId: string | null
): LessonMaterialActor {
  return {
    userId: profile.id,
    role: profile.role,
    isActive: profile.is_active,
    scheduleTeacherId,
  };
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LessonAdditionalMaterials({
  scheduleId,
  scheduleTeacherId = null,
  startOpen = false,
}: {
  scheduleId: string;
  scheduleTeacherId?: string | null;
  startOpen?: boolean;
}) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [open, setOpen] = useState(startOpen);
  const [materials, setMaterials] = useState<LessonMaterialRow[]>([]);
  const [loading, setLoading] = useState(startOpen);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [errorCode, setErrorCode] = useState<LessonMaterialErrorCode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LessonMaterialRow | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const actor = profile ? actorFor(profile, scheduleTeacherId) : null;
  const canUpload = actor ? canUploadLessonMaterial(actor) : false;
  const canRead = actor ? canReadLessonMaterial(actor) : false;

  const showError = (code: LessonMaterialErrorCode) => {
    setNotice(null);
    setErrorCode(code);
  };

  useEffect(() => {
    if (!open || !profile || !canRead) return;
    const current = actorFor(profile, scheduleTeacherId);
    let cancelled = false;
    setLoading(true);
    setErrorCode(null);
    loadLessonMaterials(bindLessonMaterialsDb(getSupabase()), current, scheduleId)
      .then((result) => {
        if (cancelled) return;
        if (isLessonMaterialFailure(result)) {
          setErrorCode(result.code);
          setMaterials([]);
          return;
        }
        setMaterials(result.materials);
      })
      .catch(() => {
        if (!cancelled) setErrorCode("list_failed");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setHasLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, scheduleId, profile, scheduleTeacherId, canRead, reloadToken]);

  const resetDraft = () => {
    setTitle("");
    setNotes("");
    setLinkUrl("");
    setFile(null);
  };

  const onUpload = async () => {
    if (!actor || !file) {
      showError("invalid_file");
      return;
    }
    setSaving(true);
    setErrorCode(null);
    setNotice(null);
    const result = await uploadLessonFile(bindLessonMaterialsDb(getSupabase()), actor, {
      scheduleId,
      title,
      notes,
      file: { name: file.name, type: file.type, size: file.size, body: file },
    });
    setSaving(false);
    if (isLessonMaterialFailure(result)) {
      showError(result.code);
      return;
    }
    resetDraft();
    setNotice(t("lessonMaterials.uploaded"));
    setReloadToken((current) => current + 1);
  };

  const onAddLink = async () => {
    if (!actor) return;
    setSaving(true);
    setErrorCode(null);
    setNotice(null);
    const result = await addLessonLink(bindLessonMaterialsDb(getSupabase()), actor, {
      scheduleId,
      title,
      notes,
      linkUrl,
    });
    setSaving(false);
    if (isLessonMaterialFailure(result)) {
      showError(result.code);
      return;
    }
    resetDraft();
    setNotice(t("lessonMaterials.uploaded"));
    setReloadToken((current) => current + 1);
  };

  const onDelete = async () => {
    if (!actor || !deleteTarget) return;
    setSaving(true);
    const result = await deleteLessonMaterial(bindLessonMaterialsDb(getSupabase()), actor, deleteTarget, scheduleId);
    setSaving(false);
    if (isLessonMaterialFailure(result)) {
      showError(result.code);
      setDeleteTarget(null);
      return;
    }
    setMaterials((current) => current.filter((item) => item.id !== deleteTarget.id));
    setDeleteTarget(null);
    setNotice(t("lessonMaterials.deleted"));
  };

  const onOpen = async (material: LessonMaterialRow) => {
    if (!actor) return;
    if (material.kind === "link") {
      const link = validateMaterialLink(material.link_url || "");
      if (typeof link !== "string") {
        showError("invalid_link");
        return;
      }
      window.open(link, "_blank", "noopener,noreferrer");
      return;
    }
    setOpeningId(material.id);
    const result = await createLessonMaterialDownloadUrl(
      bindLessonMaterialsDb(getSupabase()),
      actor,
      material,
      scheduleId
    );
    setOpeningId(null);
    if (isLessonMaterialFailure(result)) {
      showError(result.code);
      return;
    }
    window.open(result.signedUrl, "_blank", "noopener,noreferrer");
  };

  if (!profile || !canRead) return null;

  return (
    <div className="mt-3 rounded-lg border border-background-200 bg-background-50" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer"
      >
        <i className="ri-folder-add-line text-primary-600"></i>
        <span className="text-sm font-semibold text-foreground-900">{t("lessonMaterials.title")}</span>
        {open && !loading && (
          <span className="text-[11px] text-foreground-400">{materials.length}</span>
        )}
        <i className={`ml-auto text-foreground-400 ${open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"}`}></i>
      </button>

      {open && (
        <div className="border-t border-background-200 px-3 py-3 space-y-3">
          <p className="text-xs text-foreground-500">{t("lessonMaterials.subtitle")}</p>
          {notice && <p className="text-xs font-medium text-primary-700">{notice}</p>}
          {errorCode && (
            <p className="text-xs font-medium text-accent-600">{t(`lessonMaterials.err.${errorCode}`)}</p>
          )}

          {loading && <p className="text-xs text-foreground-400">...</p>}

          {hasLoaded && !loading && !errorCode && materials.length === 0 && (
            <p className="text-xs text-foreground-500">{t("lessonMaterials.empty")}</p>
          )}

          {materials.length > 0 && (
            <div className="space-y-2">
              {materials.map((material) => {
                const canDelete = actor ? canDeleteLessonMaterial(actor, material.created_by) : false;
                return (
                  <div key={material.id} className="flex items-start gap-2 rounded-md border border-background-200 px-3 py-2">
                    <i className={`mt-0.5 ${material.kind === "link" ? "ri-links-line text-secondary-600" : "ri-file-line text-primary-600"}`}></i>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground-900 truncate">{material.title}</p>
                      <p className="text-[11px] text-foreground-400 truncate">
                        {material.kind === "link" ? material.link_url : material.file_name}
                        {material.byte_size ? ` · ${formatBytes(material.byte_size)}` : ""}
                      </p>
                      {material.notes && (
                        <p className="mt-1 text-xs text-foreground-600 whitespace-pre-wrap">{material.notes}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpen(material)}
                      disabled={openingId === material.id}
                      className="text-xs font-medium text-primary-700 hover:text-primary-800 cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      {material.kind === "link" ? t("lessonMaterials.openLink") : t("lessonMaterials.download")}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(material)}
                        className="text-xs font-medium text-accent-600 hover:text-accent-700 cursor-pointer whitespace-nowrap"
                      >
                        {t("lessonMaterials.delete")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {errorCode === "list_failed" && (
            <button type="button" onClick={() => setReloadToken((current) => current + 1)} className="text-xs font-medium text-primary-700 cursor-pointer">
              {t("lessonMaterials.retry")}
            </button>
          )}

          {canUpload && (
            <div className="space-y-2 rounded-md bg-background-100/70 p-3">
              <label className="block text-xs font-medium text-foreground-700">
                {t("lessonMaterials.titleLabel")}
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("lessonMaterials.titlePlaceholder")}
                  maxLength={200}
                  className="mt-1 w-full rounded-md border border-background-200 bg-background-50 px-3 py-2 text-sm text-foreground-900"
                />
              </label>
              <label className="block text-xs font-medium text-foreground-700">
                {t("lessonMaterials.notesLabel")}
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder={t("lessonMaterials.notesPlaceholder")}
                  maxLength={4000}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-background-200 bg-background-50 px-3 py-2 text-sm text-foreground-900"
                />
              </label>
              <label className="block text-xs font-medium text-foreground-700">
                {t("lessonMaterials.fileLabel")}
                <input
                  type="file"
                  accept={ACCEPT}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-xs text-foreground-600"
                />
                <span className="mt-1 block text-[11px] text-foreground-400">{t("lessonMaterials.fileHint")}</span>
              </label>
              <label className="block text-xs font-medium text-foreground-700">
                {t("lessonMaterials.linkLabel")}
                <input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder={t("lessonMaterials.linkPlaceholder")}
                  className="mt-1 w-full rounded-md border border-background-200 bg-background-50 px-3 py-2 text-sm text-foreground-900"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onUpload}
                  disabled={saving || !file}
                  className="inline-flex items-center rounded-md bg-primary-500 px-3 py-1.5 text-xs font-semibold text-background-50 hover:bg-primary-600 cursor-pointer disabled:opacity-60"
                >
                  {saving ? t("lessonMaterials.saving") : t("lessonMaterials.upload")}
                </button>
                <button
                  type="button"
                  onClick={onAddLink}
                  disabled={saving || !linkUrl.trim()}
                  className="inline-flex items-center rounded-md bg-secondary-500 px-3 py-1.5 text-xs font-semibold text-background-50 hover:bg-secondary-600 cursor-pointer disabled:opacity-60"
                >
                  {saving ? t("lessonMaterials.saving") : t("lessonMaterials.addLink")}
                </button>
              </div>
            </div>
          )}

          {deleteTarget && (
            <div className="rounded-md border border-accent-200 bg-accent-50 p-3">
              <p className="text-sm font-medium text-foreground-900">{t("lessonMaterials.deleteConfirm")}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={saving}
                  className="rounded-md bg-background-100 px-3 py-1.5 text-xs font-medium text-foreground-700 cursor-pointer"
                >
                  {t("lessonMaterials.cancel")}
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={saving}
                  className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-background-50 cursor-pointer disabled:opacity-60"
                >
                  {t("lessonMaterials.delete")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
