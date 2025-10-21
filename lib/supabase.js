import { createClient } from '@supabase/supabase-js';

// Enforce server-only usage to protect SUPABASE_KEY
if (typeof window !== 'undefined') {
  throw new Error('Do not import `lib/supabase.js` in the browser. Use API routes instead.');
}

// Supabase client configuration (server-side only)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables: SUPABASE_URL and SUPABASE_KEY');
}

// Configuration options
const supabaseOptions = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
};

// Main Supabase client (anon key) - server-only usage (API/SSR)
export const supabase = createClient(supabaseUrl, supabaseKey, supabaseOptions);

// Per-request client with NextAuth JWT for RLS (server-only)
export function createSupabaseClientWithJwt(jwt) {
  if (!jwt) throw new Error('JWT required for per-request client');
  return createClient(supabaseUrl, supabaseKey, {
    ...supabaseOptions,
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      }
    }
  });
}

export default supabase;