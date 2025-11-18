// Server-only small HTTP helpers for API routes
if (typeof window !== 'undefined') {
  throw new Error('Do not import `lib/http.js` in the browser. Use server/API only.');
}

export function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

export function sendError(res, status, code, message, details) {
  return res.status(status).json({ error: message, code, details });
}

export function ensureMethod(req, res, allowedMethods) {
  if (!allowedMethods.includes(req.method)) {
    res.setHeader('Allow', allowedMethods.join(', '));
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method not allowed. Use ${allowedMethods.join(', ')}`);
  }
  return null;
}