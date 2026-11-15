import {
  LESSON_MATERIALS_BUCKET,
  LESSON_MATERIALS_TABLE,
  MAX_MATERIAL_BYTES,
  SIGNED_URL_SECONDS,
  addLessonLink,
  bindLessonMaterialsDb,
  buildLessonMaterialPath,
  canDeleteLessonMaterial,
  canReadLessonMaterial,
  canUploadLessonMaterial,
  classLessonLookup,
  createLessonMaterialDownloadUrl,
  deleteLessonMaterial,
  isLessonMaterialFailure,
  lessonMaterialPathIsSafe,
  loadLessonMaterials,
  materialsForSchedule,
  resolveClassSchedule,
  uploadLessonFile,
  validateMaterialFile,
  validateMaterialLink,
  validateMaterialNotes,
  validateMaterialTitle,
  type ClassScheduleRef,
  type LessonMaterialActor,
  type LessonMaterialInsert,
  type LessonMaterialRow,
  type LessonMaterialsDb,
} from "./lessonMaterials";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
}

function resultField(result: unknown, field: "fileName" | "mimeType" | "code"): string {
  if (!result || typeof result !== "object" || !(field in result)) {
    throw new Error(`missing ${field}`);
  }
  return String((result as Record<string, unknown>)[field]);
}

const scheduleA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const scheduleB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const teacherA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const teacherB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const learnerA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const adminId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const objectId = "11111111-1111-4111-8111-111111111111";
const sprintSessionId = "22222222-2222-4222-8222-222222222222";

function actor(partial: Partial<LessonMaterialActor> & Pick<LessonMaterialActor, "userId" | "role">): LessonMaterialActor {
  return {
    userId: partial.userId,
    role: partial.role,
    isActive: partial.isActive === undefined ? true : partial.isActive,
    scheduleTeacherId: partial.scheduleTeacherId === undefined ? teacherA : partial.scheduleTeacherId,
  };
}

const teacher = actor({ userId: teacherA, role: "vietnamese_teacher" });
const otherTeacher = actor({ userId: teacherB, role: "foreign_teacher", scheduleTeacherId: teacherA });
const learner = actor({ userId: learnerA, role: "learner", scheduleTeacherId: teacherA });
const admin = actor({ userId: adminId, role: "admin", scheduleTeacherId: teacherA });

function pdfFile(overrides: { name?: string; type?: string; size?: number } = {}) {
  return {
    name: overrides.name ?? "practice.pdf",
    type: overrides.type ?? "application/pdf",
    size: overrides.size ?? 2048,
    body: new Blob(["pdf"]),
  };
}

function memoryDb(userId: string | null, options?: { insertError?: boolean; uploadError?: boolean; removeError?: boolean }) {
  const events: string[] = [];
  const inserted: LessonMaterialInsert[] = [];
  const db: LessonMaterialsDb = {
    async getUserId() {
      events.push("auth");
      return userId;
    },
    async list() {
      events.push("list");
      return { data: [], error: null };
    },
    async insert(row) {
      events.push("insert");
      inserted.push(row);
      return { error: options?.insertError ? { message: "insert failed" } : null };
    },
    async deleteRow(id) {
      events.push(`delete:${id}`);
      return { error: null };
    },
    async upload(path, _body, uploadOptions) {
      events.push(`upload:${path}:upsert=${String(uploadOptions.upsert)}:${uploadOptions.contentType}`);
      return { error: options?.uploadError ? { message: "upload failed" } : null };
    },
    async removeObjects(paths) {
      events.push(`remove:${paths.join("|")}`);
      return { error: options?.removeError ? { message: "remove failed" } : null };
    },
    async createSignedUrl(path, expiresIn) {
      events.push(`sign:${path}:${expiresIn}`);
      return { data: { signedUrl: "https://signed.example/temporary" }, error: null };
    },
  };
  return { db, events, inserted };
}

