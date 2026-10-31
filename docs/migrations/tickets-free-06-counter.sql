-- CIVRAT Tickets Free — 06 COMPTEUR ATOMIQUE IDEMPOTENT — À EXAMINER MANUELLEMENT
-- Ne pas exécuter sans revue, sauvegarde et précontrôles. Dépend de 01.
-- Hypothèses : PostgreSQL >=13, guild_configs préexistant (ticket_category_id etc.),
-- rôles Supabase service_role bypass RLS, pg_advisory_xact_lock disponible.
-- Cette migration est ADDITIVE : aucune suppression, aucun DROP, aucune donnée écrasée.
-- Elle fournit l'idempotence par opération (même opération rejouée = même numéro).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- Précontrôles : refuser si objets incompatibles déjà présents
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.guild_configs') IS NULL THEN
    RAISE EXCEPTION 'public.guild_configs absent : vérifier le schéma de base';
  END IF;
  -- civrat_ticket_number_reservations ne doit pas déjà exister
  IF to_regclass('public.civrat_ticket_number_reservations') IS NOT NULL THEN
    RAISE EXCEPTION 'civrat_ticket_number_reservations déjà présent : comparer le schéma, ne pas rejouer';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Colonne compteur : additive, sans écraser une valeur existante
-- ─────────────────────────────────────────────────────────────────────────
-- Si la colonne n'existe pas, elle est créée avec DEFAULT 0 (les lignes
-- existantes reçoivent 0, les nouvelles lignes héritent du défaut).
-- Si elle existe déjà, ADD COLUMN IF NOT EXISTS ne touche pas aux valeurs.
ALTER TABLE public.guild_configs
  ADD COLUMN IF NOT EXISTS ticket_counter integer NOT NULL DEFAULT 0;

-- Garde-fou : s'assurer que les lignes existantes avec NULL (migration manuelle
-- antérieure sans DEFAULT) reçoivent 0 sans diminuer les valeurs déjà posées.
-- COALESCE n'écrase pas les valeurs >0.
UPDATE public.guild_configs SET ticket_counter = 0 WHERE ticket_counter IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Table de réservation idempotente des numéros
-- ─────────────────────────────────────────────────────────────────────────
-- Chaque opération de création (interaction Discord) réserve un numéro unique.
-- Rejouer la même opération (même p_operation_id) rend le MÊME numéro sans
-- incrémenter : idempotence réseau (réponse perdue) + protection concurrence.
CREATE TABLE public.civrat_ticket_number_reservations (
  operation_id text PRIMARY KEY CHECK (char_length(btrim(operation_id)) BETWEEN 1 AND 200),
  guild_id text NOT NULL CHECK (guild_id ~ '^[0-9]{15,22}$'),
  ticket_number integer NOT NULL CHECK (ticket_number >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, ticket_number)
);

CREATE INDEX civrat_ticket_number_reservations_guild_idx
  ON public.civrat_ticket_number_reservations (guild_id, created_at);

