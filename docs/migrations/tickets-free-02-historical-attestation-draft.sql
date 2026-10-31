-- CIVRAT Tickets Free — 02 HISTORICAL ATTESTATION — FINAL
-- RECONSTRUCTION : ce fichier a été reconstruit, pas restauré — version finale validée structurellement
-- Objet : attestation auditable des droits historiques (salons sans snapshot fiable)
-- Principe : jamais déduire les permissions depuis les rôles actuels ; preuve explicite fournie par administrateur MANAGE_GUILD
-- Dépendances : 01 (civrat_ticket_free_settings/categories) + public.tickets (guild_id, channel_id, user_id, status, closed, panel_id, created_at, free_* colonnes NULL pour historique)
-- Hypothèses : PostgreSQL >=13, rôles Supabase anon/authenticated/service_role, service_role bypass RLS, pg_advisory_xact_lock disponible
-- Sécurité : RLS sans policy publique, écriture exclusive via RPC SECURITY DEFINER, jamais de déduction automatique
-- Ne pas exécuter sans revue, sauvegarde et précontrôles manuels

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.civrat_ticket_historical_attestations') IS NOT NULL OR
     to_regclass('public.civrat_ticket_historical_refusals') IS NOT NULL THEN
    RAISE EXCEPTION 'tables 02 déjà présentes : comparer le schéma, ne pas rejouer';
  END IF;
  IF to_regclass('public.tickets') IS NULL THEN
    RAISE EXCEPTION 'public.tickets absent : vérifier le schéma de base';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Tables : attestation unique par salon, journal des refus append-only
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.civrat_ticket_historical_attestations (
  guild_id text NOT NULL CHECK (guild_id ~ '^[0-9]{15,22}$'),
  channel_id text NOT NULL CHECK (channel_id ~ '^[0-9]{15,22}$'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9]{15,22}$'),
  request_id uuid NOT NULL,
  role_ids text[] NOT NULL CHECK (
    cardinality(role_ids) BETWEEN 1 AND 5 AND
    array_position(role_ids, NULL) IS NULL AND
    array_to_string(role_ids, ',') ~ '^[0-9]{15,22}(,[0-9]{15,22}){0,4}$' AND
    NOT (guild_id = ANY(role_ids))
  ),
  permission_profile text NOT NULL CHECK (permission_profile = 'legacy-staff-v1'),
  evidence text NOT NULL CHECK (char_length(btrim(evidence)) BETWEEN 20 AND 1000),
  result text NOT NULL CHECK (result = 'attested'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id),
  UNIQUE (request_id),
  CHECK (array_position(role_ids, NULL) IS NULL),
  CHECK (cardinality(role_ids) = (SELECT count(DISTINCT x) FROM unnest(role_ids) AS x))
);

CREATE INDEX civrat_ticket_historical_attestations_request_id_idx
  ON public.civrat_ticket_historical_attestations (request_id);

CREATE INDEX civrat_ticket_historical_attestations_actor_idx
  ON public.civrat_ticket_historical_attestations (guild_id, actor_id, created_at);

CREATE TABLE public.civrat_ticket_historical_refusals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL CHECK (guild_id ~ '^[0-9]{15,22}$'),
  channel_id text CHECK (channel_id IS NULL OR channel_id ~ '^[0-9]{15,22}$'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9]{15,22}$'),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX civrat_ticket_historical_refusals_guild_idx
  ON public.civrat_ticket_historical_refusals (guild_id, created_at);

CREATE INDEX civrat_ticket_historical_refusals_channel_idx
  ON public.civrat_ticket_historical_refusals (guild_id, channel_id, created_at);

-- RLS : aucune policy publique, lecture restreinte à service_role, écriture via RPC
ALTER TABLE public.civrat_ticket_historical_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civrat_ticket_historical_refusals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.civrat_ticket_historical_attestations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.civrat_ticket_historical_refusals FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.civrat_ticket_historical_attestations TO service_role;
GRANT SELECT ON public.civrat_ticket_historical_refusals TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC : attestation historique avec vérification d'état et idempotence
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.civrat_ticket_historical_attest(
  p_guild_id text,
  p_channel_id text,
  p_actor_id text,
  p_request_id uuid,
  p_role_ids text[],
  p_evidence text,
  p_expected_user_id text,
  p_expected_status text,
  p_expected_closed boolean,
  p_expected_panel_id bigint,
  p_expected_created_at timestamptz
) RETURNS public.civrat_ticket_historical_attestations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.civrat_ticket_historical_attestations;
  v_ticket public.tickets;
  v_evidence text;