const schedules: ClassScheduleRef[] = [
  { id: scheduleA, classId: "class-1", date: "2026-11-16", startTime: "08:00:00", teacherId: teacherA },
  { id: scheduleB, classId: "class-1", date: "2026-11-18", startTime: "10:30:00", teacherId: teacherA },
  { id: "99999999-9999-4999-8999-999999999999", classId: "class-2", date: "2026-11-16", startTime: "08:00:00", teacherId: teacherB },
];

// Permissions
assertEqual(canUploadLessonMaterial(teacher), true, "schedule teacher can upload");
assertEqual(canUploadLessonMaterial(otherTeacher), false, "another teacher cannot upload");
assertEqual(canUploadLessonMaterial(learner), false, "learner cannot upload");
assertEqual(canUploadLessonMaterial(admin), false, "admin cannot upload");
assertEqual(canUploadLessonMaterial(actor({ userId: teacherA, role: "vietnamese_teacher", isActive: false })), false, "inactive teacher cannot upload");
assertEqual(canReadLessonMaterial(teacher), true, "schedule teacher can read");
assertEqual(canReadLessonMaterial(otherTeacher), false, "another teacher cannot read this schedule");
assertEqual(canReadLessonMaterial(learner), true, "enrolled learner UI may read; RLS checks enrollment");
assertEqual(canReadLessonMaterial(admin), true, "admin can read");
assertEqual(canReadLessonMaterial(actor({ userId: null, role: "learner" })), false, "signed-out cannot read");
assertEqual(canReadLessonMaterial(actor({ userId: learnerA, role: "guest" })), false, "unknown role cannot read");
assertEqual(canDeleteLessonMaterial(teacher, teacherA), true, "teacher deletes own row");
assertEqual(canDeleteLessonMaterial(teacher, teacherB), false, "teacher cannot delete a colleague row");
assertEqual(canDeleteLessonMaterial(learner, teacherA), false, "learner cannot delete");
assertEqual(canDeleteLessonMaterial(admin, teacherA), true, "admin can delete any row");
assertEqual(canDeleteLessonMaterial(admin, null), true, "admin can delete a row whose author was removed");
assertEqual(canDeleteLessonMaterial(actor({ userId: teacherA, role: "vietnamese_teacher", isActive: null }), teacherA), true, "null is_active stays allowed");

// Schedule isolation. sprint_sessions.id is never chosen.
{
  const lookup = classLessonLookup("class-1", "2026-11-16T01:00:00.000Z");
  assertEqual(lookup, { classId: "class-1", date: "2026-11-16", startTime: "08:00" }, "session instant becomes the Vietnam class time");
  const resolved = resolveClassSchedule(schedules, lookup || { classId: "", date: "" }, sprintSessionId);
  assertEqual(resolved?.id, scheduleA, "Monday lesson resolves to its class schedule");
  assert(resolved?.id !== sprintSessionId, "resolved id is not the learner sprint session");
  const classmate = resolveClassSchedule(schedules, { classId: "CLASS-1", date: "2026-11-16", startTime: "09:15" }, "another-session");
  assertEqual(classmate?.id, scheduleA, "one schedule that day is shared by every learner in the class");
  assertEqual(
    resolveClassSchedule(schedules, { classId: "class-1", date: "2026-11-18" })?.id,
    scheduleB,
    "a different date stays on its own schedule"
  );
  const doubled: ClassScheduleRef[] = [
    ...schedules,
    { id: "abababab-abab-4aba-8aba-abababababab", classId: "class-1", date: "2026-11-16", startTime: "14:00:00", teacherId: teacherA },
  ];
  assertEqual(
    resolveClassSchedule(doubled, { classId: "class-1", date: "2026-11-16", startTime: "14:00" }, sprintSessionId)?.id,
    "abababab-abab-4aba-8aba-abababababab",
    "same-day schedules match the start time"
  );
  assertEqual(resolveClassSchedule(doubled, { classId: "class-1", date: "2026-11-16" }, sprintSessionId), null, "ambiguous day does not guess");
  assertEqual(resolveClassSchedule(schedules, { classId: "class-1", date: "2026-11-17" }), null, "missing day does not borrow another schedule");
  assertEqual(
    materialsForSchedule(
      [
        { id: "1", schedule_id: scheduleA },
        { id: "2", schedule_id: scheduleB },
      ],
      scheduleA
    ).map((row) => row.id),
    ["1"],
    "list keeps only the requested schedule"
  );
}

