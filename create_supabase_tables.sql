-- ========================================
-- GUIDE TO CREATE TABLES IN SUPABASE
-- ========================================
-- 
-- INSTRUCTIONS:
-- 1. Go to https://supabase.com/dashboard
-- 2. Select your project
-- 3. Open "SQL Editor" in the sidebar
-- 4. Copy and paste the following queries one by one
-- 5. Run each query by clicking "Run"
--
-- ========================================

-- STEP 1: Create 'profiles' table for users
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    username TEXT,
    email TEXT UNIQUE,
    bio TEXT,
    twitter_link TEXT,
    telegram_link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- MIGRATION: drop 'password' column if exists (legacy)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='profiles' AND column_name='password'
  ) THEN
    ALTER TABLE public.profiles DROP COLUMN password;
  END IF;
END;
$$;

-- MIGRATION: allow NULL on email (wallet accounts without email)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'email'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.profiles ALTER COLUMN email DROP NOT NULL;
  END IF;
END;
$$;

-- STEP 2: Create 'favorites' table for user favorites
CREATE TABLE IF NOT EXISTS public.favorites (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, token_id)
);

-- STEP 3: Create indexes to improve performance
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_token_id ON public.favorites(token_id);

-- Enforce unique constraint on username
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_username_unique'
    ) THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_username_unique UNIQUE (username);
    END IF;
END;
$$;


-- STEP 4: Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- STEP 5: Robust security policies
-- Revoke open policies if they exist
DROP POLICY IF EXISTS "Allow all operations on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow all operations on favorites" ON public.favorites;

-- User policies strictly control access via auth.uid(); no special admin-role policies defined.

-- Foreign key for referential integrity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_favorites_user'
  ) THEN
    ALTER TABLE public.favorites
      ADD CONSTRAINT fk_favorites_user
      FOREIGN KEY (user_id) REFERENCES public.profiles(user_id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

-- Transactional RPC to atomically replace a user's favorites
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'replace_user_favorites'
  ) THEN
    CREATE OR REPLACE FUNCTION public.replace_user_favorites(p_user_id TEXT, p_token_ids TEXT[])
    RETURNS VOID
    AS $fn$
    DECLARE
      _has_ids BOOLEAN;
    BEGIN
      -- Enforce caller owns the row via JWT
      IF (auth.jwt() ->> 'sub') IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
      END IF;

      -- Advisory lock per user to serialize concurrent updates
      PERFORM pg_advisory_xact_lock(hashtext(p_user_id));

      _has_ids := (p_token_ids IS NOT NULL) AND (array_length(p_token_ids, 1) IS NOT NULL) AND (array_length(p_token_ids, 1) > 0);

      IF NOT _has_ids THEN
        DELETE FROM public.favorites WHERE user_id = p_user_id;
      ELSE
        WITH input_ids AS (
          SELECT DISTINCT LOWER(unnest(p_token_ids)) AS token_id
        ), del AS (
          DELETE FROM public.favorites f
          WHERE f.user_id = p_user_id
            AND NOT EXISTS (SELECT 1 FROM input_ids i WHERE i.token_id = f.token_id)
          RETURNING 1
        )
        INSERT INTO public.favorites(user_id, token_id)
        SELECT p_user_id, i.token_id FROM input_ids i
        ON CONFLICT (user_id, token_id) DO NOTHING;
      END IF;
    END;
    $fn$
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public;
    COMMENT ON FUNCTION public.replace_user_favorites(TEXT, TEXT[]) IS 'Atomically replace favorites for a user with advisory lock and RLS-aware JWT check';
  END IF;
END;
$$;

-- ========================================
-- STEP 6: ADD WALLET COLUMNS
-- ========================================
-- Add wallet columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS wallet_address TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS wallet_linked_at TIMESTAMPTZ;

-- Create index to improve wallet address search performance
CREATE INDEX IF NOT EXISTS idx_profiles_wallet_address ON public.profiles(wallet_address);

-- Add comments to document the new columns
COMMENT ON COLUMN public.profiles.wallet_address IS 'Ethereum wallet address linked to user profile';
COMMENT ON COLUMN public.profiles.wallet_linked_at IS 'Timestamp when the wallet was linked to the profile';

-- ========================================
-- STEP 6.2: Normalize and ensure robust uniqueness of wallet_address
-- ========================================

