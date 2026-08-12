# Phase 10.1 — Migration `guild_configs` : colonnes Ticket Premium

> Préparée le 2026-08-12 (Phase 10.1 — fondations). **Non exécutée dans cette phase.**
> Le dépôt ignore les fichiers `*.sql` ; la migration est donc documentée ici, prête
> à copier-coller dans l'éditeur SQL Supabase.

## Contexte

Le bot stocke la configuration de chaque guilde dans la table Supabase
`guild_configs`, au format **colonnes** (`select *` / upsert par clés, cf.
`src/services/guildConfig.js`). PostgREST rejette l'écriture d'une colonne
inexistante : cette migration **doit être exécutée avant la phase 10.2**, première
phase qui écrira ces clés (personnalisation du panneau Premium).

Les 8 colonnes correspondent exactement aux 8 clés déclarées dans
`src/modules/tickets/configuration/ticketPremiumConstants.js`.

## Garanties (charte produit CIVRAT)

- Toutes les colonnes sont **NULLABLE, sans valeur par défaut** : les guildes
  existantes restent à `NULL` = comportement Free strictement inchangé.
- Ces colonnes ne sont **jamais lues par le parcours Free** : seul
  `TicketPremiumConfigResolver` les expose, et uniquement si l'entitlement
  `TICKET_PREMIUM` (table `guild_entitlements`, `feature_key = 'TICKET_PREMIUM'`,
  `status = 'active'`, `ends_at` nul ou futur) est actif pour la guilde.
- La **révocation** de l'entitlement fait instantanément revenir au Free sans purge
  des colonnes (réactivation possible sans re-saisie).
- `null` = « reset » d'une personnalisation → retour au default Free.

## Migration (idempotente)

```sql
alter table public.guild_configs
  add column if not exists ticket_panel_title text,
  add column if not exists ticket_panel_description text,
  add column if not exists ticket_panel_color text,
  add column if not exists ticket_panel_image_url text,
  add column if not exists ticket_create_button_label text,
  add column if not exists ticket_name_format text,
  add column if not exists ticket_welcome_message text,
  add column if not exists ticket_transcript_channel_id text;

comment on column public.guild_configs.ticket_panel_title is
  'Premium Tickets — titre personnalisé du panneau (<= 256, limite embed Discord). null = texte i18n Free.';
comment on column public.guild_configs.ticket_panel_description is
  'Premium Tickets — description personnalisée du panneau (<= 2000). null = texte i18n Free.';
comment on column public.guild_configs.ticket_panel_color is
  'Premium Tickets — couleur embed du panneau, #rrggbb. null = rendu Free sans couleur.';
comment on column public.guild_configs.ticket_panel_image_url is
  'Premium Tickets — URL https d''image du panneau (<= 1024). null = aucune image.';
comment on column public.guild_configs.ticket_create_button_label is
  'Premium Tickets — label du bouton de création (<= 80). null = label i18n Free.';
comment on column public.guild_configs.ticket_name_format is
  'Premium Tickets — format de nommage des salons (<= 90, placeholders {number} {username} {userid}). null = ticket-<userId>.';
comment on column public.guild_configs.ticket_welcome_message is
  'Premium Tickets — message d''accueil personnalisé du ticket (<= 2000). null = message i18n Free.';
comment on column public.guild_configs.ticket_transcript_channel_id is
  'Premium Tickets — salon de destination des transcripts (snowflake 15-22 chiffres). null = pas d''envoi configuré.';
```

## Rollback (manuel, uniquement si abandon complet de la fonctionnalité)

```sql
alter table public.guild_configs
  drop column if exists ticket_panel_title,
  drop column if exists ticket_panel_description,
  drop column if exists ticket_panel_color,
  drop column if exists ticket_panel_image_url,
  drop column if exists ticket_create_button_label,
  drop column if exists ticket_name_format,
  drop column if exists ticket_welcome_message,
  drop column if exists ticket_transcript_channel_id;
```

## Rappels d'exécution

- Exécution **manuelle** via l'éditeur SQL Supabase (aucun runner de migrations
  dans le dépôt à ce jour).
- Script **idempotent** (`IF NOT EXISTS`) : rejouable sans risque.
- Aucune ligne existante n'est modifiée (colonnes ajoutées à `NULL`).
- Prérequis bloquant pour 10.2 : tant que ces colonnes n'existent pas, toute
  écriture d'une clé Premium échouera côté PostgREST.
