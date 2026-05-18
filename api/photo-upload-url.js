const {
  encodeStoragePath,
  httpError,
  ownerId,
  photoBucket,
  readJson,
  requireAccess,
  sendError,
  sendJson,
  signedUrlFromStorage,
  supabaseRest,
  supabaseStorage,
} = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  try {
    requireAccess(req);
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    const userId = ownerId();
    const body = await readJson(req);
    const studyDayId = String(body.studyDayId || "");
    const isoDate = String(body.isoDate || "");
    const fileName = String(body.fileName || "").replace(/[\\/:*?"<>|]/g, "-");
    if (!studyDayId || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !fileName) {
      throw httpError(400, "Missing photo upload details.");
    }

    const existing = await supabaseRest(
      `photos?user_id=eq.${encodeURIComponent(userId)}&study_day_id=eq.${encodeURIComponent(studyDayId)}&select=id&limit=1`,
    );
    if (existing.length) {
      throw httpError(409, "This day already has a photo.");
    }

    const filePath = `${userId}/${isoDate}/${fileName}`;
    const signed = await supabaseStorage(
      `object/upload/sign/${photoBucket()}/${encodeStoragePath(filePath)}`,
      {
        method: "POST",
        body: { upsert: false },
      },
    );

    sendJson(res, 200, {
      path: filePath,
      token: signed.token,
      signedUrl: signedUrlFromStorage(signed.signedURL || signed.signedUrl || signed.url),
    });
  } catch (error) {
    sendError(res, error);
  }
};
