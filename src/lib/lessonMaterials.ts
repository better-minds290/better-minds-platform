/**
 * Teacher additional materials for one class_schedules row.
 * File bytes go only to the private lesson-materials bucket.
 * Signed URLs are created with the signed-in user session and are never stored.
 * This module does not use the service role and does not write class_materials
 * or sprint-materials.
 */
import { getVietnamDateParts, toVietnamDateStr } from "./datetime";

export const LESSON_MATERIALS_BUCKET = "lesson-materials";
export const LESSON_MATERIALS_TABLE = "lesson_materials";
export const MAX_MATERIAL_BYTES = 10 * 1024 * 1024;
export const SIGNED_URL_SECONDS = 120;
export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTES_LENGTH = 4000;
export const MAX_LINK_LENGTH = 2000;
export const MAX_FILE_NAME_LENGTH = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]{1,200}$/;
const HTTPS_RE = /^https:\/\/\S+$/;
const CONTROL_OR_SLASH_RE = /[\u0000-\u001F\u007F-\u009F\\]/;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

const TEACHER_ROLES = new Set(["vietnamese_teacher", "foreign_teacher"]);

export type LessonMaterialKind = "file" | "link";

export type LessonMaterialErrorCode =
  | "inactive"
  | "forbidden"
  | "invalid_title"
  | "invalid_notes"
  | "invalid_link"
  | "invalid_file"
  | "file_too_large"
  | "invalid_schedule"
  | "storage_upload_failed"
  | "metadata_insert_failed"
  | "orphan_cleanup_failed"
  | "storage_delete_failed"
  | "metadata_delete_failed"
  | "signed_url_failed"
  | "list_failed";

export type LessonMaterialRow = {
  id: string;
  schedule_id: string;
  created_by: string | null;
  kind: LessonMaterialKind | string;
  title: string;
  notes: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  link_url: string | null;
  created_at?: string;
};

export type LessonMaterialInsert = {
  schedule_id: string;
  created_by: string;
  kind: LessonMaterialKind;
  title: string;
  notes: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  link_url: string | null;
};

export type LessonMaterialActor = {
  userId: string | null;
  role: string | null;
  /** null matches the database rule: only explicit false is inactive. */
  isActive: boolean | null;
  scheduleTeacherId: string | null;
};

export type LessonMaterialFileInput = {
  name: string;
  type: string;
  size: number;
  body: Blob;
};

export type ClassScheduleRef = {
  id: string;
  classId: string;
  date: string;
  startTime?: string | null;
  teacherId?: string | null;
};

export type LessonMaterialsDb = {
  getUserId(): Promise<string | null>;
  list(scheduleId: string): Promise<{ data: LessonMaterialRow[] | null; error: { message?: string } | null }>;
  insert(row: LessonMaterialInsert): Promise<{ error: { message?: string } | null }>;
  deleteRow(id: string): Promise<{ error: { message?: string } | null }>;
  upload(
    path: string,
    body: Blob,
    options: { upsert: false; contentType: string }
  ): Promise<{ error: { message?: string } | null }>;
  removeObjects(paths: string[]): Promise<{ error: { message?: string } | null }>;
  createSignedUrl(
    path: string,
    expiresIn: number
  ): Promise<{ data: { signedUrl: string } | null; error: { message?: string } | null }>;
};

export type LessonMaterialFailure = { ok: false; code: LessonMaterialErrorCode };
export type LessonMaterialSuccess<T> = { ok: true } & T;

function failure(code: LessonMaterialErrorCode): LessonMaterialFailure {
  return { ok: false, code };
}

/** strictNullChecks is off in this project, so `if (!result.ok)` does not narrow. */
export function isLessonMaterialFailure(value: unknown): value is LessonMaterialFailure {
  return !!value && typeof value === "object" && "code" in value && (value as { ok?: boolean }).ok === false;
}

export function sameUuid(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function normalizeUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : null;
}

export function normalizeClockTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function isActiveAccount(isActive: boolean | null | undefined): boolean {
  return isActive !== false;
}

