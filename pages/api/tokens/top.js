import { ensureMethod, sendError, setNoStore } from '@/lib/http';
import { getAllPrices } from '@/lib/priceCache';
import { TopTokensQuery, parseOrThrow } from '@/lib/validation';

export default async function handler(req, res) {
  const ensure = ensureMethod(req, res, ['GET']);
  if (ensure) return;
  setNoStore(res);
  let limit = 25;
  try {
    const parsed = parseOrThrow(TopTokensQuery, req.query);
    limit = parsed.limit ?? 25;
  } catch (e) {
    if (e.name === 'ValidationError') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid query', e.details);
    }
  }
  try {
    const data = await getAllPrices();
    return res.status(200).json(data.slice(0, limit));
  } catch (e) {
    if (e?.message === 'UPSTREAM_UNAVAILABLE') {
      return sendError(res, 503, 'UPSTREAM_UNAVAILABLE', 'Failed to fetch token prices');
    }
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
}