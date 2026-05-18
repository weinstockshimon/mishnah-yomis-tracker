const {
  httpError,
  ownerId,
  photoBucket,
  readJson,
  requireAccess,
  sendError,
  sendJson,
  supabaseRest,
  supabaseStorage,
} = require("./_lib/supabase");

const PHOTO_SELECT =
  "id,study_day_id,file_path,file_name,taken_at,english_date,hebrew_date,tractate,assignment";

module.exports = async function handler(req, res) {
  try {
    requireAccess(req);
    const userId = ownerId();

    if (req.method === "GET") {
      const photos = await supabaseRest(
        `photos?user_id=eq.${encodeURIComponent(userId)}&select=${PHOTO_SELECT}&order=taken_at.desc`,
      );
      sendJson(res, 200, { photos });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const studyDayId = String(body.studyDayId || "");
      const existing = await supabaseRest(
        `photos?user_id=eq.${encodeURIComponent(userId)}&study_day_id=eq.${encodeURIComponent(studyDayId)}&select=id&limit=1`,
      );
      if (existing.length) {
        throw httpError(409, "This day already has a photo.");
      }

      const row = {
        user_id: userId,
        study_day_id: studyDayId,
        file_path: String(body.filePath || ""),
        file_name: String(body.fileName || ""),
        taken_at: String(body.takenAt || new Date().toISOString()),
        english_date: String(body.englishDate || ""),
        hebrew_date: String(body.hebrewDate || ""),
        tractate: String(body.tractate || ""),
        assignment: String(body.assignment || ""),
      };
      if (!row.study_day_id || !row.file_path.startsWith(`${userId}/`) || !row.file_name) {
        throw httpError(400, "Missing photo details.");
      }

      const saved = await supabaseRest(`photos?select=${PHOTO_SELECT}`, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: row,
      });
      sendJson(res, 200, { photo: saved[0] });
      return;
    }

    if (req.method === "DELETE") {
      const body = await readJson(req);
      const rowId = String(body.rowId || "");
      if (!rowId) {
        throw httpError(400, "Missing photo id.");
      }

      const rows = await supabaseRest(
        `photos?id=eq.${encodeURIComponent(rowId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,file_path&limit=1`,
      );
      const row = rows[0];
      if (!row) {
        throw httpError(404, "Photo not found.");
      }

      await supabaseStorage(`object/${photoBucket()}`, {
        method: "DELETE",
        body: { prefixes: [row.file_path] },
      });
      await supabaseRest(
        `photos?id=eq.${encodeURIComponent(rowId)}&user_id=eq.${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );

      sendJson(res, 200, { deleted: rowId });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendError(res, error);
  }
};
