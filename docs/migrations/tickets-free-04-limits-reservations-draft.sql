-- CIVRAT Tickets Free — 04 LIMITES & RÉSERVATIONS ATOMIQUES — FINAL
-- Objet : réservation atomique du créneau (limite globale 1-5 + limite catégorie 1-5), double-clic idempotent, concurrence, réouverture, annulation, finalisation, reprise
-- Dépendances : 01 (civrat_ticket_free_settings/categories) + 03 (civrat_ticket_operations, pour ordre d'application, mais 04 peut être appliqué après 01 si 03 déjà présent)
-- Hypothèses : PostgreSQL >=13, idx_tickets_open_unique conservé jusqu'à validation explicite, RLS existante, service_role bypass RLS, pg_advisory_xact_lock disponible
-- Sécurité : RLS sans policy publique, écriture via RPC SECURITY DEFINER, advisory lock par guild:user + guild:category, idempotence par request_id
-- Cohérence : 06 (compteur) et 07 (lease) dépendent de 04 ; 05 (transition index) ne doit être exécutée qu'après validation PG multi-instances de 04
-- Ne pas exécuter sans revue, sauvegarde et précontrôles manuels complets

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.civrat_ticket_free_settings') IS NULL THEN
    RAISE EXCEPTION 'civrat_ticket_free_settings absent : appliquer 01 d''abord';
  END IF;
  IF to_regclass('public.civrat_ticket_operations') IS NULL THEN
    RAISE EXCEPTION 'civrat_ticket_operations absent : appliquer 03 d''abord';
  END IF;
  IF to_regclass('public.civrat_ticket_reservations') IS NOT NULL THEN
    RAISE EXCEPTION 'civrat_ticket_reservations déjà présent : comparer schéma';
  END IF;
END $$;

-- Réservations : une par demande (request_id), par guilde/membre.
-- États : reserved (créneau compté), external_pending (Discord sans réponse),
-- channel_known (salon créé, pas encore finalisé), finalized (ticket inséré),
-- cleanup_pending (annulation en cours), cancelled, expired (réconcilié).
CREATE TABLE public.civrat_ticket_reservations (
  request_id uuid PRIMARY KEY,
  guild_id text NOT NULL CHECK (guild_id ~ '^[0-9]{15,22}$'),
  user_id text NOT NULL CHECK (user_id ~ '^[0-9]{15,22}$'),
  category_id uuid,
  channel_id text CHECK (channel_id IS NULL OR channel_id ~ '^[0-9]{15,22}$'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9]{15,22}$'),
  state text NOT NULL CHECK (state IN ('reserved','external_pending','channel_known','finalized','cleanup_pending','cancelled','expired')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CHECK ((category_id IS NULL) OR category_id::text ~ '^[0-9a-f-]{36}$'),
  CONSTRAINT civrat_reservations_channel_finalized CHECK ((state = 'finalized') = (channel_id IS NOT NULL) OR state IN ('reserved','external_pending','channel_known','cleanup_pending','cancelled','expired'))
);

CREATE INDEX civrat_ticket_reservations_guild_user_idx ON public.civrat_ticket_reservations (guild_id, user_id, state);
CREATE INDEX civrat_ticket_reservations_category_idx ON public.civrat_ticket_reservations (guild_id, category_id, state) WHERE category_id IS NOT NULL;
CREATE INDEX civrat_ticket_reservations_pending_idx ON public.civrat_ticket_reservations (guild_id, state, created_at) WHERE state IN ('reserved','external_pending','channel_known','cleanup_pending');

ALTER TABLE public.civrat_ticket_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.civrat_ticket_reservations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.civrat_ticket_reservations TO service_role;

-- Helper : lecture limite globale (1 par défaut si ligne absente)
CREATE FUNCTION public.civrat_ticket_get_global_limit(p_guild_id text)
RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v smallint;
BEGIN
  SELECT open_limit INTO v FROM public.civrat_ticket_free_settings WHERE guild_id = p_guild_id;
  IF NOT FOUND THEN RETURN 1; END IF;
  RETURN v;
END $$;

-- Réservation avant Discord : vérifie catégorie active, fige snapshot, compte tickets + réservations sous verrou.
CREATE FUNCTION public.civrat_ticket_reserve_open(
  p_guild_id text, p_user_id text, p_category_id uuid, p_request_id uuid, p_actor_id text
) RETURNS public.civrat_ticket_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  global_limit smallint;
  category_limit smallint;
  global_count int;
  category_count int;
  cat public.civrat_ticket_free_categories;
  existing public.civrat_ticket_reservations;
  result public.civrat_ticket_reservations;
BEGIN
  IF p_guild_id IS NULL OR p_user_id IS NULL OR p_request_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid reserve request' USING ERRCODE = '22023';
  END IF;
  -- Ordre de verrouillage stable : guilde/catégorie → membre
  IF p_category_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('civrat-ticket-category:' || p_guild_id || ':' || p_category_id::text, 0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('civrat-ticket-reserve:' || p_guild_id || ':' || p_user_id, 0));

  -- Idempotence : même request_id rend le même résultat
  SELECT * INTO existing FROM public.civrat_ticket_reservations WHERE request_id = p_request_id;
  IF FOUND THEN
    IF existing.guild_id <> p_guild_id OR existing.user_id <> p_user_id OR existing.category_id IS DISTINCT FROM p_category_id THEN
      RAISE EXCEPTION 'idempotency conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing;
  END IF;

  -- Vérifier catégorie si fournie : active, non archivée
  IF p_category_id IS NOT NULL THEN
    SELECT * INTO cat FROM public.civrat_ticket_free_categories WHERE guild_id = p_guild_id AND id = p_category_id AND enabled AND NOT archived;
    IF NOT FOUND THEN RAISE EXCEPTION 'category unavailable or changed' USING ERRCODE = 'P0001'; END IF;
    category_limit := cat.open_limit;
  END IF;

  -- Compter tickets ouverts/claimed + réservations actives (y compris external_pending/channel_known)
  -- Les historiques sans catégorie comptent uniquement dans global.
  global_limit := public.civrat_ticket_get_global_limit(p_guild_id);
  SELECT count(*) INTO global_count FROM public.tickets
    WHERE guild_id = p_guild_id AND user_id = p_user_id AND status IN ('open','claimed');
  SELECT global_count + count(*) INTO global_count FROM public.civrat_ticket_reservations
    WHERE guild_id = p_guild_id AND user_id = p_user_id AND state IN ('reserved','external_pending','channel_known');

  IF global_count >= global_limit THEN
    RAISE EXCEPTION 'global limit reached' USING ERRCODE = 'P0001', HINT = 'TICKET_LIMIT_REACHED';
  END IF;

  IF p_category_id IS NOT NULL AND category_limit IS NOT NULL THEN
    SELECT count(*) INTO category_count FROM public.tickets
      WHERE guild_id = p_guild_id AND user_id = p_user_id AND free_category_id = p_category_id AND status IN ('open','claimed');
    SELECT category_count + count(*) INTO category_count FROM public.civrat_ticket_reservations
      WHERE guild_id = p_guild_id AND user_id = p_user_id AND category_id = p_category_id AND state IN ('reserved','external_pending','channel_known');
    IF category_count >= category_limit THEN
      RAISE EXCEPTION 'category limit reached' USING ERRCODE = 'P0001', HINT = 'TICKET_CATEGORY_LIMIT_REACHED';
    END IF;
  END IF;

  INSERT INTO public.civrat_ticket_reservations (request_id, guild_id, user_id, category_id, actor_id, state)
    VALUES (p_request_id, p_guild_id, p_user_id, p_category_id, p_actor_id, 'reserved')
    RETURNING * INTO result;
  RETURN result;
END $$;

CREATE FUNCTION public.civrat_ticket_finalize_open(
  p_request_id uuid, p_channel_id text
) RETURNS public.civrat_ticket_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE res public.civrat_ticket_reservations;
BEGIN
  SELECT * INTO STRICT res FROM public.civrat_ticket_reservations WHERE request_id = p_request_id FOR UPDATE;
  IF res.state NOT IN ('reserved','external_pending','channel_known') THEN
    RAISE EXCEPTION 'reservation not finalizable' USING ERRCODE = 'P0001';
  END IF;
  -- Vérifier que le salon Discord existe et que la ligne tickets a été insérée (via ticketRepository, hors fonction)
  UPDATE public.civrat_ticket_reservations SET channel_id = p_channel_id, state = 'finalized', revision = revision+1, updated_at = now()
    WHERE request_id = p_request_id RETURNING * INTO res;
  RETURN res;
END $$;

CREATE FUNCTION public.civrat_ticket_cancel_reservation(
  p_request_id uuid, p_actor_id text
) RETURNS public.civrat_ticket_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE res public.civrat_ticket_reservations;
BEGIN
  SELECT * INTO STRICT res FROM public.civrat_ticket_reservations WHERE request_id = p_request_id FOR UPDATE;
  -- Ne libérer que si état externe confirmé non existant (vérif Discord + tickets faite côté JS)
  IF res.state NOT IN ('reserved','external_pending','channel_known','cleanup_pending') THEN
    RAISE EXCEPTION 'reservation not cancellable' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.civrat_ticket_reservations SET state = 'cancelled', revision = revision+1, updated_at = now()
    WHERE request_id = p_request_id RETURNING * INTO res;
  RETURN res;
END $$;

CREATE FUNCTION public.civrat_ticket_reserve_reopen(
  p_guild_id text, p_user_id text, p_channel_id text, p_request_id uuid, p_actor_id text
) RETURNS public.civrat_ticket_reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ticket public.tickets;
  global_limit smallint;
  global_count int;
  existing public.civrat_ticket_reservations;
  result public.civrat_ticket_reservations;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('civrat-ticket-reserve:' || p_guild_id || ':' || p_user_id, 0));
  SELECT * INTO existing FROM public.civrat_ticket_reservations WHERE request_id = p_request_id;
  IF FOUND THEN
    IF existing.guild_id <> p_guild_id OR existing.user_id <> p_user_id THEN
      RAISE EXCEPTION 'idempotency conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN existing;
  END IF;
  SELECT * INTO STRICT ticket FROM public.tickets WHERE guild_id = p_guild_id AND channel_id = p_channel_id FOR UPDATE;
  IF ticket.user_id <> p_user_id OR ticket.status NOT IN ('closed') THEN
    RAISE EXCEPTION 'ticket not reopenable' USING ERRCODE = 'P0001';
  END IF;
  -- Compter en excluant le ticket fermé lui-même
  global_limit := public.civrat_ticket_get_global_limit(p_guild_id);
  SELECT count(*) INTO global_count FROM public.tickets
    WHERE guild_id = p_guild_id AND user_id = p_user_id AND status IN ('open','claimed');
  SELECT global_count + count(*) INTO global_count FROM public.civrat_ticket_reservations
    WHERE guild_id = p_guild_id AND user_id = p_user_id AND state IN ('reserved','external_pending','channel_known');
  IF global_count >= global_limit THEN
    RAISE EXCEPTION 'global limit reached' USING ERRCODE = 'P0001', HINT = 'TICKET_LIMIT_REACHED';
  END IF;
  -- Si ticket a une catégorie, vérifier sa limite aussi
  IF ticket.free_category_id IS NOT NULL THEN
    DECLARE cat_limit smallint; cat_count int;
    BEGIN
      SELECT open_limit INTO cat_limit FROM public.civrat_ticket_free_categories WHERE id = ticket.free_category_id AND guild_id = p_guild_id;
      IF cat_limit IS NOT NULL THEN
        SELECT count(*) INTO cat_count FROM public.tickets WHERE guild_id = p_guild_id AND user_id = p_user_id AND free_category_id = ticket.free_category_id AND status IN ('open','claimed');
        SELECT cat_count + count(*) INTO cat_count FROM public.civrat_ticket_reservations WHERE guild_id = p_guild_id AND user_id = p_user_id AND category_id = ticket.free_category_id AND state IN ('reserved','external_pending','channel_known');
        IF cat_count >= cat_limit THEN RAISE EXCEPTION 'category limit reached' USING ERRCODE = 'P0001', HINT = 'TICKET_CATEGORY_LIMIT_REACHED'; END IF;
      END IF;
    END;
  END IF;
  INSERT INTO public.civrat_ticket_reservations (request_id, guild_id, user_id, category_id, channel_id, actor_id, state)
    VALUES (p_request_id, p_guild_id, p_user_id, ticket.free_category_id, p_channel_id, p_actor_id, 'reserved')
    RETURNING * INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.civrat_ticket_get_global_limit(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civrat_ticket_reserve_open(text,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civrat_ticket_finalize_open(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civrat_ticket_cancel_reservation(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.civrat_ticket_reserve_reopen(text,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_get_global_limit(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_reserve_open(text,text,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_finalize_open(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_cancel_reservation(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_reserve_reopen(text,text,text,uuid,text) TO service_role;

COMMIT;