export function canUploadLessonMaterial(actor: LessonMaterialActor): boolean {
  if (!isActiveAccount(actor.isActive)) return false;
  if (!actor.userId || !TEACHER_ROLES.has(actor.role || "")) return false;
  return sameUuid(actor.userId, actor.scheduleTeacherId);
}

export function canReadLessonMaterial(actor: LessonMaterialActor): boolean {
  if (!isActiveAccount(actor.isActive) || !actor.userId) return false;
  if (actor.role === "admin" || actor.role === "learner") return true;
  if (TEACHER_ROLES.has(actor.role || "")) return sameUuid(actor.userId, actor.scheduleTeacherId);
  return false;
}

export function canDeleteLessonMaterial(actor: LessonMaterialActor, createdBy: string | null): boolean {
  if (!isActiveAccount(actor.isActive) || !actor.userId) return false;
  if (actor.role === "admin") return true;
  return canUploadLessonMaterial(actor) && sameUuid(actor.userId, createdBy);
}

/**
 * One class lesson is one class_schedules row.
 * A single schedule on that class and date is used.
 * Several schedules that day match only when the start time also matches.
 * The result is never a sprint_sessions id supplied by the caller.
 */
export function resolveClassSchedule(
  schedules: readonly ClassScheduleRef[],
  query: { classId: string | null | undefined; date: string | null | undefined; startTime?: string | null },
  sprintSessionId?: string | null
): ClassScheduleRef | null {
  const classId = query.classId?.trim().toLowerCase();
  const date = query.date?.trim().slice(0, 10);
  if (!classId || !date) return null;

  const sameLesson = schedules.filter(
    (schedule) => schedule.classId.trim().toLowerCase() === classId && schedule.date.trim().slice(0, 10) === date
  );
  let chosen: ClassScheduleRef | null = null;
  if (sameLesson.length === 1) {
    chosen = sameLesson[0];
  } else if (sameLesson.length > 1) {
    const startTime = normalizeClockTime(query.startTime);
    if (!startTime) return null;
    const timed = sameLesson.filter((schedule) => normalizeClockTime(schedule.startTime) === startTime);
    if (timed.length !== 1) return null;
    chosen = timed[0];
  }
  if (!chosen) return null;
  if (sprintSessionId && sameUuid(chosen.id, sprintSessionId)) return null;
  return chosen;
}

