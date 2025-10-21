import { ensureMethod, sendError, setNoStore } from '@/lib/http';
import { getAllPrices } from '@/lib/priceCache';

export default async function handler(req, res) {
  const ensure = ensureMethod(req, res, ['GET']);
  if (ensure) return;
  setNoStore(res);
  try {
    const data = await getAllPrices();
    return res.status(200).json(data);
  } catch (e) {
    if (e?.message === 'UPSTREAM_UNAVAILABLE') {
      return sendError(res, 503, 'UPSTREAM_UNAVAILABLE', 'Failed to fetch token prices');
    }
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
}