// Files, links, notes
{
  const path = buildLessonMaterialPath({
    scheduleId: scheduleA.toUpperCase(),
    createdBy: teacherA.toUpperCase(),
    objectId,
    fileName: "C:\\fakepath\\Week 2.pdf",
  });
  assert(path, "path built");
  assertEqual(
    path,
    `${scheduleA}/${teacherA}/${objectId}/Week 2.pdf`,
    "object key is schedule/teacher/object/file in lowercase ids"
  );
  assertEqual(lessonMaterialPathIsSafe(path), true, "path matches the storage rule");
  assertEqual(buildLessonMaterialPath({ scheduleId: "not-a-uuid", createdBy: teacherA, objectId, fileName: "a.pdf" }), null, "bad schedule id");
  assertEqual(
    buildLessonMaterialPath({ scheduleId: scheduleA, createdBy: teacherA, objectId, fileName: "../secret.pdf" }),
    `${scheduleA}/${teacherA}/${objectId}/secret.pdf`,
    "directory prefixes are discarded before the file name is stored"
  );
  assertEqual(buildLessonMaterialPath({ scheduleId: scheduleA, createdBy: teacherA, objectId, fileName: "foo..bar.pdf" }), null, "dot-dot inside a file name is rejected");
  assertEqual(resultField(validateMaterialFile(pdfFile()), "fileName"), "practice.pdf", "pdf accepted");
  assertEqual(
    resultField(validateMaterialFile({ name: "slides.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 10 }), "mimeType"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pptx accepted"
  );
  assertEqual(
    resultField(validateMaterialFile({ name: "notes.docx", type: "", size: 10 }), "mimeType"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx with a blank browser type accepted"
  );
  for (const name of ["photo.png", "photo.jpg", "photo.jpeg", "photo.gif", "photo.webp", "photo.bmp"]) {
    const extension = name.split(".").pop()!;
    const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
    assertEqual(resultField(validateMaterialFile({ name, type: mime, size: 10 }), "fileName"), name, `${name} accepted`);
  }
  assertEqual(resultField(validateMaterialFile(pdfFile({ name: "evil.exe" })), "code"), "invalid_file", "exe rejected");
  assertEqual(resultField(validateMaterialFile(pdfFile({ name: "page.html", type: "text/html" })), "code"), "invalid_file", "html rejected");
  assertEqual(resultField(validateMaterialFile(pdfFile({ name: "picture.svg", type: "image/svg+xml" })), "code"), "invalid_file", "svg rejected");
  assertEqual(resultField(validateMaterialFile(pdfFile({ type: "text/html" })), "code"), "invalid_file", "pdf name with html type rejected");
  assertEqual(resultField(validateMaterialFile(pdfFile({ size: MAX_MATERIAL_BYTES })), "fileName"), "practice.pdf", "10 MB accepted");
  assertEqual(resultField(validateMaterialFile(pdfFile({ size: MAX_MATERIAL_BYTES + 1 })), "code"), "file_too_large", "over 10 MB rejected");
  assertEqual(resultField(validateMaterialFile(pdfFile({ size: 0 })), "code"), "invalid_file", "empty file rejected");
  assertEqual(validateMaterialLink("https://example.com/lesson"), "https://example.com/lesson", "https link accepted");
  assertEqual(resultField(validateMaterialLink("http://example.com"), "code"), "invalid_link", "http rejected");
  assertEqual(resultField(validateMaterialLink("https://example.com/a b"), "code"), "invalid_link", "link with a space rejected");
  assertEqual(resultField(validateMaterialLink("javascript:alert(1)"), "code"), "invalid_link", "javascript link rejected");
  assertEqual(validateMaterialTitle("  Extra practice  "), "Extra practice", "title trimmed");
  assertEqual(resultField(validateMaterialTitle("   "), "code"), "invalid_title", "blank title rejected");
  assertEqual(resultField(validateMaterialTitle("x".repeat(201)), "code"), "invalid_title", "long title rejected");
  assertEqual(validateMaterialNotes("  bring a pen  "), "bring a pen", "notes trimmed");
  assertEqual(validateMaterialNotes("   "), null, "blank notes stored as empty");
  assertEqual(resultField(validateMaterialNotes("n".repeat(4001)), "code"), "invalid_notes", "long notes rejected");
}

// Upload, link, delete, signed URL, and error cases
{
  const stored = memoryDb(teacherA);
  const uploaded = await uploadLessonFile(stored.db, teacher, {
    scheduleId: scheduleA,
    title: " Extra ",
    notes: " Read pages 1-2 ",
    file: pdfFile(),
    objectId,
  });
  assertEqual(uploaded, { ok: true, scheduleId: scheduleA }, "teacher upload succeeds");
  assertEqual(stored.events[0], "auth", "upload uses the signed-in user");
  assert(stored.events.some((event) => event.startsWith("upload:") && event.includes("upsert=false")), "upload sets upsert false");
  assert(!stored.events.some((event) => event.includes("sprint-materials")), "upload does not touch sprint materials");
  assertEqual(stored.inserted[0].kind, "file", "file row kind");
  assertEqual(stored.inserted[0].link_url, null, "file row has no link");
  assertEqual(stored.inserted[0].storage_path, `${scheduleA}/${teacherA}/${objectId}/practice.pdf`, "stored path");
  assertEqual(stored.inserted[0].created_by, teacherA, "created_by is the signed-in teacher");
  assert(!("signed_url" in stored.inserted[0]), "signed URL is not stored");

  const blocked = memoryDb(learnerA);
  const learnerUpload = await uploadLessonFile(blocked.db, learner, {
    scheduleId: scheduleA,
    title: "Nope",
    file: pdfFile(),
    objectId,
  });
  assertEqual(learnerUpload, { ok: false, code: "forbidden" }, "learner upload blocked");
  assertEqual(blocked.events, [], "learner upload makes no storage or table call");

  const adminUpload = await uploadLessonFile(memoryDb(adminId).db, admin, {
    scheduleId: scheduleA,
    title: "Nope",
    file: pdfFile(),
    objectId,
  });
  assertEqual(adminUpload, { ok: false, code: "forbidden" }, "admin upload blocked by policy");

  const other = memoryDb(teacherB);
  const otherUpload = await uploadLessonFile(other.db, otherTeacher, {
    scheduleId: scheduleA,
    title: "Nope",
    file: pdfFile(),
    objectId,
  });
  assertEqual(otherUpload, { ok: false, code: "forbidden" }, "other teacher upload blocked");
  assertEqual(other.events, [], "rejected upload does not touch storage");

  const tooBig = memoryDb(teacherA);
  const big = await uploadLessonFile(tooBig.db, teacher, {
    scheduleId: scheduleA,
    title: "Big",
    file: pdfFile({ size: MAX_MATERIAL_BYTES + 1 }),
    objectId,
  });
  assertEqual(big, { ok: false, code: "file_too_large" }, "oversized file stopped before upload");
  assertEqual(tooBig.events, [], "oversized file makes no call");

  const failedUpload = memoryDb(teacherA, { uploadError: true });
  const uploadError = await uploadLessonFile(failedUpload.db, teacher, {
    scheduleId: scheduleA,
    title: "File",
    file: pdfFile(),
    objectId,
  });
  assertEqual(uploadError, { ok: false, code: "storage_upload_failed" }, "storage error reported");
  assert(!failedUpload.events.includes("insert"), "failed upload does not insert metadata");

  const failedInsert = memoryDb(teacherA, { insertError: true });
  const insertError = await uploadLessonFile(failedInsert.db, teacher, {
    scheduleId: scheduleA,
    title: "File",
    file: pdfFile(),
    objectId,
  });
  assertEqual(insertError, { ok: false, code: "metadata_insert_failed" }, "metadata error after a successful upload");
  assert(
    failedInsert.events.some((event) => event.startsWith("remove:")),
    "failed metadata insert removes the object"
  );

  const failedCleanup = memoryDb(teacherA, { insertError: true, removeError: true });
  const cleanupError = await uploadLessonFile(failedCleanup.db, teacher, {
    scheduleId: scheduleA,
    title: "File",
    file: pdfFile(),
    objectId,
  });
  assertEqual(cleanupError, { ok: false, code: "orphan_cleanup_failed" }, "cleanup failure is reported");

  const linked = memoryDb(teacherA);
  const link = await addLessonLink(linked.db, teacher, {
    scheduleId: scheduleB,
    title: "Video",
    notes: "Watch before class",
    linkUrl: "https://example.com/class",
  });
  assertEqual(link, { ok: true, scheduleId: scheduleB }, "https link saved");
  assertEqual(linked.inserted[0].kind, "link", "link kind");
  assertEqual(linked.inserted[0].storage_path, null, "link has no storage path");
  assertEqual(linked.inserted[0].file_name, null, "link has no file name");
  assert(!linked.events.some((event) => event.startsWith("upload:")), "link does not upload a file");
  const badLink = await addLessonLink(memoryDb(teacherA).db, teacher, {
    scheduleId: scheduleA,
    title: "Bad",
    linkUrl: "http://example.com",
  });
  assertEqual(badLink, { ok: false, code: "invalid_link" }, "non-https link rejected");

  const fileRow: LessonMaterialRow = {
    id: "row-file",
    schedule_id: scheduleA,
    created_by: teacherA,
    kind: "file",
    title: "Practice",
    notes: null,
    storage_path: `${scheduleA}/${teacherA}/${objectId}/practice.pdf`,
    file_name: "practice.pdf",
    mime_type: "application/pdf",
    byte_size: 2048,
    link_url: null,
  };
  const linkRow: LessonMaterialRow = {
    id: "row-link",
    schedule_id: scheduleA,
    created_by: teacherA,
    kind: "link",
    title: "Video",
    notes: null,
    storage_path: null,
    file_name: null,
    mime_type: null,
    byte_size: null,
    link_url: "https://example.com/class",
  };

  const learnerDelete = memoryDb(learnerA);
  assertEqual(
    await deleteLessonMaterial(learnerDelete.db, learner, fileRow, scheduleA),
    { ok: false, code: "forbidden" },
    "learner cannot delete"
  );
  assertEqual(learnerDelete.events, [], "learner delete makes no call");

  const ownDelete = memoryDb(teacherA);
  assertEqual(await deleteLessonMaterial(ownDelete.db, teacher, fileRow, scheduleA), { ok: true, id: "row-file" }, "teacher deletes own file");
  assert(ownDelete.events[1].startsWith("remove:"), "file delete removes the object first");
  assertEqual(ownDelete.events[2], "delete:row-file", "file delete then removes the row");

  const colleague = memoryDb(teacherA);
  assertEqual(
    await deleteLessonMaterial(colleague.db, teacher, { ...fileRow, created_by: teacherB }, scheduleA),
    { ok: false, code: "forbidden" },
    "teacher cannot delete another teacher's material"
  );

  const wrongSchedule = memoryDb(teacherA);
  assertEqual(
    await deleteLessonMaterial(wrongSchedule.db, teacher, fileRow, scheduleB),
    { ok: false, code: "invalid_schedule" },
    "delete refuses a row from another schedule"
  );
  assertEqual(wrongSchedule.events, [], "cross-schedule delete makes no call");

  const adminDelete = memoryDb(adminId);
  assertEqual(
    await deleteLessonMaterial(adminDelete.db, admin, fileRow, scheduleA),
    { ok: true, id: "row-file" },
    "admin deletes a teacher file"
  );
  const linkDelete = memoryDb(teacherA);
  assertEqual(await deleteLessonMaterial(linkDelete.db, teacher, linkRow, scheduleA), { ok: true, id: "row-link" }, "link delete");
  assert(!linkDelete.events.some((event) => event.startsWith("remove:")), "link delete does not call storage");

  const signed = memoryDb(learnerA);
  const download = await createLessonMaterialDownloadUrl(signed.db, learner, fileRow, scheduleA);
  assertEqual(download, { ok: true, signedUrl: "https://signed.example/temporary" }, "learner receives a temporary signed URL");
  assert(signed.events.some((event) => event === `sign:${fileRow.storage_path}:${SIGNED_URL_SECONDS}`), "signed URL uses the private object and a short expiry");
  assert(!("signedUrl" in fileRow), "download does not write the URL onto the row");

  const isolated = memoryDb(learnerA);
  assertEqual(
    await createLessonMaterialDownloadUrl(isolated.db, learner, fileRow, scheduleB),
    { ok: false, code: "invalid_schedule" },
    "signed URL refused for a different schedule"
  );
  assert(!isolated.events.some((event) => event.startsWith("sign:")), "wrong schedule is not signed");

  const unsafe = memoryDb(adminId);
  assertEqual(
    await createLessonMaterialDownloadUrl(unsafe.db, admin, { ...fileRow, storage_path: "../sprint-materials/secret.pdf" }, scheduleA),
    { ok: false, code: "invalid_file" },
    "unsafe path is not signed"
  );
  assertEqual(unsafe.events, [], "unsafe path makes no storage call");

  const listed = memoryDb(learnerA);
  listed.db.list = async () => ({
    data: [
      fileRow,
      { ...linkRow, id: "other", schedule_id: scheduleB },
    ],
    error: null,
  });
  const loaded = await loadLessonMaterials(listed.db, learner, scheduleA);
  assert(!isLessonMaterialFailure(loaded), "learner list succeeds");
  if (!isLessonMaterialFailure(loaded)) {
    assertEqual(loaded.materials.map((row) => row.id), ["row-file"], "response from another schedule is dropped");
  }

  const deniedList = memoryDb(teacherB);
  assertEqual(
    await loadLessonMaterials(deniedList.db, otherTeacher, scheduleA),
    { ok: false, code: "forbidden" },
    "unrelated teacher list blocked"
  );
  assertEqual(deniedList.events, [], "blocked list does not query");
}

// Adapter stays on the user session, the private bucket, and upsert false.
{
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: teacherA } } };
      },
    },
    from(table: string) {
      const query = {
        select(columns: string) {
          calls.push({ op: "select", table, columns });
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return Promise.resolve({ data: [], error: null });
        },
        insert(row: LessonMaterialInsert) {
          calls.push({ op: "insert", table, row });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(_column: string, id: string) {
              calls.push({ op: "delete", table, id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return query;
    },
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, _body: Blob, options: { upsert: false; contentType: string }) {
            calls.push({ op: "upload", bucket, path, options });
            return Promise.resolve({ error: null });
          },
          remove(paths: string[]) {
            calls.push({ op: "remove", bucket, paths });
            return Promise.resolve({ error: null });
          },
          createSignedUrl(path: string, expiresIn: number) {
            calls.push({ op: "sign", bucket, path, expiresIn });
            return Promise.resolve({ data: { signedUrl: "https://signed.example/temporary" }, error: null });
          },
        };
      },
    },
  };

  const db = bindLessonMaterialsDb(client);
  await db.list(scheduleA);
  await db.upload(`${scheduleA}/${teacherA}/${objectId}/practice.pdf`, new Blob(["pdf"]), {
    upsert: false,
    contentType: "application/pdf",
  });
  await db.createSignedUrl(`${scheduleA}/${teacherA}/${objectId}/practice.pdf`, SIGNED_URL_SECONDS);
  assertEqual(calls[0].table, LESSON_MATERIALS_TABLE, "metadata table is lesson_materials");
  assert(!String(calls[0].columns).includes("signed"), "select does not read a stored signed URL");
  assertEqual(calls[1].bucket, LESSON_MATERIALS_BUCKET, "objects use the private lesson-materials bucket");
  assertEqual((calls[1].options as { upsert: boolean }).upsert, false, "adapter forces upsert false");
  assertEqual(calls[2].bucket, LESSON_MATERIALS_BUCKET, "signed URL uses the same private bucket");
  assertEqual(LESSON_MATERIALS_BUCKET, "lesson-materials", "bucket name is the private lesson-materials bucket");
}

console.log("lessonMaterials tests passed");
