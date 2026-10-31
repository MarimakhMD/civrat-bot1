-- CIVRAT Tickets Free — 03 OPERATION JOURNAL — FINAL
-- Objet : journal durable des opérations (création, fermeture, réouverture, participants, transcript, suppression)
-- Dépendances : 01 (guild_configs) + 02 (historical attestation, pour ordre d'application)
-- Principe : intention avant effet externe, scope unique non résolu, transitions conditionnées par révision, idempotence, états incertains
-- Dépendances : 01 ; 02 doit être appliqué avant pour garantir l'ordre, mais 03 peut être appliqué seul si 02 déjà présent
-- Hypothèses : PostgreSQL >=13, service_role bypass RLS, pg_advisory_xact_lock disponible, gen_random_uuid()
-- Sécurité : RLS sans policy publique, écriture via RPC SECURITY DEFINER, scope unique partiel unresolved_scope_idx
-- Ne pas exécuter sans revue, sauvegarde et précontrôles

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.civrat_ticket_operations') IS NOT NULL OR
     to_regclass('public.civrat_ticket_operation_events') IS NOT NULL OR
     to_regclass('public.civrat_ticket_participants') IS NOT NULL THEN
    RAISE EXCEPTION 'tables 03 déjà présentes : comparer le schéma, ne pas rejouer';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Tables : opérations, événements append-only, participants
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.civrat_ticket_operations (
  operation_id uuid PRIMARY KEY,
  guild_id text NOT NULL CHECK (guild_id ~ '^[0-9]{15,22}$'),
  scope text NOT NULL CHECK (scope ~ '^[cu]:[0-9]{15,22}$'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9]{15,22}$'),
  target_id text CHECK (target_id IS NULL OR target_id ~ '^[0-9]{15,22}$'),
  action text NOT NULL CHECK (action IN ('create','create_category','close','reopen','add_member','remove_member','transcript','delete','claim')),
  state text NOT NULL CHECK (state IN ('pending','in_progress','uncertain','confirmed','failed','manual')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  observation text CHECK (observation IS NULL OR char_length(observation) BETWEEN 1 AND 500),
  result_channel_id text CHECK (result_channel_id IS NULL OR result_channel_id ~ '^[0-9]{15,22}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index unique sur scope non résolu (une seule opération en vol par scope)
CREATE UNIQUE INDEX civrat_ticket_operations_unresolved_scope_idx
  ON public.civrat_ticket_operations (scope)
  WHERE state IN ('pending','in_progress','uncertain','manual');

CREATE INDEX civrat_ticket_operations_guild_scope_idx
  ON public.civrat_ticket_operations (guild_id, scope, created_at);

CREATE INDEX civrat_ticket_operations_recovery_idx
  ON public.civrat_ticket_operations (guild_id, state, created_at)
  WHERE state IN ('pending','in_progress','uncertain','manual');

CREATE INDEX civrat_ticket_operations_created_at_idx
  ON public.civrat_ticket_operations (guild_id, created_at, operation_id);

CREATE TABLE public.civrat_ticket_operation_events (
  operation_id uuid NOT NULL REFERENCES public.civrat_ticket_operations(operation_id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','in_progress','uncertain','confirmed','failed','manual')),
  observation text CHECK (observation IS NULL OR char_length(observation) BETWEEN 1 AND 500),
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9]{15,22}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, revision)
);

CREATE INDEX civrat_ticket_operation_events_operation_idx
  ON public.civrat_ticket_operation_events (operation_id, created_at);

CREATE TABLE public.civrat_ticket_participants (
  guild_id text NOT NULL CHECK (guild_id ~ '^[0-9]{15,22}$'),
  channel_id text NOT NULL CHECK (channel_id ~ '^[0-9]{15,22}$'),
  member_id text NOT NULL CHECK (member_id ~ '^[0-9]{15,22}$'),
  state text NOT NULL CHECK (state IN ('active','removed')),
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9]{15,22}$'),
  operation_id uuid NOT NULL REFERENCES public.civrat_ticket_operations(operation_id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id, member_id)
);

CREATE INDEX civrat_ticket_participants_channel_idx
  ON public.civrat_ticket_participants (guild_id, channel_id, updated_at);

CREATE INDEX civrat_ticket_participants_operation_idx
  ON public.civrat_ticket_participants (operation_id);

-- RLS : aucune policy publique, lecture restreinte à service_role, écriture via RPC
ALTER TABLE public.civrat_ticket_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civrat_ticket_operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civrat_ticket_participants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.civrat_ticket_operations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.civrat_ticket_operation_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.civrat_ticket_participants FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.civrat_ticket_operations TO service_role;
GRANT SELECT ON public.civrat_ticket_operation_events TO service_role;
GRANT SELECT ON public.civrat_ticket_participants TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC : début d'opération (idempotent, scope unique)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.civrat_ticket_operation_begin(
  p_operation_id uuid,
  p_guild_id text,
  p_scope text,
  p_actor_id text,
  p_target_id text,
  p_action text
) RETURNS public.civrat_ticket_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.civrat_ticket_operations;
  v_result public.civrat_ticket_operations;
BEGIN
  IF p_operation_id IS NULL OR p_guild_id IS NULL OR p_guild_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid operation params' USING ERRCODE = '22023';
  END IF;
  IF p_scope IS NULL OR p_scope !~ '^[cu]:[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid scope' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid actor_id' USING ERRCODE = '22023';
  END IF;
  IF p_target_id IS NOT NULL AND p_target_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid target_id' USING ERRCODE = '22023';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('create','create_category','close','reopen','add_member','remove_member','transcript','delete','claim') THEN
    RAISE EXCEPTION 'invalid action' USING ERRCODE = '22023';
  END IF;

  -- Verrou d'exclusion par scope (évite 2 opérations concurrentes sur même scope)
  PERFORM pg_advisory_xact_lock(hashtextextended('civrat-op-scope:' || p_guild_id || ':' || p_scope, 0));

  -- Idempotence : même operation_id déjà existant → retourner l'existant si même scope/action
  SELECT * INTO v_existing FROM public.civrat_ticket_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.guild_id <> p_guild_id OR v_existing.scope <> p_scope OR v_existing.action <> p_action THEN
      RAISE EXCEPTION 'idempotency conflict: operation_id already used with different scope/action' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing;
  END IF;

  -- Vérifier qu'aucune opération non résolue n'occupe déjà ce scope (via index unique partiel)
  -- L'index fera échouer l'INSERT en 23505 si violé, mais on vérifie d'abord pour message clair
  PERFORM 1 FROM public.civrat_ticket_operations
    WHERE scope = p_scope AND state IN ('pending','in_progress','uncertain','manual') FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'scope busy: unresolved operation already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.civrat_ticket_operations (operation_id, guild_id, scope, actor_id, target_id, action, state, revision)
  VALUES (p_operation_id, p_guild_id, p_scope, p_actor_id, p_target_id, p_action, 'pending', 0)
  RETURNING * INTO v_result;

  INSERT INTO public.civrat_ticket_operation_events (operation_id, revision, state, observation, actor_id)
  VALUES (p_operation_id, 0, 'pending', 'intent', p_actor_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_operation_begin(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_operation_begin(uuid, text, text, text, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC : transition d'état (CAS par révision)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.civrat_ticket_operation_transition(
  p_guild_id text,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_state text,
  p_observation text,
  p_actor_id text
) RETURNS public.civrat_ticket_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.civrat_ticket_operations;
  v_result public.civrat_ticket_operations;
BEGIN
  IF p_guild_id IS NULL OR p_guild_id !~ '^[0-9]{15,22}$' OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid transition params' USING ERRCODE = '22023';
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('pending','in_progress','uncertain','confirmed','failed','manual') THEN
    RAISE EXCEPTION 'invalid state' USING ERRCODE = '22023';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid actor_id' USING ERRCODE = '22023';
  END IF;
  IF p_observation IS NOT NULL AND (char_length(p_observation) < 1 OR char_length(p_observation) > 500) THEN
    RAISE EXCEPTION 'invalid observation' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_current FROM public.civrat_ticket_operations
    WHERE operation_id = p_operation_id AND guild_id = p_guild_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not found' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'revision mismatch: expected %, got %', p_expected_revision, v_current.revision USING ERRCODE = 'P0001';
  END IF;

  -- Machine d'état simplifiée : pending->in_progress->uncertain/confirmed/failed/manual, in_progress->*, uncertain->*
  -- On autorise toute transition sauf confirmed/failed->autre (terminal)
  IF v_current.state IN ('confirmed','failed') THEN
    RAISE EXCEPTION 'terminal state cannot transition' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.civrat_ticket_operations
  SET state = p_state,
      observation = p_observation,
      revision = revision + 1,
      updated_at = now()
  WHERE operation_id = p_operation_id AND guild_id = p_guild_id AND revision = p_expected_revision
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'concurrent revision conflict' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.civrat_ticket_operation_events (operation_id, revision, state, observation, actor_id)
  VALUES (p_operation_id, v_result.revision, p_state, p_observation, p_actor_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_operation_transition(text, uuid, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_operation_transition(text, uuid, bigint, text, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC : confirmation participant (add/remove)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.civrat_ticket_participant_confirm(
  p_guild_id text,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_actor_id text
) RETURNS public.civrat_ticket_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.civrat_ticket_operations;
  v_result public.civrat_ticket_operations;
BEGIN
  IF p_guild_id IS NULL OR p_operation_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid participant confirm params' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_current FROM public.civrat_ticket_operations
    WHERE operation_id = p_operation_id AND guild_id = p_guild_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not found' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'revision mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.state <> 'in_progress' THEN
    RAISE EXCEPTION 'operation not in_progress' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.civrat_ticket_operations
  SET state = 'confirmed',
      revision = revision + 1,
      updated_at = now()
  WHERE operation_id = p_operation_id AND guild_id = p_guild_id AND revision = p_expected_revision
  RETURNING * INTO v_result;

  INSERT INTO public.civrat_ticket_operation_events (operation_id, revision, state, observation, actor_id)
  VALUES (p_operation_id, v_result.revision, 'confirmed', 'participant_confirmed', p_actor_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_participant_confirm(text, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_participant_confirm(text, uuid, bigint, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC : confirmation création (u: -> c: corrélation)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.civrat_ticket_creation_confirm(
  p_guild_id text,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_actor_id text,
  p_channel_id text
) RETURNS public.civrat_ticket_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current public.civrat_ticket_operations;
  v_result public.civrat_ticket_operations;
BEGIN
  IF p_guild_id IS NULL OR p_channel_id IS NULL OR p_channel_id !~ '^[0-9]{15,22}$' THEN
    RAISE EXCEPTION 'invalid creation confirm params' USING ERRCODE = '22023';
  END IF;
  IF p_operation_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid params' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_current FROM public.civrat_ticket_operations
    WHERE operation_id = p_operation_id AND guild_id = p_guild_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not found' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'revision mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.state <> 'in_progress' THEN
    RAISE EXCEPTION 'operation not in_progress' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.civrat_ticket_operations
  SET state = 'confirmed',
      result_channel_id = p_channel_id,
      revision = revision + 1,
      updated_at = now()
  WHERE operation_id = p_operation_id AND guild_id = p_guild_id AND revision = p_expected_revision
  RETURNING * INTO v_result;

  INSERT INTO public.civrat_ticket_operation_events (operation_id, revision, state, observation, actor_id)
  VALUES (p_operation_id, v_result.revision, 'confirmed', 'creation_confirmed', p_actor_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_creation_confirm(text, uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_creation_confirm(text, uuid, bigint, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC : liste paginée des opérations non résolues (curseur stable)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.civrat_ticket_operations_list_unresolved(
  p_guild_id text,
  p_limit integer,
  p_after_created_at timestamptz,
  p_after_operation_id uuid
) RETURNS SETOF public.civrat_ticket_operations
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT * FROM public.civrat_ticket_operations
  WHERE guild_id = p_guild_id
    AND state IN ('pending','in_progress','uncertain','manual')
    AND (
      p_after_created_at IS NULL
      OR created_at > p_after_created_at
      OR (created_at = p_after_created_at AND operation_id > p_after_operation_id)
    )
  ORDER BY created_at ASC, operation_id ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.civrat_ticket_operations_list_unresolved(text, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_operations_list_unresolved(text, integer, timestamptz, uuid) TO service_role;

COMMIT;
