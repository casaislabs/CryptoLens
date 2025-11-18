import { createSupabaseClientWithJwt } from "@/lib/supabase";
import { getToken } from 'next-auth/jwt';
import { ensureUserProfile } from "@/lib/profile";
import { makeSupabaseJwsFromToken } from '@/lib/jwt';
import { createLogger } from '@/lib/logger';
let log = createLogger('api:updateProfile');

const normalizeSocialLink = (platform, value) => {
  if (!value) return null;

  if (platform === "twitter") {
    if (value.startsWith("https://twitter.com/") || value.startsWith("https://x.com/")) {
      return value;
    }
    if (value.startsWith("@")) {
      return `https://twitter.com/${value.slice(1)}`;
    }
    return `https://twitter.com/${value}`;
  }

  if (platform === "telegram") {
    if (value.startsWith("https://t.me/")) {
      return value;
    }
    if (value.startsWith("@")) {
      return `https://t.me/${value.slice(1)}`;
    }
    return `https://t.me/${value}`;
  }

  return value;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const requestId = req.headers['x-request-id'] || null;
  log = log.child('request', { requestId });

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.id) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const userId = token.id;
  log = log.child('request', { requestId, userId });

  // Create JWS (3 parts) for Supabase instead of using the raw token (possible JWE)
  const jws = makeSupabaseJwsFromToken(token);
  const supabaseClient = createSupabaseClientWithJwt(jws);

  // JIT profile creation if it does not exist
  await ensureUserProfile(supabaseClient, token);

  const { username, bio, socialLinks } = req.body;
  log.debug("Received data in backend", { username, bio, socialLinks, userId });

  // Validate received data
  if (typeof username !== "string" || username.trim() === "") {
    return res.status(400).json({ error: "Invalid or missing 'username'" });
  }

  if (typeof bio !== "string") {
    return res.status(400).json({ error: "Invalid 'bio'" });
  }

  if (typeof socialLinks !== "object" || !socialLinks) {
    return res.status(400).json({ error: "Invalid 'socialLinks'" });
  }

  const { twitter, telegram } = socialLinks;

  // Normalize social links
  const normalizedTwitter = normalizeSocialLink("twitter", twitter);
  const normalizedTelegram = normalizeSocialLink("telegram", telegram);

  // Validate normalized links
  if (normalizedTwitter && !/^https:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]{1,15}$/.test(normalizedTwitter)) {
    return res.status(400).json({ error: "Invalid Twitter link" });
  }

  if (normalizedTelegram && !/^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(normalizedTelegram)) {
    return res.status(400).json({ error: "Invalid Telegram link" });
  }

  try {
    // Find profile in Supabase
    const { data: existingProfile, error: findError } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (findError || !existingProfile) {
      // If it doesn't exist, it was already created by ensureUserProfile; retrieve safely
      const { data: createdProfile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!createdProfile) {
        return res.status(404).json({ error: "Profile not found" });
      }
    }

    // Update profile in Supabase
    const { data: updatedProfile, error: updateError } = await supabaseClient
      .from('profiles')
      .update({
        username: username,
        bio: bio,
        twitter_link: normalizeSocialLink("twitter", socialLinks?.twitter),
        telegram_link: normalizeSocialLink("telegram", socialLinks?.telegram),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      log.error("Error updating profile", { error: updateError });
      return res.status(500).json({ error: "Failed to update profile" });
    }

    // Format the response to maintain compatibility
    const formattedProfile = {
      ...updatedProfile,
      socialLinks: {
        twitter: updatedProfile.twitter_link,
        telegram: updatedProfile.telegram_link
      }
    };

    return res.status(200).json(formattedProfile);
  } catch (error) {
    log.error("Error updating profile", { error });
    return res.status(500).json({ error: "Failed to update profile" });
  }
}