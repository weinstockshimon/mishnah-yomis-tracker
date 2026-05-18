const {
  ownerId,
  readJson,
  requireAccess,
  sendError,
  sendJson,
  supabaseRest,
} = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  try {
    requireAccess(req);

    if (req.method === "GET") {
      const userId = ownerId();
      const progress = await supabaseRest(
        `progress?user_id=eq.${encodeURIComponent(userId)}&select=study_day_id,completed`,
      );
      sendJson(res, 200, { progress });
      return;
    }

    if (req.method === "POST" || req.method === "PUT") {
      const userId = ownerId();
      const body = await readJson(req);
      const changes = Array.isArray(body.changes) ? body.changes : [body];
      const now = new Date().toISOString();
      const rows = changes
        .filter((change) => change && change.studyDayId)
        .map((change) => ({
          user_id: userId,
          study_day_id: String(change.studyDayId),
          completed: Boolean(change.completed),
          completed_at: change.completed ? now : null,
          updated_at: now,
        }));

      if (rows.length) {
        await supabaseRest("progress?on_conflict=user_id,study_day_id", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=minimal" },
          body: rows,
        });
      }

      sendJson(res, 200, { saved: rows.length });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendError(res, error);
  }
};
