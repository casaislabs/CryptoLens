import { ensureMethod, sendError, setNoStore } from '@/lib/http';
import { getAllPrices } from '@/lib/priceCache';
import { createLogger } from '@/lib/logger';

export default async function handler(req, res) {
  const ensure = ensureMethod(req, res, ['GET']);
  if (ensure) return;
  setNoStore(res);

  let log = createLogger('api:tokens:all');
  const requestId = req.headers['x-request-id'] || req.headers['X-Request-Id'] || null;
  if (requestId) {
    log = log.child('request', { requestId });
  }

  try {
    log.info('Fetching all token prices');
    const data = await getAllPrices();
    const count = data && typeof data === 'object' ? Object.keys(data).length : 0;
    log.info('Fetched token prices', { count });
    return res.status(200).json(data);
  } catch (e) {
    log.error('Failed to fetch token prices', e);
    if (e?.message === 'UPSTREAM_UNAVAILABLE') {
      return sendError(res, 503, 'UPSTREAM_UNAVAILABLE', 'Failed to fetch token prices');
    }
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
}