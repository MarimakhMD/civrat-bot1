-- CIVRAT Tickets Free — 02 HISTORICAL ATTESTATION — DRAFT
-- RECONSTRUCTION : ce fichier a été reconstruit, pas restauré
BEGIN;
-- Attestation historique
CREATE TABLE public.civrat_ticket_historical_attestations (
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);
CREATE FUNCTION public.civrat_ticket_historical_attest(
  p_guild_id text, p_channel_id text, p_actor_id text, p_request_id uuid, p_role_ids text[], p_evidence text,
  p_expected_user_id text, p_expected_status text, p_expected_closed boolean, p_expected_panel_id bigint, p_expected_created_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN END; $$;
CREATE FUNCTION public.civrat_ticket_historical_refusal(
  p_guild_id text, p_channel_id text, p_actor_id text, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN END; $$;
COMMIT;