-- RLS : seules les RPC SECURITY DEFINER écrivent ; lecture restreinte à service_role
ALTER TABLE public.civrat_ticket_number_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.civrat_ticket_number_reservations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.civrat_ticket_number_reservations TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Fonction atomique simple (compatibilité ascendante)
-- ─────────────────────────────────────────────────────────────────────────
-- Ancienne signature : increment_ticket_counter(p_guild_id text) -> integer
-- Reste disponible pour les appelants qui n'ont pas d'operation_id.
-- Elle est atomique (INSERT … ON CONFLICT DO UPDATE … RETURNING) mais NON
-- idempotente : deux appels distincts incrémentent deux fois. Les nouveaux
-- appelants doivent utiliser civrat_ticket_reserve_number ci-dessous.
CREATE OR REPLACE FUNCTION public.increment_ticket_counter(p_guild_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_value integer;
BEGIN
  IF p_guild_id IS NULL OR p_guild_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid guild_id' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.guild_configs (guild_id, ticket_counter)
    VALUES (p_guild_id, 1)
    ON CONFLICT (guild_id) DO UPDATE SET ticket_counter = guild_configs.ticket_counter + 1
    RETURNING ticket_counter INTO next_value;
  RETURN next_value;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_ticket_counter(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ticket_counter(text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Fonction idempotente par opération (nouveau contrat)
-- ─────────────────────────────────────────────────────────────────────────
-- c i v r a t _ t i c k e t _ r e s e r v e _ n u m b e r
--   p_guild_id    : guilde cible (snowflake text)
--   p_operation_id: identifiant unique de l'opération (déterministe par
--                   interaction Discord, ex: hash civrat-reservation:guild:interaction:category)
-- Retourne un integer strictement croissant par guilde, idempotent :
--   même (guild_id, operation_id) → même ticket_number, jamais incrémenté à nouveau.
-- Protection concurrence : advisory lock par guilde + re-vérification après lock.
CREATE OR REPLACE FUNCTION public.civrat_ticket_reserve_number(p_guild_id text, p_operation_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing integer;
  v_new integer;
BEGIN
  IF p_guild_id IS NULL OR p_guild_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid guild_id' USING ERRCODE = '22023';
  END IF;
  IF p_operation_id IS NULL OR char_length(btrim(p_operation_id)) = 0 THEN
    RAISE EXCEPTION 'invalid operation_id' USING ERRCODE = '22023';
  END IF;

  -- 1. Retour immédiat si l'opération a déjà réservé un numéro (idempotence)
  SELECT ticket_number INTO v_existing
    FROM public.civrat_ticket_number_reservations
    WHERE operation_id = p_operation_id AND guild_id = p_guild_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- 2. Verrou d'exclusion par guilde (évite 2 incréments concurrents distincts)
  PERFORM pg_advisory_xact_lock(hashtextextended('civrat-ticket-number:' || p_guild_id, 0));

  -- 3. Re-vérifier après lock (course entre 2 workers sur même operation_id)
  SELECT ticket_number INTO v_existing
    FROM public.civrat_ticket_number_reservations
    WHERE operation_id = p_operation_id AND guild_id = p_guild_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- 4. Incrément atomique du compteur persistant
  INSERT INTO public.guild_configs (guild_id, ticket_counter)
    VALUES (p_guild_id, 1)
    ON CONFLICT (guild_id) DO UPDATE SET ticket_counter = guild_configs.ticket_counter + 1
    RETURNING ticket_counter INTO v_new;

  -- 5. Enregistrer la réservation (ON CONFLICT DO NOTHING pour la course ultime)
  INSERT INTO public.civrat_ticket_number_reservations (guild_id, operation_id, ticket_number)
    VALUES (p_guild_id, p_operation_id, v_new)
    ON CONFLICT (operation_id) DO NOTHING;

  -- 6. Si conflit (autre worker a inséré entre 4 et 5), récupérer sa valeur
  SELECT ticket_number INTO v_existing
    FROM public.civrat_ticket_number_reservations
    WHERE operation_id = p_operation_id AND guild_id = p_guild_id;
  IF v_existing IS NOT NULL AND v_existing <> v_new THEN
    -- Un autre worker a gagné : son numéro fait foi, le compteur a un trou
    -- assumé (même comportement que les bots de tickets standards).
    RETURN v_existing;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_reserve_number(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_reserve_number(text, text) TO service_role;

-- Alias pour le repository JS : la fonction historique reste, la nouvelle est
-- le contrat idempotent. Le repository tente d'abord la nouvelle (avec operation_id)
-- et retombe sur l'ancienne si besoin.

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Initialisation sûre du compteur au max existant (précontrôle)
-- ─────────────────────────────────────────────────────────────────────────
-- Discord ne stocke PAS les salons dans Supabase : guild.channels n'est PAS
-- une table PostgreSQL. Le précontrôle doit donc être fait côté applicatif
-- (fetch Discord), puis cette fonction est appelée avec le max trouvé.
-- Elle ne diminue JAMAIS le compteur (GREATEST) et prend un verrou.
CREATE OR REPLACE FUNCTION public.civrat_ticket_counter_init(p_guild_id text, p_max_existing integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current integer;
  v_target integer;
BEGIN
  IF p_guild_id IS NULL OR p_guild_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid guild_id' USING ERRCODE = '22023';
  END IF;
  IF p_max_existing IS NULL OR p_max_existing < 0 THEN
    RAISE EXCEPTION 'invalid max_existing' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('civrat-ticket-counter-init:' || p_guild_id, 0));

  -- Lecture du compteur actuel (0 si ligne absente)
  SELECT COALESCE(ticket_counter, 0) INTO v_current
    FROM public.guild_configs WHERE guild_id = p_guild_id;
  IF NOT FOUND THEN
    v_current := 0;
  END IF;

  v_target := GREATEST(v_current, p_max_existing);

  IF v_target > v_current THEN
    INSERT INTO public.guild_configs (guild_id, ticket_counter)
      VALUES (p_guild_id, v_target)
      ON CONFLICT (guild_id) DO UPDATE SET ticket_counter = GREATEST(guild_configs.ticket_counter, EXCLUDED.ticket_counter)
      RETURNING ticket_counter INTO v_target;
  END IF;

  RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_counter_init(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_counter_init(text, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RPC de verrou pour la réconciliation (multi-processus)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.civrat_ticket_try_reservation_lock(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN pg_try_advisory_xact_lock(hashtextextended('civrat-ticket-reservation:' || p_request_id::text, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.civrat_ticket_try_reservation_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_try_reservation_lock(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.civrat_ticket_unlock_reservation(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- advisory_xact_lock est transactionnel : pas de unlock explicite nécessaire.
  -- On retourne true pour compatibilité de l'API JS.
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.civrat_ticket_unlock_reservation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_unlock_reservation(uuid) TO service_role;

COMMIT;
