# Phase 10.4 — Compteur atomique de tickets (`guild_configs.ticket_counter`)

> Préparée le 2026-08-12 (Phase 10.4). **Non exécutée dans cette phase.**
> Le dépôt ignore les fichiers `*.sql` ; la migration est donc documentée ici,
> prête à copier-coller dans l'éditeur SQL Supabase.

## Pourquoi une fonction RPC (et pas un SELECT + UPDATE)

Le nommage Premium `ticket-{number}` exige une séquence **sans collision en
créations simultanées**. Un `SELECT … + 1` suivi d'un `UPDATE` (approche du
legacy `nextTicketNumber`, COUNT(*)+1) n'est **pas atomique** : deux créations
concurrentes peuvent lire la même valeur et produire le même numéro.

La solution retenue : une instruction **unique** `INSERT … ON CONFLICT DO
UPDATE … RETURNING`, qui prend un verrou de ligne sur `guild_configs` ⇒
atomicité garantie par PostgreSQL, y compris en concurrence. PostgREST ne peut
pas exprimer cet incrément via l'API REST standard ⇒ fonction `plpgsql`
appelée en RPC (`supabase.rpc("increment_ticket_counter", { p_guild_id })`).

## Garanties du design

- **Atomique** : verrou de ligne pendant l'incrément — aucune collision en
  simultané.
- **Indépendant par guilde** : une ligne `guild_configs` par guilde, compteur
  propre à chacune.
- **Persistant** : valeur stockée en base ⇒ survit au redémarrage du bot.
- **Fail-closed applicatif** : si la fonction est absente ou en erreur (ex.
  migration non exécutée), `TicketService` retombe sur le nom Free
  `ticket-<userId>` — la création de ticket n'est jamais bloquée par
  l'infra Premium.
- **Trous de séquence assumés et documentés** : le numéro est réservé *avant*
  l'appel Discord `channels.create` (le nom naît avec le salon). Si la création
  échoue ensuite, le numéro est consommé : `ticket-001`, `ticket-003`… est
  possible. Aucune compensation (décrément) n'est sûre en concurrence ;
  c'est le comportement standard des bots de tickets.

## Migration (idempotente)

```sql
-- 1. Colonne compteur (une ligne par guilde ; NULL des lignes existantes =>
--    lecture 0 via COALESCE côté fonction).
alter table public.guild_configs
  add column if not exists ticket_counter integer not null default 0;

-- 2. Fonction atomique d'incrément, appelée en RPC par le bot.
create or replace function public.increment_ticket_counter(p_guild_id text)
returns integer
language plpgsql
as $$
declare
  next_value integer;
begin
  insert into public.guild_configs (guild_id, ticket_counter)
  values (p_guild_id, 1)
  on conflict (guild_id)
  do update set ticket_counter = guild_configs.ticket_counter + 1
  returning ticket_counter into next_value;
  return next_value;
end;
$$;
```

## Ordre d'exécution en production

1. Exécuter la migration 10.1 (8 colonnes Premium, doc
   `phase-10-1-ticket-premium-guild-configs.md`).
2. Exécuter la migration ci-dessus (colonne + fonction RPC).
3. Donner l'entitlement : ligne `guild_entitlements`
   (`feature_key = 'TICKET_PREMIUM'`, `status = 'active'`).
4. Tant que 1-3 ne sont pas faits : fail-closed partout, Free inchangé.

## Addendum — nommage Free atomique (P15)

Le nommage Free est désormais atomique lui aussi : les salons Free sont
nommés `ticket-001`, `ticket-002`… (format `ticket-{number}`, paddé 3) via
le **même compteur unique** (`guild_configs.ticket_counter` + RPC
`increment_ticket_counter`) que le placeholder Premium `{number}`. Un seul
canal d'incrément par guilde — aucun `COUNT(*) + 1` nulle part.

- Free et Premium partagent la séquence : un ticket Free suivi d'un Premium
  `vip-{number}` donnent `ticket-001` puis `vip-002`.
- Compteur indisponible (RPC absente, Supabase non configuré, erreur) :
  comportement fail-closed conservé — le transport retombe sur
  `ticket-<userId>` et la création n'est jamais bloquée.
- La convergence P15 a retiré le moteur tickets legacy de
  `src/events/interactionCreate.js` (dont sa numérotation `COUNT(*) + 1`
  non atomique, sujette aux collisions en concurrence) : l'unicité des noms
  ne dépend plus que du compteur RPC.
- Tests de non-régression :
  `src/modules/tickets/tests/TicketPremiumNaming.test.js` (séquences Free,
  compteur partagé Free/Premium, simultanéité sans collision, fail-closed)
  et `test/runtime/ticket-legacy-convergence.test.js` (dispatcher sans
  moteur legacy, welcome à 5 contrôles, notices post-action).

## Rollback (manuel, uniquement si abandon complet)

```sql
drop function if exists public.increment_ticket_counter(text);
alter table public.guild_configs drop column if exists ticket_counter;
```