BEGIN
  -- Validation stricte des paramètres (jamais faire confiance au client)
  IF p_guild_id IS NULL OR p_guild_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid guild_id' USING ERRCODE = '22023';
  END IF;
  IF p_channel_id IS NULL OR p_channel_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid channel_id' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid actor_id' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid request_id' USING ERRCODE = '22023';
  END IF;
  IF p_role_ids IS NULL OR cardinality(p_role_ids) < 1 OR cardinality(p_role_ids) > 5 THEN
    RAISE EXCEPTION 'invalid role_ids cardinality' USING ERRCODE = '22023';
  END IF;
  IF p_guild_id = ANY(p_role_ids) THEN
    RAISE EXCEPTION 'role_ids must not contain guild_id' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_role_ids) AS x) <> cardinality(p_role_ids) THEN
    RAISE EXCEPTION 'role_ids must be distinct' USING ERRCODE = '22023';
  END IF;
  IF p_evidence IS NULL OR char_length(btrim(p_evidence)) < 20 OR char_length(btrim(p_evidence)) > 1000 THEN
    RAISE EXCEPTION 'invalid evidence length' USING ERRCODE = '22023';
  END IF;
  IF p_expected_user_id IS NULL OR p_expected_user_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid expected_user_id' USING ERRCODE = '22023';
  END IF;
  IF p_expected_status IS NULL OR p_expected_status NOT IN ('open','claimed','closed') THEN
    RAISE EXCEPTION 'invalid expected_status' USING ERRCODE = '22023';
  END IF;
  v_evidence := btrim(p_evidence);

  -- Verrou d'exclusion par salon historique (évite double attestation concurrente)
  PERFORM pg_advisory_xact_lock(hashtextextended('civrat-historical:' || p_guild_id || ':' || p_channel_id, 0));

  -- Idempotence : même request_id déjà attesté → retourner l'existant
  SELECT * INTO v_existing FROM public.civrat_ticket_historical_attestations WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.guild_id <> p_guild_id OR v_existing.channel_id <> p_channel_id OR v_existing.actor_id <> p_actor_id THEN
      RAISE EXCEPTION 'idempotency conflict: request_id already used for different ticket' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing;
  END IF;

  -- Idempotence : même salon déjà attesté → retourner l'existant (attestation unique par salon)
  SELECT * INTO v_existing FROM public.civrat_ticket_historical_attestations WHERE guild_id = p_guild_id AND channel_id = p_channel_id FOR UPDATE;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- Vérifier que le ticket historique existe et n'a pas de snapshot fiable (free_* doivent être NULL)
  SELECT * INTO v_ticket FROM public.tickets WHERE guild_id = p_guild_id AND channel_id = p_channel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket not found for historical attestation' USING ERRCODE = 'P0001';
  END IF;
  IF v_ticket.free_category_id IS NOT NULL OR v_ticket.free_support_role_ids IS NOT NULL OR v_ticket.free_permission_profile IS NOT NULL THEN
    RAISE EXCEPTION 'ticket already has reliable snapshot, not eligible for historical attestation' USING ERRCODE = 'P0001';
  END IF;
  IF v_ticket.status NOT IN ('open','claimed','closed') THEN
    RAISE EXCEPTION 'ticket status not eligible' USING ERRCODE = 'P0001';
  END IF;

  -- Comparer l'état attendu avec l'état réel (détection de changement concurrent)
  IF v_ticket.user_id IS DISTINCT FROM p_expected_user_id OR
     v_ticket.status IS DISTINCT FROM p_expected_status OR
     v_ticket.closed IS DISTINCT FROM p_expected_closed OR
     (v_ticket.panel_id IS DISTINCT FROM p_expected_panel_id) OR
     (v_ticket.created_at IS DISTINCT FROM p_expected_created_at) THEN
    RAISE EXCEPTION 'ticket state changed since inspect' USING ERRCODE = 'P0001', HINT = 'attestation_ticket_changed';
  END IF;

  -- Insertion auditable (preuve explicite fournie par administrateur MANAGE_GUILD, vérifié côté applicatif)
  INSERT INTO public.civrat_ticket_historical_attestations (
    guild_id, channel_id, actor_id, request_id, role_ids, permission_profile, evidence, result
  ) VALUES (
    p_guild_id, p_channel_id, p_actor_id, p_request_id, p_role_ids, 'legacy-staff-v1', v_evidence, 'attested'
  ) RETURNING * INTO v_existing;

  RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_historical_attest(text, text, text, uuid, text[], text, text, text, boolean, bigint, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_historical_attest(text, text, text, uuid, text[], text, text, text, boolean, bigint, timestamptz) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC : journal des refus (append-only, aucun UPDATE/DELETE)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.civrat_ticket_historical_refusal(
  p_guild_id text,
  p_channel_id text,
  p_actor_id text,
  p_reason text
) RETURNS public.civrat_ticket_historical_refusals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result public.civrat_ticket_historical_refusals;
  v_reason text;
BEGIN
  IF p_guild_id IS NULL OR p_guild_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid guild_id' USING ERRCODE = '22023';
  END IF;
  IF p_channel_id IS NOT NULL AND p_channel_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid channel_id' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid actor_id' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 1 OR char_length(btrim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'invalid reason' USING ERRCODE = '22023';
  END IF;
  v_reason := btrim(p_reason);

  INSERT INTO public.civrat_ticket_historical_refusals (guild_id, channel_id, actor_id, reason)
  VALUES (p_guild_id, p_channel_id, p_actor_id, v_reason)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_historical_refusal(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_historical_refusal(text, text, text, text) TO service_role;

COMMIT;