/** Date and clock time of a sprint session, in Vietnam, used only to find its class_schedules row. */
export function classLessonLookup(
  classId: string | null | undefined,
  scheduledAt: string | null | undefined
): { classId: string; date: string; startTime: string | null } | null {
  if (!classId || !scheduledAt) return null;
  const date = toVietnamDateStr(scheduledAt);
  if (!date) return null;
  const parts = getVietnamDateParts(scheduledAt);
  const startTime = parts
    ? `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
    : null;
  return { classId, date, startTime };
}

export function materialsForSchedule<T extends { schedule_id: string }>(
  rows: readonly T[],
  scheduleId: string
): T[] {
  return rows.filter((row) => sameUuid(row.schedule_id, scheduleId));
}

export function sanitizeMaterialFileName(fileName: string): string | null {
  const base = fileName.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base || base === "." || base === "..") return null;
  if (base.includes("..")) return null;
  if (CONTROL_OR_SLASH_RE.test(base) || base.includes("/")) return null;
  if (codePointLength(base) < 1 || codePointLength(base) > MAX_FILE_NAME_LENGTH) return null;
  return base;
}

export function canonicalMaterialMime(fileName: string, declaredType: string | null | undefined): string | null {
  const safeName = sanitizeMaterialFileName(fileName);
  if (!safeName) return null;
  const extension = safeName.split(".").pop()?.toLowerCase() ?? "";
  const canonical = MIME_BY_EXTENSION[extension];
  if (!canonical) return null;
  const declared = (declaredType || "").split(";")[0].trim().toLowerCase();
  if (declared && declared !== canonical) return null;
  return canonical;
}

export function validateMaterialTitle(title: string): string | LessonMaterialFailure {
  const trimmed = title.trim();
  if (codePointLength(trimmed) < 1 || codePointLength(trimmed) > MAX_TITLE_LENGTH) return failure("invalid_title");
  return trimmed;
}

export function validateMaterialNotes(notes: string | null | undefined): string | null | LessonMaterialFailure {
  if (notes == null) return null;
  const trimmed = notes.trim();
  if (!trimmed) return null;
  if (codePointLength(trimmed) > MAX_NOTES_LENGTH) return failure("invalid_notes");
  return trimmed;
}

export function validateMaterialLink(url: string): string | LessonMaterialFailure {
  const trimmed = url.trim();
  if (
    codePointLength(trimmed) < 1 ||
    codePointLength(trimmed) > MAX_LINK_LENGTH ||
    CONTROL_OR_SLASH_RE.test(trimmed) ||
    !HTTPS_RE.test(trimmed)
  ) {
    return failure("invalid_link");
  }
  return trimmed;
}

export function lessonMaterialPathIsSafe(objectName: string | null | undefined): boolean {
  if (!objectName) return false;
  if (codePointLength(objectName) > 700) return false;
  if (objectName.includes("..")) return false;
  if (CONTROL_OR_SLASH_RE.test(objectName)) return false;
  return PATH_RE.test(objectName);
}

export function scheduleIdFromStoragePath(objectName: string | null | undefined): string | null {
  if (!lessonMaterialPathIsSafe(objectName) || !objectName) return null;
  return objectName.split("/")[0] ?? null;
}

export function buildLessonMaterialPath(input: {
  scheduleId: string;
  createdBy: string;
  objectId: string;
  fileName: string;
}): string | null {
  const scheduleId = normalizeUuid(input.scheduleId);
  const createdBy = normalizeUuid(input.createdBy);
  const objectId = normalizeUuid(input.objectId);
  const fileName = sanitizeMaterialFileName(input.fileName);
  if (!scheduleId || !createdBy || !objectId || !fileName) return null;
  const path = `${scheduleId}/${createdBy}/${objectId}/${fileName}`;
  if (!lessonMaterialPathIsSafe(path)) return null;
  if (path.split("/")[1] !== createdBy || path.split("/")[3] !== fileName) return null;
  return path;
}

export function validateMaterialFile(file: Pick<LessonMaterialFileInput, "name" | "type" | "size">):
  | { fileName: string; mimeType: string }
  | LessonMaterialFailure {
  if (!Number.isFinite(file.size) || file.size <= 0) return failure("invalid_file");
  if (file.size > MAX_MATERIAL_BYTES) return failure("file_too_large");
  const fileName = sanitizeMaterialFileName(file.name);
  const mimeType = canonicalMaterialMime(file.name, file.type);
  if (!fileName || !mimeType) return failure("invalid_file");
  return { fileName, mimeType };
}

function checkedText(
  value: string | null | LessonMaterialFailure,
  emptyCode: LessonMaterialErrorCode
): { ok: true; value: string } | LessonMaterialFailure {
  if (typeof value !== "string") return value;
  if (!value) return failure(emptyCode);
  return { ok: true, value };
}

async function signedInUser(
  db: LessonMaterialsDb,
  actor: LessonMaterialActor
): Promise<{ ok: true; userId: string } | LessonMaterialFailure> {
  if (!isActiveAccount(actor.isActive)) return failure("inactive");
  const userId = normalizeUuid(await db.getUserId());
  if (!userId || !sameUuid(userId, actor.userId)) return failure("forbidden");
  return { ok: true, userId };
}

export async function loadLessonMaterials(
  db: LessonMaterialsDb,
  actor: LessonMaterialActor,
  scheduleId: string
): Promise<LessonMaterialSuccess<{ materials: LessonMaterialRow[] }> | LessonMaterialFailure> {
  if (!normalizeUuid(scheduleId)) return failure("invalid_schedule");
  if (!canReadLessonMaterial(actor)) {
    return failure(isActiveAccount(actor.isActive) ? "forbidden" : "inactive");
  }
  const auth = await signedInUser(db, actor);
  if (isLessonMaterialFailure(auth)) return auth;
  const { data, error } = await db.list(scheduleId);
  if (error) return failure("list_failed");
  return { ok: true, materials: materialsForSchedule(data ?? [], scheduleId) };
}

export async function uploadLessonFile(
  db: LessonMaterialsDb,
  actor: LessonMaterialActor,
  input: {
    scheduleId: string;
    title: string;
    notes?: string | null;
    file: LessonMaterialFileInput;
    objectId?: string;
  }
): Promise<LessonMaterialSuccess<{ scheduleId: string }> | LessonMaterialFailure> {
  const scheduleId = normalizeUuid(input.scheduleId);
  if (!scheduleId) return failure("invalid_schedule");
  if (!canUploadLessonMaterial({ ...actor, scheduleTeacherId: actor.scheduleTeacherId })) {
    return failure(isActiveAccount(actor.isActive) ? "forbidden" : "inactive");
  }
  const title = checkedText(validateMaterialTitle(input.title), "invalid_title");
  if (isLessonMaterialFailure(title)) return title;
  const notes = validateMaterialNotes(input.notes);
  if (isLessonMaterialFailure(notes)) return notes;
  const fileInfo = validateMaterialFile(input.file);
  if (isLessonMaterialFailure(fileInfo)) return fileInfo;

  const auth = await signedInUser(db, actor);
  if (isLessonMaterialFailure(auth)) return auth;
  if (!sameUuid(auth.userId, actor.scheduleTeacherId)) return failure("forbidden");

  const objectId = normalizeUuid(input.objectId) ?? normalizeUuid(globalThis.crypto?.randomUUID?.());
  const storagePath = objectId
    ? buildLessonMaterialPath({
        scheduleId,
        createdBy: auth.userId,
        objectId,
        fileName: fileInfo.fileName,
      })
    : null;
  if (!storagePath) return failure("invalid_file");

  const uploaded = await db.upload(storagePath, input.file.body, {
    upsert: false,
    contentType: fileInfo.mimeType,
  });
  if (uploaded.error) return failure("storage_upload_failed");

  const inserted = await db.insert({
    schedule_id: scheduleId,
    created_by: auth.userId,
    kind: "file",
    title: title.value,
    notes: notes,
    storage_path: storagePath,
    file_name: fileInfo.fileName,
    mime_type: fileInfo.mimeType,
    byte_size: input.file.size,
    link_url: null,
  });
  if (!inserted.error) return { ok: true, scheduleId };

  const removed = await db.removeObjects([storagePath]);
  if (removed.error) return failure("orphan_cleanup_failed");
  return failure("metadata_insert_failed");
}

export async function addLessonLink(
  db: LessonMaterialsDb,
  actor: LessonMaterialActor,
  input: { scheduleId: string; title: string; notes?: string | null; linkUrl: string }
): Promise<LessonMaterialSuccess<{ scheduleId: string }> | LessonMaterialFailure> {
  const scheduleId = normalizeUuid(input.scheduleId);
  if (!scheduleId) return failure("invalid_schedule");
  if (!canUploadLessonMaterial(actor)) {
    return failure(isActiveAccount(actor.isActive) ? "forbidden" : "inactive");
  }
  const title = checkedText(validateMaterialTitle(input.title), "invalid_title");
  if (isLessonMaterialFailure(title)) return title;
  const notes = validateMaterialNotes(input.notes);
  if (isLessonMaterialFailure(notes)) return notes;
  const linkUrl = validateMaterialLink(input.linkUrl);
  if (isLessonMaterialFailure(linkUrl)) return linkUrl;

  const auth = await signedInUser(db, actor);
  if (isLessonMaterialFailure(auth)) return auth;

  const inserted = await db.insert({
    schedule_id: scheduleId,
    created_by: auth.userId,
    kind: "link",
    title: title.value,
    notes: notes,
    storage_path: null,
    file_name: null,
    mime_type: null,
    byte_size: null,
    link_url: linkUrl,
  });
  if (inserted.error) return failure("metadata_insert_failed");
  return { ok: true, scheduleId };
}

export async function deleteLessonMaterial(
  db: LessonMaterialsDb,
  actor: LessonMaterialActor,
  material: LessonMaterialRow,
  scheduleId: string
): Promise<LessonMaterialSuccess<{ id: string }> | LessonMaterialFailure> {
  if (!sameUuid(material.schedule_id, scheduleId) || !normalizeUuid(scheduleId)) {
    return failure("invalid_schedule");
  }
  if (!canDeleteLessonMaterial(actor, material.created_by)) {
    return failure(isActiveAccount(actor.isActive) ? "forbidden" : "inactive");
  }
  const auth = await signedInUser(db, actor);
  if (isLessonMaterialFailure(auth)) return auth;

  if (material.kind === "file") {
    const path = material.storage_path;
    if (!lessonMaterialPathIsSafe(path) || !sameUuid(scheduleIdFromStoragePath(path), scheduleId)) {
      return failure("invalid_file");
    }
    if (!sameUuid(path!.split("/")[1], material.created_by) && actor.role !== "admin") {
      return failure("forbidden");
    }
    const removed = await db.removeObjects([path!]);
    if (removed.error) return failure("storage_delete_failed");
  }

  const deleted = await db.deleteRow(material.id);
  if (deleted.error) return failure("metadata_delete_failed");
  return { ok: true, id: material.id };
}

export async function createLessonMaterialDownloadUrl(
  db: LessonMaterialsDb,
  actor: LessonMaterialActor,
  material: LessonMaterialRow,
  scheduleId: string
): Promise<LessonMaterialSuccess<{ signedUrl: string }> | LessonMaterialFailure> {
  if (material.kind !== "file") return failure("invalid_file");
  if (!sameUuid(material.schedule_id, scheduleId)) return failure("invalid_schedule");
  const path = material.storage_path;
  if (!lessonMaterialPathIsSafe(path) || !sameUuid(scheduleIdFromStoragePath(path), scheduleId)) {
    return failure("invalid_file");
  }
  if (!canReadLessonMaterial(actor)) {
    return failure(isActiveAccount(actor.isActive) ? "forbidden" : "inactive");
  }
  const auth = await signedInUser(db, actor);
  if (isLessonMaterialFailure(auth)) return auth;

  const signed = await db.createSignedUrl(path!, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) return failure("signed_url_failed");
  return { ok: true, signedUrl: signed.data.signedUrl };
}

const MATERIAL_COLUMNS =
  "id, schedule_id, created_by, kind, title, notes, storage_path, file_name, mime_type, byte_size, link_url, created_at";

/** Binds the signed-in user client from getSupabase(). Do not pass a service-role client. */
export function bindLessonMaterialsDb(client: any): LessonMaterialsDb {
  const bucket = LESSON_MATERIALS_BUCKET;
  return {
    async getUserId() {
      const { data } = await client.auth.getUser();
      return data?.user?.id ?? null;
    },
    async list(scheduleId) {
      const { data, error } = await client
        .from(LESSON_MATERIALS_TABLE)
        .select(MATERIAL_COLUMNS)
        .eq("schedule_id", scheduleId)
        .order("created_at", { ascending: false });
      return { data, error };
    },
    async insert(row) {
      const { error } = await client.from(LESSON_MATERIALS_TABLE).insert(row);
      return { error };
    },
    async deleteRow(id) {
      const { error } = await client.from(LESSON_MATERIALS_TABLE).delete().eq("id", id);
      return { error };
    },
    async upload(path, body, options) {
      if (options.upsert !== false) return { error: { message: "upsert_forbidden" } };
      const { error } = await client.storage.from(bucket).upload(path, body, {
        upsert: false,
        contentType: options.contentType,
      });
      return { error };
    },
    async removeObjects(paths) {
      const { error } = await client.storage.from(bucket).remove(paths);
      return { error };
    },
    async createSignedUrl(path, expiresIn) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
      return { data, error };
    },
  };
}