-- 6.2.1: Unlink duplicates due to casing (keep oldest by created_at)
WITH norm AS (
  SELECT id,
         wallet_address,
         LOWER(wallet_address) AS wallet_norm,
         ROW_NUMBER() OVER (PARTITION BY LOWER(wallet_address) ORDER BY created_at ASC, id ASC) AS rn
  FROM public.profiles
  WHERE wallet_address IS NOT NULL
), to_unlink AS (
  UPDATE public.profiles p
  SET wallet_address = NULL,
      wallet_linked_at = NULL
  FROM norm n
  WHERE p.id = n.id AND n.rn > 1
  RETURNING p.id
)
-- 6.2.2: Normalize all addresses to lowercase
UPDATE public.profiles
SET wallet_address = LOWER(wallet_address)
WHERE wallet_address IS NOT NULL AND wallet_address <> LOWER(wallet_address);

-- 6.2.3: Add CHECK to enforce lowercase storage (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_wallet_address_lowercase_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_wallet_address_lowercase_chk
      CHECK (wallet_address IS NULL OR wallet_address = LOWER(wallet_address));
  END IF;
END;
$$;

-- 6.2.4: Drop redundant non-unique index (UNIQUE constraint already creates index)
DROP INDEX IF EXISTS idx_profiles_wallet_address;

-- 6.2.5: Ensure partial UNIQUE index on non-null wallet_address (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_profiles_wallet_address'
  ) THEN
    CREATE UNIQUE INDEX uniq_profiles_wallet_address
    ON public.profiles (wallet_address)
    WHERE wallet_address IS NOT NULL;
  END IF;
END;
$$;

-- 6.2.6: Trigger to normalize wallet_address to lowercase on insert/update (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'normalize_wallet_lowercase'
  ) THEN
    CREATE FUNCTION public.normalize_wallet_lowercase()
    RETURNS trigger
    AS $fn$
    BEGIN
      IF NEW.wallet_address IS NOT NULL THEN
        NEW.wallet_address := LOWER(NEW.wallet_address);
        IF NEW.wallet_address = '' THEN
          NEW.wallet_address := NULL;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $fn$
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_profiles_wallet_normalize'
  ) THEN
    CREATE TRIGGER trg_profiles_wallet_normalize
    BEFORE INSERT OR UPDATE OF wallet_address ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.normalize_wallet_lowercase();
  END IF;
END;
$$;

-- Note: Global uniqueness is ensured by the UNIQUE column and lowercase CHECK.
-- If you want to allow the same wallet per network, model an additional column (e.g., chain_id) and change uniqueness to (chain_id, wallet_address).

-- ========================================
-- VERIFICATION
-- ========================================
-- After running all queries, you can verify tables were created correctly by executing:
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' AND table_name IN ('profiles', 'favorites');
--
-- ========================================

-- ========================================
-- STEP 5.1: Policies for authenticated users with NextAuth JWT
-- ========================================
-- These policies allow users with JWT to operate only on their own records using the standard 'sub' claim (auth.uid()).

-- Profiles: allow the user to operate on their own record
DROP POLICY IF EXISTS profiles_select_user ON public.profiles;
CREATE POLICY profiles_select_user ON public.profiles
  FOR SELECT USING ((auth.jwt() ->> 'sub') = user_id);

DROP POLICY IF EXISTS profiles_insert_user ON public.profiles;
CREATE POLICY profiles_insert_user ON public.profiles
  FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

DROP POLICY IF EXISTS profiles_update_user ON public.profiles;
CREATE POLICY profiles_update_user ON public.profiles
  FOR UPDATE USING ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

-- Favorites: restrict by owner
DROP POLICY IF EXISTS favorites_select_user ON public.favorites;
CREATE POLICY favorites_select_user ON public.favorites
  FOR SELECT USING ((auth.jwt() ->> 'sub') = user_id);

DROP POLICY IF EXISTS favorites_insert_user ON public.favorites;
CREATE POLICY favorites_insert_user ON public.favorites
  FOR INSERT WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

DROP POLICY IF EXISTS favorites_update_user ON public.favorites;
CREATE POLICY favorites_update_user ON public.favorites
  FOR UPDATE USING ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

DROP POLICY IF EXISTS favorites_delete_user ON public.favorites;
CREATE POLICY favorites_delete_user ON public.favorites
  FOR DELETE USING ((auth.jwt() ->> 'sub') = user_id);
