# CIVRAT Tickets Free — Réconciliation des réservations (04)

**Objet** : traitement des réservations abandonnées (`reserved`, `external_pending`, `channel_known`, `cleanup_pending`) distinct des compensations immédiates (rollback synchrone après échec Discord/Supabase).

## Principes

- **Compensations immédiates** : dans le même handler (`createTicket`, `createCategoryTicket`, `createPendingTicketChannel` throws, `snapshot`/`activation` throws), le service appelle `rollbackTicketChannel` (suppression Discord) puis `cancelTicketSlot` (passage `cancelled`) si le salon a été supprimé, sinon `signalDivergence` et conservation en `external_pending`/`channel_known`.
- **Réconciliation persistée** : job séparé (cron toutes les 15 min, hors handler), qui liste `civrat_ticket_reservations_pending_idx` (`state IN ('reserved','external_pending','channel_known','cleanup_pending') AND created_at < now() - interval '1 hour'`), vérifie Discord (`GET guild.channels[reservation.channel_id]`) et Supabase (`tickets.channel_id`), puis :
  - si salon inexistant ET ticket inexistant → `civrat_ticket_cancel_reservation` → `cancelled` ;
  - si salon existe mais ticket `deleted`/`closed` → idem ;
  - si incertain (API Discord indisponible) → laisser `external_pending`, retry prochain run ;
  - jamais libérer sans vérif Discord+Supabase.

## Table

Aucune table supplémentaire : on réutilise `civrat_ticket_reservations` + index `pending_idx`. Un journal `civrat_ticket_reservation_reconciliation_runs` (optionnel) peut tracer `run_at`, `expired_count`.

```sql
CREATE TABLE IF NOT EXISTS public.civrat_ticket_reservation_reconciliation_runs (
  run_at timestamptz PRIMARY KEY DEFAULT now(),
  expired_count int NOT NULL DEFAULT 0,
  checked_count int NOT NULL DEFAULT 0
);
```

## RPC

Aucun RPC supplémentaire : `listUnresolved` (JS) ou `SELECT * FROM civrat_ticket_reservations WHERE state IN (...)` + `civrat_ticket_cancel_reservation` suffisent. Ne pas exposer `expired` automatiquement : la mise en `expired` est manuelle après vérif.

## Procédure

1. Précontrôle : `SELECT count(*) FROM civrat_ticket_reservations WHERE state IN ('reserved','external_pending','channel_known')` doit être 0 avant migration 05.
2. Après 1h sans activité, le job expire les réservations orphelines.
3. Aucune bascule d'index `idx_tickets_open_unique` avant que le job n'ait tourné au moins une fois en prod.

> **Non validé PG** : la requête et le job n'ont pas été exécutés sur PostgreSQL isolé.
