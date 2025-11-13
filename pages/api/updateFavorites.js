import { createSupabaseClientWithJwt } from '@/lib/supabase';
import { getToken } from 'next-auth/jwt';
import { ensureUserProfile } from '@/lib/profile';
import { makeSupabaseJwsFromToken } from '@/lib/jwt';
import { setNoStore, sendError, ensureMethod } from '@/lib/http';
import { UpdateFavoritesBody, parseOrThrow } from '@/lib/validation';
import { createLogger } from '@/lib/logger';
let log = createLogger('api:updateFavorites');

// Function to get a user's favorites from Supabase
async function getUserFavorites(supabaseClient, userId) {
  const { data, error } = await supabaseClient
    .from('favorites')
    .select('token_id')
    .eq('user_id', userId);
  
  if (error) {
    throw error;
  }
  
  return data.map(fav => fav.token_id);
}

// Function to update a user's favorites in Supabase
async function updateUserFavorites(supabaseClient, userId, favorites) {
  // dedupe y normaliza ids por si llegan repetidos/case
  const unique = Array.from(new Set((favorites || []).map((id) => String(id).toLowerCase())));

  // Try transactional RPC if available
  try {
    const { error: rpcError } = await supabaseClient.rpc('replace_user_favorites', {
      p_user_id: userId,
      p_token_ids: unique,
    });
    if (rpcError) throw rpcError;
    return true;
  } catch (e) {
    // If the function doesn't exist or fails, fallback to current method (delete + insert)
    // Delete all existing favorites for the user
    const { error: deleteError } = await supabaseClient
      .from('favorites')
      .delete()
      .eq('user_id', userId);
    if (deleteError) throw deleteError;

    if (unique.length > 0) {
      const favoritesData = unique.map((tokenId) => ({ user_id: userId, token_id: tokenId }));
      const { error: insertError } = await supabaseClient.from('favorites').insert(favoritesData);
      if (insertError) throw insertError;
    }
    return true;
  }
}

function mapSupabaseErrorToHttp(error) {
  const status = error?.status;
  const msg = String(error?.message || '').toLowerCase();
  // Auth/JWT issues
  if (status === 401 || msg.includes('jwt') || msg.includes('unauthorized')) {
    return { http: 401, code: 'NOT_AUTHENTICATED', message: 'Supabase auth failed. Check SUPABASE_JWT_SECRET and JWT setup.' };
  }
  // RLS / permissions
  if (status === 403 || msg.includes('permission denied') || msg.includes('forbidden')) {
    return { http: 403, code: 'FORBIDDEN', message: 'Operation not allowed by RLS policies for this user.' };
  }
  return { http: 500, code: 'INTERNAL_ERROR', message: 'Failed to process request' };
}

export default async function handler(req, res) {
  setNoStore(res);

  // Allowed methods
  const methodErr = ensureMethod(req, res, ['GET', 'POST']);
  if (methodErr) return;

  const requestId = req.headers['x-request-id'] || null;
  log = log.child('request', { requestId });

  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.id) {
      return sendError(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');
    }
    const userId = token.id;
    log = log.child('request', { requestId, userId });

    // Create JWS (3 parts) for Supabase
    const jws = makeSupabaseJwsFromToken(token);
    const supabaseClient = createSupabaseClientWithJwt(jws);

    // JIT profile creation if not exists (required due to FK on favorites)
    await ensureUserProfile(supabaseClient, token);

    if (req.method === 'GET') {
      const favorites = await getUserFavorites(supabaseClient, userId);
      return res.status(200).json(favorites);
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = parseOrThrow(UpdateFavoritesBody, req.body);
      } catch (e) {
        if (e.name === 'ValidationError') {
          return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid favorites format', e.details);
        }
        throw e;
      }

      await updateUserFavorites(supabaseClient, userId, body.favorites);
      return res.status(200).json({ message: 'Favorites updated successfully' });
    }

    // Should be covered by ensureMethod
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  } catch (error) {
    log.error('updateFavorites API error', { error });
    const mapped = mapSupabaseErrorToHttp(error);
    return sendError(res, mapped.http, mapped.code, mapped.message);
  }
}