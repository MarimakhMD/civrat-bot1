-- CIVRAT Tickets Free — PHASE 1 ADDITIVE UNIQUEMENT — projet à examiner.
-- NE DÉBLOQUE PAS LES LIMITES > 1 ET NE CONSTITUE PAS LA MIGRATION FINALE.
-- À exécuter manuellement seulement APRÈS les précontrôles et revue décrits
-- dans docs/proposals/tickets-free-persistence.md. Jamais exécuté par le bot.
-- Hypothèses : PostgreSQL >= 13, rôles Supabase anon/authenticated/service_role,
-- table public.tickets existante, types snowflakes text et statuts documentés.
-- Aucun backfill et aucune suppression d'index, de policy ou de données.
BEGIN;

-- Refuser une collision plutôt que présumer qu'un ancien objet est compatible.
DO $$
BEGIN
  IF to_regclass('public.tickets') IS NULL THEN
    RAISE EXCEPTION 'public.tickets absent : arrêter et vérifier le schéma';
  END IF;
  IF to_regclass('public.civrat_ticket_free_settings') IS NOT NULL OR
     to_regclass('public.civrat_ticket_free_categories') IS NOT NULL THEN
    RAISE EXCEPTION 'tables Tickets Free déjà présentes : comparer le schéma, ne pas rejouer';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets'
      AND column_name IN ('free_category_id', 'free_category_name', 'free_destination_id', 'free_support_role_ids', 'free_permission_profile', 'free_welcome_message', 'free_open_limit')) THEN
    RAISE EXCEPTION 'colonnes Tickets Free déjà présentes : comparer avant migration';
  END IF;
END $$;

CREATE TABLE public.civrat_ticket_free_settings (
  guild_id text PRIMARY KEY,
  open_limit smallint NOT NULL DEFAULT 1 CHECK (open_limit BETWEEN 1 AND 5),
  transcript_mode text NOT NULL DEFAULT 'required' CHECK (transcript_mode IN ('required', 'disabled')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.civrat_ticket_free_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  destination_id text NOT NULL CHECK (destination_id ~ '^[0-9]{15,22}$'),
  support_role_ids text[] NOT NULL CHECK (
    cardinality(support_role_ids) BETWEEN 1 AND 5 AND
    array_position(support_role_ids, NULL) IS NULL AND
    array_to_string(support_role_ids, ',') ~ '^[0-9]{15,22}(,[0-9]{15,22}){0,4}$'
  ),
  welcome_message text CHECK (welcome_message IS NULL OR char_length(btrim(welcome_message)) BETWEEN 1 AND 2000),
  open_limit smallint CHECK (open_limit BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id)
);
CREATE INDEX civrat_ticket_free_categories_guild_idx ON public.civrat_ticket_free_categories (guild_id, archived, enabled);

-- Valeurs NULL pour l'historique : aucune identité ni droit ne sont inventés.
-- Pas de FK : la désactivation/archivage ne doit pas altérer un instantané.
ALTER TABLE public.tickets
  ADD COLUMN free_category_id uuid,
  ADD COLUMN free_category_name text,
  ADD COLUMN free_destination_id text,
  ADD COLUMN free_support_role_ids text[],
  ADD COLUMN free_permission_profile text CHECK (free_permission_profile IS NULL OR free_permission_profile = 'standard-v1'),
  ADD COLUMN free_welcome_message text,
  ADD COLUMN free_open_limit smallint CHECK (free_open_limit BETWEEN 1 AND 5);

-- Les nouvelles tables ne sont accessibles qu'au rôle serveur privilégié.
-- RLS sans policy publique : service_role Supabase contourne RLS (à vérifier).
ALTER TABLE public.civrat_ticket_free_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civrat_ticket_free_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.civrat_ticket_free_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.civrat_ticket_free_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.civrat_ticket_free_settings TO service_role;
REVOKE ALL ON public.civrat_ticket_free_categories FROM service_role;
GRANT SELECT ON public.civrat_ticket_free_categories TO service_role;

-- Création/édition sérialisée par serveur. La borne porte sur toutes les
-- catégories non archivées (actives ou non). Les archives sont conservées.
-- Ce verrou n'est PAS la RPC de réservation des tickets.
CREATE FUNCTION public.civrat_ticket_free_save_category(
  p_guild_id text, p_id uuid, p_name text, p_enabled boolean,
  p_destination_id text, p_support_role_ids text[], p_welcome_message text,
  p_open_limit smallint, p_archive boolean
) RETURNS public.civrat_ticket_free_categories
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result public.civrat_ticket_free_categories;
BEGIN
  IF p_guild_id IS NULL OR p_guild_id !~ '^[0-9]{15,22}$' OR p_enabled IS NULL OR p_archive IS NULL THEN
    RAISE EXCEPTION 'invalid category guild or state' USING ERRCODE = '22023';
  END IF;
  IF p_support_role_ids IS NULL OR p_guild_id = ANY(p_support_role_ids) OR
     cardinality(p_support_role_ids) <> (SELECT count(DISTINCT role_id) FROM unnest(p_support_role_ids) AS role_id) THEN
    RAISE EXCEPTION 'invalid category roles' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('civrat-ticket-categories:' || p_guild_id, 0));
  IF p_id IS NULL THEN
    IF p_archive THEN RAISE EXCEPTION 'cannot create archived category' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM public.civrat_ticket_free_categories WHERE guild_id = p_guild_id AND NOT archived) >= 10 THEN
      RAISE EXCEPTION 'category limit reached' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.civrat_ticket_free_categories
      (guild_id, name, enabled, destination_id, support_role_ids, welcome_message, open_limit)
    VALUES (p_guild_id, p_name, p_enabled, p_destination_id, p_support_role_ids, p_welcome_message, p_open_limit)
    RETURNING * INTO result;
  ELSE
    UPDATE public.civrat_ticket_free_categories SET name = p_name, enabled = p_enabled,
      destination_id = p_destination_id, support_role_ids = p_support_role_ids,
      welcome_message = p_welcome_message, open_limit = p_open_limit, archived = p_archive, updated_at = now()
    WHERE guild_id = p_guild_id AND id = p_id AND NOT archived RETURNING * INTO result;
    IF NOT FOUND THEN RAISE EXCEPTION 'category not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.civrat_ticket_free_save_category(text, uuid, text, boolean, text, text[], text, smallint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_free_save_category(text, uuid, text, boolean, text, text[], text, smallint, boolean) TO service_role;

