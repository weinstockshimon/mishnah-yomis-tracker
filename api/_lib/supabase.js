const DEFAULT_SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
const DEFAULT_PHOTO_BUCKET = "study-photos";

function supabaseUrl() {
  return (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

function photoBucket() {
  return process.env.SUPABASE_PHOTO_BUCKET || DEFAULT_PHOTO_BUCKET;
}

function serviceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw httpError(500, "Missing SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  }
  return key;
}

function ownerId() {
  const id = process.env.TRACKER_USER_ID;
  if (!id) {
    throw httpError(500, "Missing TRACKER_USER_ID in Vercel.");
  }
  return id;
}

function trackerPasscode() {
  const code = process.env.TRACKER_PASSCODE;
  if (!code) {
    throw httpError(500, "Missing TRACKER_PASSCODE in Vercel.");
  }
  return code;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireAccess(req) {
  const supplied = String(req.headers["x-tracker-passcode"] || "");
  if (!supplied || supplied !== trackerPasscode()) {
    throw httpError(401, "Wrong passcode.");
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const status = error.status || 500;
  sendJson(res, status, { error: error.message || "Request failed." });
}

async function supabaseRest(path, options = {}) {
  const key = serviceKey();
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return parseSupabaseResponse(response);
}

async function supabaseStorage(path, options = {}) {
  const key = serviceKey();
  const response = await fetch(`${supabaseUrl()}/storage/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return parseSupabaseResponse(response);
}

async function parseSupabaseResponse(response) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message = data?.message || data?.error || text || "Supabase request failed.";
    throw httpError(response.status, message);
  }
  return data;
}

function encodeStoragePath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function signedUrlFromStorage(value) {
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `${supabaseUrl()}/storage/v1${value.startsWith("/") ? value : `/${value}`}`;
}

module.exports = {
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
};
