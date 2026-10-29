-- REVIEW ONLY. Not executed by CIVRAT, npm, startup or this preparation.
-- A DBA must inspect the real schema, backup and validate on a disposable
-- Supabase project before any separately authorized production application.
-- Existing data, RLS, grants and historical columns are NOT removed/rewritten.
BEGIN;

-- Three fields newly consumed since the audited main, plus the pre-existing
-- welcome toggle (documented here because older schema docs omitted it).
ALTER TABLE public.guild_configs
  ADD COLUMN IF NOT EXISTS automod_exempt_roles text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS automod_exempt_channels text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS welcome_image_key text,
  ADD COLUMN IF NOT EXISTS welcome_image_enabled boolean DEFAULT false;

-- IF NOT EXISTS alone does not validate an existing column. Abort atomically
-- on incompatible types/nullability/defaults; do not coerce or backfill data.
DO $review$
DECLARE
  column_name_to_check text;
  info record;
BEGIN
  FOREACH column_name_to_check IN ARRAY ARRAY['automod_exempt_roles', 'automod_exempt_channels'] LOOP
    SELECT data_type, udt_name, is_nullable, column_default INTO info
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'guild_configs'
        AND column_name = column_name_to_check;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing column: %', column_name_to_check;
    END IF;
    IF info.data_type <> 'ARRAY' OR info.udt_name <> '_text'
       OR info.is_nullable <> 'NO' OR info.column_default IS NULL THEN
      RAISE EXCEPTION 'Review existing type/nullability/default for %; no automatic conversion', column_name_to_check;
    END IF;
  END LOOP;

  SELECT data_type, is_nullable INTO info FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guild_configs' AND column_name = 'welcome_image_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing welcome_image_key'; END IF;
  IF info.data_type <> 'text' OR info.is_nullable <> 'YES' THEN
    RAISE EXCEPTION 'welcome_image_key must be nullable text; review existing definition';
  END IF;

  SELECT data_type INTO info FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guild_configs' AND column_name = 'welcome_image_enabled';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing welcome_image_enabled'; END IF;
  IF info.data_type <> 'boolean' THEN
    RAISE EXCEPTION 'welcome_image_enabled must be boolean; review existing definition';
  END IF;
END;
$review$;

-- The DBA must additionally inspect actual array defaults (empty array),
-- guild_id text/PK/uniqueness, existing RLS/grants and Storage policies.
-- This file does not create a bucket, change policies or drop legacy columns.
COMMIT;
