-- CIVRAT Tickets Free — 05 TRANSITION INDEX HISTORIQUE — PROPOSITION NON EXÉCUTABLE
-- Ce fichier NE DOIT PAS être exécuté tel quel. Il documente la bascule nécessaire
-- pour autoriser plusieurs tickets ouverts après que 04 a prouvé son atomicité.
-- L'index historique idx_tickets_open_unique DOIT rester jusqu'à GO explicite.

-- PRÉCONTRÔLES (lecture seule, à exécuter manuellement) :
-- 1. Vérifier qu'aucun doublon n'existe déjà au-delà de la future limite :
--    SELECT guild_id, user_id, count(*) FROM public.tickets
--      WHERE status IN ('open','claimed') GROUP BY guild_id, user_id HAVING count(*) > 1;
--    → Doit être vide si global_limit=1, ou ≤ futur max sinon. En cas de doublon,
--    ne pas basculer : réconcilier manuellement (fermer/supprimer les plus anciens).
-- 2. Vérifier que TOUS les writers passent par les RPC 04 (réservations) :
--    SELECT tablename, policyname, roles, cmd FROM pg_policies
--      WHERE tablename='tickets';
--    SELECT grantee, privilege_type FROM information_schema.role_table_grants
--      WHERE table_name='tickets';
--    → Aucun rôle applicatif ne doit avoir INSERT direct sans RPC ; seul service_role
--    via RPC doit écrire.
-- 3. Vérifier que le code déployé contient bien TicketReservationRepository et
--    que 04 a été validé PG multi-instances (2 bots, double-clic, réouverture).
-- 4. Sauvegarder base et tester restauration.

BEGIN;
-- Étape 1 : verrouiller et retirer les droits d'écriture directe (à valider) :
-- REVOKE INSERT, UPDATE ON public.tickets FROM PUBLIC, anon, authenticated;
-- (Conserver service_role pour RPC SECURITY DEFINER uniquement)

-- Étape 2 : supprimer l'index historique SEULEMENT après 1-4 ci-dessus :
-- DROP INDEX IF EXISTS public.idx_tickets_open_unique;
-- Note : le nom exact de l'index doit être vérifié via pg_indexes (supposé idx_tickets_open_unique).

-- Étape 3 : optionnel — ajouter contrainte de garde via trigger qui appelle
-- civrat_ticket_reserve_open pour tout INSERT direct (défense en profondeur).
-- Aucun trigger n'est fourni ici ; la RLS + revoke est la protection principale.

-- RETOUR ARRIÈRE :
-- Si anomalie après bascule : rétablir l'index immédiatement :
-- CREATE UNIQUE INDEX idx_tickets_open_unique ON public.tickets (guild_id, user_id) WHERE status IN ('open','claimed');
-- Puis vérifier que count(*) par (guild_id,user_id) ≤1, sinon réconcilier.
-- Restaurer les grants si nécessaire. Aucune suppression de données.

-- Ne pas COMMIT sans GO ; ce fichier reste à l'état de proposition.
ROLLBACK;
