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
  supabaseStorage,
} = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  try {
    requireAccess(req);
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    const body = await readJson(req);
    const filePath = String(body.filePath || "");
    if (!filePath || !filePath.startsWith(`${ownerId()}/`)) {
      throw httpError(400, "Invalid photo path.");
    }

    const signed = await supabaseStorage(
      `object/sign/${photoBucket()}/${encodeStoragePath(filePath)}`,
      {
        method: "POST",
        body: { expiresIn: 600 },
      },
    );

    sendJson(res, 200, {
      signedUrl: signedUrlFromStorage(signed.signedURL || signed.signedUrl || signed.url),
    });
  } catch (error) {
    sendError(res, error);
  }
};
