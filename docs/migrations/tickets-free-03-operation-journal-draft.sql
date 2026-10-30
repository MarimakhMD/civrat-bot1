-- CIVRAT Tickets Free — 03 OPERATION JOURNAL — DRAFT
BEGIN;
CREATE TABLE public.civrat_ticket_operations (
  operation_id uuid PRIMARY KEY,
  guild_id text NOT NULL,
  scope text NOT NULL
);
CREATE INDEX civrat_ticket_operations_unresolved_scope_idx ON public.civrat_ticket_operations (scope) WHERE scope IS NOT NULL;
CREATE FUNCTION public.civrat_ticket_operation_begin(
  p_operation_id uuid, p_guild_id text, p_scope text, p_actor_id text, p_target_id text, p_action text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN END; $$;
CREATE FUNCTION public.civrat_ticket_operation_transition(
  p_guild_id text, p_operation_id uuid, p_expected_revision bigint, p_state text, p_observation text, p_actor_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN END; $$;
CREATE FUNCTION public.civrat_ticket_participant_confirm(
  p_guild_id text, p_operation_id uuid, p_expected_revision bigint, p_actor_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN END; $$;
CREATE FUNCTION public.civrat_ticket_creation_confirm(
  p_guild_id text, p_operation_id uuid, p_expected_revision bigint, p_actor_id text, p_channel_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ BEGIN END; $$;
CREATE FUNCTION public.civrat_ticket_operations_list_unresolved(
  p_guild_id text, p_limit int, p_after_created_at timestamptz, p_after_operation_id uuid
) RETURNS TABLE(operation_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT operation_id FROM public.civrat_ticket_operations LIMIT 1; $$;
COMMIT;
