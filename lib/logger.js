// Unified logger with levels, namespaces, request context, and safe metadata
// Server: pino (JSON, fast); Client: console fallback
// Usage:
//   import { createLogger, logger } from '@/lib/logger';
//   const log = createLogger('api:wallet');
//   log.info('Link success', { userId });
//   const reqLog = log.child('request', { requestId: 'abc', userId: 'u1' });
//   reqLog.error('Failed to link', { code: 'WALLET_TAKEN' });

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function getEnvLevel() {
  try {
    const isServer = typeof window === 'undefined';
    const raw = isServer
      ? (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'))
      : (process.env.NEXT_PUBLIC_LOG_LEVEL || 'info');
    const val = String(raw || '').toLowerCase();
    return LEVELS[val] != null ? val : 'info';
  } catch (_) {
    return 'info';
  }
}

function safeMeta(meta) {
  if (!meta || typeof meta !== 'object') return undefined;
  try {
    const clone = JSON.parse(JSON.stringify(meta, (k, v) => {
      // redact known sensitive keys
      if (typeof k === 'string' && /token|password|secret|signature|siwe/i.test(k)) return '[redacted]';
      return v;
    }));
    return clone;
  } catch (_) {
    return undefined;
  }
}

function formatLine(level, ns, defaultFields, msg, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] ${level.toUpperCase()}${ns ? `:${ns}` : ''} - ${msg}`;
  const merged = { ...(defaultFields || {}), ...(safeMeta(meta) || {}) };
  const hasMeta = merged && Object.keys(merged).length > 0;
  return hasMeta ? `${base} | ${JSON.stringify(merged)}` : base;
}

let pinoInstance = null;
(function initPino() {
  if (typeof window === 'undefined') {
    try {
      const pino = require('pino');
      pinoInstance = pino({
        level: getEnvLevel(),
        base: { service: 'web3-dashboard' },
        redact: { paths: ['token', 'password', 'secret', 'signature', 'siwe', '*.token', '*.password', '*.secret', '*.signature', '*.siwe'], censor: '[redacted]' },
      });
    } catch (_) {
      pinoInstance = null; // fallback to console
    }
  }
})();

export function createLogger(namespace = '', defaultFields = {}) {
  const envLevel = getEnvLevel();
  const envNum = LEVELS[envLevel];
  const ns = namespace;
  const isServer = typeof window === 'undefined';

  if (isServer && pinoInstance) {
    const child = pinoInstance.child({ ns, ...(defaultFields || {}) });
    function emit(level, msg, meta) {
      if (LEVELS[level] < envNum) return;
      const cleaned = safeMeta(meta) || {};
      const errorObj = (meta instanceof Error)
        ? meta
        : (meta && meta.err instanceof Error ? meta.err : null);
      if (errorObj) {
        child[level]({ ...cleaned, err: errorObj }, String(msg));
      } else {
        child[level]({ ...cleaned }, String(msg));
      }
    }
    return {
      level: envLevel,
      isServer,
      ns,
      debug: (msg, meta) => emit('debug', msg, meta),
      info: (msg, meta) => emit('info', msg, meta),
      warn: (msg, meta) => emit('warn', msg, meta),
      error: (msg, meta) => emit('error', msg, meta),
      child: (childNs, fields) => createLogger(ns ? `${ns}:${childNs}` : childNs, { ...(defaultFields || {}), ...(fields || {}) }),
    };
  }

  // Client or fallback: console with formatted line
  function emit(level, msg, meta) {
    if (LEVELS[level] < envNum) return;
    const line = formatLine(level, ns, defaultFields, String(msg), meta);
    switch (level) {
      case 'debug': (console.debug || console.log)(line); break;
      case 'info': (console.info || console.log)(line); break;
      case 'warn': (console.warn || console.log)(line); break;
      case 'error': (console.error || console.log)(line); break;
      default: (console.log)(line);
    }
  }

  return {
    level: envLevel,
    isServer,
    ns,
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
    child: (childNs, fields) => createLogger(ns ? `${ns}:${childNs}` : childNs, { ...(defaultFields || {}), ...(fields || {}) }),
  };
}

export const logger = createLogger('app');