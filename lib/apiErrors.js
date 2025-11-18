// Frontend helpers to parse and format API errors consistently

export async function parseApiError(res) {
  const status = res?.status ?? 0;
  let payload = null;
  let message = res?.statusText || '';
  try {
    payload = await res.json();
    message = payload?.error || payload?.message || message;
  } catch (_) {
    try {
      const text = await res.text();
      if (text && !message) message = text.slice(0, 300);
    } catch (_) {}
  }
  const code = payload?.code || null;
  const details = payload?.details || null;
  return { status, code, message, details };
}

export function formatValidationDetails(details) {
  if (!Array.isArray(details) || !details.length) return null;
  // Join distinct messages concisely
  const msgs = Array.from(new Set(details.map((d) => d?.message).filter(Boolean)));
  return msgs.join('; ');
}

export function getFriendlyErrorMessage(code, fallback) {
  const map = {
    NOT_AUTHENTICATED: 'Your session has expired. Please sign in again.',
    VALIDATION_ERROR: 'Invalid data. Check required fields.',
    WALLET_TAKEN: 'This wallet is already linked to another account.',
    CHALLENGE_EXPIRED: 'Challenge expired; request a new one.',
    DOMAIN_MISMATCH: 'Domain mismatch. Reload the page and try again.',
    SIGNATURE_INVALID: 'Signature is invalid.',
    PROFILE_NOT_FOUND: 'Profile not found. Please sign in again.',
    LINK_FAILED: 'Could not link wallet.',
    UNLINK_FAILED: 'Could not unlink wallet.',
    DB_ERROR: 'Database error.',
    UPSTREAM_UNAVAILABLE: 'Price provider unavailable. Please try later.',
    METHOD_NOT_ALLOWED: 'Method not allowed.',
    INTERNAL_ERROR: 'Internal error. Please try again later.',
  };
  return map[code] || (fallback || 'An error occurred');
}