-- Proposition : ce contrat exige toujours l'index unique historique (1 ticket).
-- L'archivage et cette fonction prennent le même verrou par guilde.
-- Aucun remplacement de l'index ni limite >1 n'est effectué ici.
CREATE FUNCTION public.civrat_ticket_free_create_snapshot(
  p_guild_id text, p_user_id text, p_channel_id text, p_panel_id bigint,
  p_category_id uuid, p_name text, p_destination_id text, p_role_ids text[],
  p_welcome_message text, p_open_limit smallint
) RETURNS public.tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE selected public.civrat_ticket_free_categories; result public.tickets;
BEGIN
  IF p_guild_id IS NULL OR p_user_id IS NULL OR p_channel_id IS NULL OR p_category_id IS NULL THEN
    RAISE EXCEPTION 'invalid ticket request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('civrat-ticket-categories:' || p_guild_id, 0));
  SELECT * INTO selected FROM public.civrat_ticket_free_categories
    WHERE guild_id = p_guild_id AND id = p_category_id AND enabled AND NOT archived;
  IF NOT FOUND OR selected.name IS DISTINCT FROM p_name OR
     selected.destination_id IS DISTINCT FROM p_destination_id OR
     selected.support_role_ids IS DISTINCT FROM p_role_ids OR
     selected.welcome_message IS DISTINCT FROM p_welcome_message OR
     selected.open_limit IS DISTINCT FROM p_open_limit THEN
    RAISE EXCEPTION 'category unavailable or changed' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.tickets (guild_id, user_id, channel_id, category, status, closed, panel_id,
    free_category_id, free_category_name, free_destination_id, free_support_role_ids, free_permission_profile, free_welcome_message, free_open_limit)
  VALUES (p_guild_id, p_user_id, p_channel_id, 'support', 'open', false, p_panel_id,
    selected.id, selected.name, selected.destination_id, selected.support_role_ids, 'standard-v1', selected.welcome_message, selected.open_limit)
  RETURNING * INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.civrat_ticket_free_create_snapshot(text, text, text, bigint, uuid, text, text, text[], text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_free_create_snapshot(text, text, text, bigint, uuid, text, text, text[], text, smallint) TO service_role;

COMMIT;
