-- CIVRAT Tickets Free — 07 LEASE DURABLE POUR RECONCILIATION — ADDITIF
-- Ne pas exécuter sans revue. Dépend de 04 (civrat_ticket_reservations).
-- Hypothèses : PostgreSQL >=13, service_role bypass RLS.
-- Raison : pg_advisory_xact_lock est transactionnel et ne survit pas à la fin
-- d'un RPC PostgREST (une transaction = un appel). Deux workers Supabase
-- concurrents peuvent donc acquérir le même advisory lock successivement et
-- traiter la même réservation en double. Les verrous de session sont
-- incompatibles avec le pool de connexions mutualisé.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.civrat_ticket_reservations') IS NULL THEN
    RAISE EXCEPTION 'civrat_ticket_reservations absent : appliquer 04 d''abord';
  END IF;
END $$;

ALTER TABLE public.civrat_ticket_reservations
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS lock_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS civrat_ticket_reservations_lease_idx
  ON public.civrat_ticket_reservations (lock_expires_at) WHERE lock_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.civrat_ticket_lease_reservation(p_request_id uuid, p_owner_id text, p_ttl_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated boolean := false;
BEGIN
  IF p_request_id IS NULL OR p_owner_id IS NULL OR char_length(btrim(p_owner_id)) = 0 THEN
    RAISE EXCEPTION 'invalid lease params' USING ERRCODE = '22023';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 10 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid ttl' USING ERRCODE = '22023';
  END IF;
  UPDATE public.civrat_ticket_reservations
  SET locked_by = p_owner_id,
      locked_at = now(),
      lock_expires_at = now() + make_interval(secs => p_ttl_seconds)
  WHERE request_id = p_request_id
    AND state IN ('reserved','external_pending','channel_known','cleanup_pending')
    AND (locked_by IS NULL OR lock_expires_at IS NULL OR lock_expires_at < now() OR locked_by = p_owner_id)
  RETURNING true INTO v_updated;
  RETURN COALESCE(v_updated, false);
END;
$$;
REVOKE ALL ON FUNCTION public.civrat_ticket_lease_reservation(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_lease_reservation(uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.civrat_ticket_release_lease(p_request_id uuid, p_owner_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated boolean := false;
BEGIN
  UPDATE public.civrat_ticket_reservations
  SET locked_by = NULL, locked_at = NULL, lock_expires_at = NULL
  WHERE request_id = p_request_id AND locked_by = p_owner_id
  RETURNING true INTO v_updated;
  RETURN COALESCE(v_updated, false);
END;
$$;
REVOKE ALL ON FUNCTION public.civrat_ticket_release_lease(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_release_lease(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.civrat_ticket_renew_lease(p_request_id uuid, p_owner_id text, p_ttl_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated boolean := false;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 10 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'invalid ttl' USING ERRCODE = '22023';
  END IF;
  UPDATE public.civrat_ticket_reservations
  SET lock_expires_at = now() + make_interval(secs => p_ttl_seconds)
  WHERE request_id = p_request_id AND locked_by = p_owner_id
  RETURNING true INTO v_updated;
  RETURN COALESCE(v_updated, false);
END;
$$;
REVOKE ALL ON FUNCTION public.civrat_ticket_renew_lease(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.civrat_ticket_renew_lease(uuid, text, integer) TO service_role;

COMMIT;
