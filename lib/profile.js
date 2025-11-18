// JIT profile creation helper using Supabase with JWT
// Server-only usage (API/SSR)
if (typeof window !== 'undefined') {
  throw new Error('Do not import `lib/profile.js` in the browser. Use server/API only.');
}

export async function ensureUserProfile(supabaseClient, token) {
  if (!token?.id) throw new Error('Token with id is required for ensureUserProfile');

  const { data: existing, error: findError } = await supabaseClient
    .from('profiles')
    .select('user_id')
    .eq('user_id', token.id)
    .maybeSingle();

  if (findError && findError.code !== 'PGRST116') {
    // PGRST116: no rows returned (profile does not exist)
    throw findError;
  }

  if (existing) return existing;

  const username = token?.email
    ? token.email.split('@')[0]
    : (token?.name || `user_${String(token.id).slice(0, 6)}`);

  const insertPayload = {
    user_id: token.id,
    email: token.email,
    username,
    bio: "",
    twitter_link: null,
    telegram_link: null,
    updated_at: new Date().toISOString(),
    // Do NOT set wallet_address here to avoid duplicates
    wallet_address: null,
    wallet_linked_at: null,
  };

  const { data: created, error: insertError } = await supabaseClient
    .from('profiles')
    .insert([insertPayload])
    .select('user_id')
    .maybeSingle();

  if (insertError) throw insertError;
  return created;
}