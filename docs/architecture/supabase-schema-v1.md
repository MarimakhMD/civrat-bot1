# Schéma Supabase v1 — documentation (P14)

> **Statut : documentation uniquement. Aucune migration n'a été exécutée par
> ce dépôt.** Ce fichier a été reconstitué à partir du code de HEAD
> `5ff595c` (audit P14 reconstruit). Il décrit **uniquement les tables et
> colonnes réellement consommées par le code** (repositories, services,
> événements legacy) — rien d'autre n'y figure.
>
> Le bot se connecte via `src/config/database.js` : clé préférée
> `SUPABASE_SERVICE_ROLE_KEY`, fallback `SUPABASE_ANON_KEY` (le client
> `supabase` est construit avec `serviceRoleKey || anonKey`).

## Conventions de lecture

- **Opérations** prouvées par lecture directe du code (`from(...)`, `.rpc(...)`).
- **Types** déduits du code (JS côté repository) ; postgreSQL SQL exact
  reconstruit. Tout type non déductible est marqué **« à confirmer »**.
- **Contraintes** : une contrainte n'est affirmée que si un consommateur la
  suppose (ex. `maybeSingle()`, gestion du code erreur `23505`) ; sinon elle
  est marquée « à confirmer ».
- Les DDL ci-dessous sont **documentaires** (non exécutés). `*.sql` est
  gitignoré dans ce dépôt : le SQL vit dans les docs d'architecture.

---

## 1. `guild_configs` — configuration par guilde (table cœur)

**Consommateurs :** `src/services/guildConfig.js` (`getGuildConfig`,
`updateGuildConfig`), tous les modules via `*ConfigService` / resolver.
**Opérations :** `SELECT *` (`eq guild_id`, `maybeSingle`), `UPSERT`
(`onConflict: "guild_id"`). Aucun DELETE.

### Clé primaire

| Contrainte | Preuve |
|---|---|
| `PRIMARY KEY (guild_id)` | UPSERT `onConflict: "guild_id"` + lecture `maybeSingle()` par `guild_id`. |

### Colonnes réellement consommées

Union des clés lues/écrites dans `src/services/guildConfig.js`, les
`*Constants.js` des modules et les événements legacy. Toutes sont optionnelles
côté code (le code applique des défauts applicatifs quand la clé est absente).

| Colonne | Type déduit | Consommateur principal |
|---|---|---|
| `guild_id` | `text` (snowflake Discord en string partout) | toutes lectures |
| `language` | `text` (`"fr"`/`"en"`, `isSupportedLocale`) | guild-settings |
| `logs_enabled` | `boolean` | logs |
| `log_channel_update_channel_id` | `text` | logs |
| `log_member_join_channel_id` | `text` | logs + events legacy |
| `log_member_leave_channel_id` | `text` | logs |
| `log_message_delete_channel_id` | `text` | logs |
| `log_message_edit_channel_id` | `text` | logs |
| `log_moderation_channel_id` | `text` | logs |
| `log_role_update_channel_id` | `text` | logs |
| `invitations_enabled` | `boolean` | invites, logs/events |
| `invitations_log_channel_id` | `text` | invites |
| `welcome_enabled` | `boolean` | welcome-goodbye |
| `welcome_channel_id` | `text` | welcome-goodbye |
| `welcome_message` | `text` | welcome-goodbye |
| `welcome_embed_enabled` | `boolean` | welcome-goodbye |
| `welcome_embed_color` | `text` | welcome-goodbye |
| `welcome_dm_enabled` | `boolean` | welcome-goodbye |
| `welcome_dm_message` | `text` | welcome-goodbye |
| `welcome_template_id` | `text` (`à confirmer` : consommé comme identifiant de template) | welcome-image |
| `goodbye_enabled` | `boolean` | welcome-goodbye |
| `goodbye_channel_id` | `text` | welcome-goodbye |
| `goodbye_message` | `text` | welcome-goodbye |
| `goodbye_embed_enabled` | `boolean` | welcome-goodbye |
| `goodbye_embed_color` | `text` | welcome-goodbye |
| `tickets_enabled` | `boolean` | tickets |
| `ticket_category_id` | `text` | tickets |
| `ticket_support_role_id` | `text` | tickets |
| `ticket_log_channel_id` | `text` | tickets (transcript Free, legacy) |
| `ticket_panel_title` | `text` | tickets (Premium 10.2) |
| `ticket_panel_description` | `text` | tickets (Premium 10.2) |
| `ticket_panel_color` | `text` | tickets (Premium 10.2) |
| `ticket_panel_image_url` | `text` | tickets (Premium 10.2) |
| `ticket_create_button_label` | `text` | tickets (Premium 10.2) |
| `ticket_welcome_message` | `text` | tickets (Premium 10.3) |
| `ticket_transcript_channel_id` | `text` | tickets (Premium 10.3) |
| `ticket_name_format` | `text` | tickets (Premium 10.4) |
| `ticket_counter` | `integer` (incrémenté par RPC, retour `integer`) | RPC 10.4 |
| `suggestion_enabled` | `boolean` | suggestions |
| `suggestion_channel_id` | `text` | suggestions |
| `suggestion_approval_required` | `boolean` | suggestions |
| `giveaway_enabled` | `boolean` | giveaways |
| `giveaway_channel_id` | `text` | giveaways |
| `sticker_limit` | `integer` (`à confirmer` : lu tel quel) | sticker |
| `xp_enabled` | `boolean` | xp |
| `xp_channel_id` | `text` | xp |
| `xp_rate` | `numeric`/`integer` (`à confirmer` : multiplicateur JS) | xp |
| `analytics_enabled` | `boolean` | analytics |
| `captcha_enabled` | `boolean` | captcha |
| `captcha_channel_id` | `text` | captcha |
| `captcha_role_id` | `text` | captcha |
| `autorole_enabled` | `boolean` | autorole |
| `autorole_member_role_id` | `text` | autorole |
| `autorole_bot_role_id` | `text` | autorole |
| `tempvoice_enabled` | `boolean` | tempvoice |
| `tempvoice_lobby_channel_id` | `text` | tempvoice |
| `tempvoice_category_id` | `text` | tempvoice |
| `automod_enabled` | `boolean` | automod |
| `automod_anti_links` | `boolean` | automod |
| `automod_anti_invites` | `boolean` | automod |
| `automod_anti_caps` | `boolean` | automod |
| `automod_caps_threshold` | `integer` | automod |
| `automod_anti_spam` | `boolean` | automod |
| `automod_anti_mention_spam` | `boolean` | automod |
| `automod_mention_threshold` | `integer` | automod |
| `automod_anti_emoji_spam` | `boolean` | automod |
| `automod_emoji_threshold` | `integer` | automod |
| `automod_bad_words` | `text`/`jsonb` (`à confirmer` : liste en code) | automod |
| `automod_delete_message` | `boolean` | automod |
| `automod_punishment` | `text` (ex. `"timeout"`, `"warn"`, `"none"`) | automod |
| `automod_timeout_minutes` | `integer` | automod |
| `security_enabled` | `boolean` | security |
| `security_anti_raid` | `boolean` | security |
| `security_anti_nuke` | `boolean` | security |
| `security_anti_bot` | `boolean` | security |
| `security_whitelist` | `text[]`/`jsonb` (`à confirmer` : liste en code) | security |
| `security_log_channel_id` | `text` | security |

### DDL documentaire (non exécutée)

```sql
create table if not exists public.guild_configs (
  guild_id text primary key,
  -- booléens (défauts gérés côté applicatif ; default null en base acceptable)
  language text,
  logs_enabled boolean,
  log_channel_update_channel_id text,
  log_member_join_channel_id text,
  log_member_leave_channel_id text,
  log_message_delete_channel_id text,
  log_message_edit_channel_id text,
  log_moderation_channel_id text,
  log_role_update_channel_id text,
  invitations_enabled boolean,
  invitations_log_channel_id text,
  welcome_enabled boolean,
  welcome_channel_id text,
  welcome_message text,
  welcome_embed_enabled boolean,
  welcome_embed_color text,
  welcome_dm_enabled boolean,
  welcome_dm_message text,
  welcome_template_id text,
  goodbye_enabled boolean,
  goodbye_channel_id text,
  goodbye_message text,
  goodbye_embed_enabled boolean,
  goodbye_embed_color text,
  tickets_enabled boolean,
  ticket_category_id text,
  ticket_support_role_id text,
  ticket_log_channel_id text,
  ticket_panel_title text,
  ticket_panel_description text,
  ticket_panel_color text,
  ticket_panel_image_url text,
  ticket_create_button_label text,
  ticket_welcome_message text,
  ticket_transcript_channel_id text,
  ticket_name_format text,
  ticket_counter integer not null default 0,
  suggestion_enabled boolean,
  suggestion_channel_id text,
  suggestion_approval_required boolean,
  giveaway_enabled boolean,
  giveaway_channel_id text,
  sticker_limit integer,
  xp_enabled boolean,
  xp_channel_id text,
  xp_rate integer,
  analytics_enabled boolean,
  captcha_enabled boolean,
  captcha_channel_id text,
  captcha_role_id text,
  autorole_enabled boolean,
  autorole_member_role_id text,
  autorole_bot_role_id text,
  tempvoice_enabled boolean,
  tempvoice_lobby_channel_id text,
  tempvoice_category_id text,
  automod_enabled boolean,
  automod_anti_links boolean,
  automod_anti_invites boolean,
  automod_anti_caps boolean,
  automod_caps_threshold integer,
  automod_anti_spam boolean,
  automod_anti_mention_spam boolean,
  automod_mention_threshold integer,
  automod_anti_emoji_spam boolean,
  automod_emoji_threshold integer,
  automod_bad_words jsonb,            -- type à confirmer (text[] possible)
  automod_delete_message boolean,
  automod_punishment text,
  automod_timeout_minutes integer,
  security_enabled boolean,
  security_anti_raid boolean,
  security_anti_nuke boolean,
  security_anti_bot boolean,
  security_whitelist jsonb,           -- type à confirmer (text[] possible)
  security_log_channel_id text
);
```

> ⚠️ **`create table if not exists` n'ajoute pas les colonnes manquantes** à
> une table existante : si `guild_configs` existe déjà, il faut un
> `alter table ... add column if not exists` par colonne absente.

**Si une colonne manque :** l'UPSERT échoue (`PERSISTENCE` côté app) pour
toute écriture de cette clé ; les lectures la voient `undefined` → défauts
applicatifs. Aucun crash au démarrage.

---

## 2. `guild_entitlements` — capacités Premium par guilde

**Consommateur :** `src/adapters/supabase/SupabaseEntitlementRepository.js`
(`findFeature`), lu par `EntitlementService.hasFeature`.
**Opérations :** `SELECT *` (`eq guild_id`, `eq feature_key`, `maybeSingle`).
**Aucune écriture dans le code** (les lignes sont insérées manuellement par
le propriétaire).

### Colonnes consommées

| Colonne | Type déduit | Preuve |
|---|---|---|
| `guild_id` | `text` | filtre `.eq("guild_id", …)` |
| `feature_key` | `text` (`"TICKET_PREMIUM"`, `"WELCOME_IMAGE"`, cf. `entitlementFeatures.js`) | filtre `.eq("feature_key", …)` |
| `status` | `text` (`"active"` attendu ; autres valeurs = inactif) | `record.status === "active"` |
| `ends_at` | `timestamptz` **nullable** | `new Date(record.ends_at) > new Date()` |

### Contraintes

| Contrainte | Statut | Justification |
|---|---|---|
| `UNIQUE (guild_id, feature_key)` | **justifiée** | `maybeSingle()` lève une erreur si plusieurs lignes matchent ; la sémantique « plus récente/active » exige une ligne unique par couple. |
| PK technique `id` | à confirmer (toute PK convient au code) |

### DDL documentaire (non exécutée)

```sql
create table if not exists public.guild_entitlements (
  guild_id text not null,
  feature_key text not null,
  status text not null,
  ends_at timestamptz,
  unique (guild_id, feature_key)
);
```

**Si la table manque :** chaque `findFeature` throw → intercepté par les
resolvers Premium (fail-closed) → tout le bot reste en mode Free. Aucun crash.

---

## 3. `tickets` — registre des tickets (deux écrivains)

**Consommateurs :**
`src/modules/tickets/persistence/SupabaseTicketRepository.js` (moteur V1) **et**
`src/events/interactionCreate.js` (moteur legacy, lignes 216-234) — **les deux
écrivent dans la même table** (cohabitation à assumer tant que le legacy n'est
pas retiré).

**Opérations :** SELECT (`maybeSingle` par `guild_id+user_id+status IN`,
`maybeSingle` par `channel_id`), INSERT, UPDATE (`eq channel_id`), et legacy
`SELECT id` avec `count: "exact", head: true`. Aucun DELETE.

### Colonnes consommées

| Colonne | Type déduit | Preuve |
|---|---|---|
| `id` | PK (`bigint`/`uuid` — à confirmer ; le legacy fait seulement `count`) | `select("id", { count:"exact" })` |
| `guild_id` | `text` | filtres + inserts |
| `user_id` | `text` (créateur) | filtres + inserts |
| `channel_id` | `text` | filtres `maybeSingle`, `update ... eq channel_id` |
| `category` | `text` (`"support"` côté V1 ; valeur libre côté legacy `interaction.values[0]`) | inserts |
| `status` | `text` (`"open"`, `"claimed"`, `"closed"`, `"deleted"`) | filtres `.in(...)`, updates |
| `closed` | `boolean` | inserts/updates |
| `closed_at` | `timestamptz` nullable | `new Date().toISOString()` / `null` |

### Contraintes

| Contrainte | Statut | Justification |
|---|---|---|
| `UNIQUE (channel_id)` | **justifiée** | `findByChannel` en `maybeSingle()` + `update ... eq channel_id` supposent une ligne unique par salon. |
| PK sur `id` | à confirmer (présence prouvée par le legacy count, type libre) |
| CHECK sur `status` | à confirmer (le code accepte 4 valeurs, aucune contrainte exigée) |

### DDL documentaire (non exécutée)

```sql
create table if not exists public.tickets (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  channel_id text not null unique,
  category text not null,
  status text not null,
  closed boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
```

> `created_at` n'est **pas lu** par le code ; colonne horodatage recommandée
> (toute valeur default `now()` convient).

**Si la table manque :** moteur V1 → `TICKET_CONFIG_INCOMPLETE`/erreurs
`PERSISTENCE_ERROR` ; legacy → `logger.error` et fallback nommage. Aucun crash
processus.

---

## 4. `suggestions` — suggestions des membres

**Consommateur :** `src/modules/suggestions/persistence/SupabaseSuggestionRepository.js`.
**Opérations :** INSERT (record complet), SELECT (`maybeSingle` par `id` et
par `message_id`), UPDATE (`status`, `up_votes`, `down_votes` par `id`),
DELETE (par `id`).

### Colonnes consommées

| Colonne | Type déduit | Preuve |
|---|---|---|
| `id` | PK (`bigint`/`uuid` — à confirmer ; utilisée dans customIds, donc **représentable en string courte de préférence**) | filtres, updates |
| `guild_id` | `text` | insert |
| `channel_id` | `text` | insert |
| `message_id` | `text` nullable | insert (`null` initial), lookup `maybeSingle` |
| `author_id` | `text` | insert |
| `content` | `text` | insert |
| `status` | `text` (`"pending"`, `"approved"`, `"rejected"`) | insert/update |
| `up_votes` | `integer` not null default 0 | insert/update |
| `down_votes` | `integer` not null default 0 | insert/update |

### Contraintes

| Contrainte | Statut | Justification |
|---|---|---|
| PK sur `id` | **justifiée** (lookup/update par `id`) |
| `UNIQUE (message_id)` | à confirmer — `findByMessageId(...).maybeSingle()` **suppose** l'unicité pour les votes par bouton |
| FK vers `guild_configs` | non requise (aucun join) |

### DDL documentaire (non exécutée)

```sql
create table if not exists public.suggestions (
  id bigint generated always as identity primary key,
  guild_id text not null,
  channel_id text not null,
  message_id text,
  author_id text not null,
  content text not null,
  status text not null default 'pending',
  up_votes integer not null default 0,
  down_votes integer not null default 0,
  created_at timestamptz not null default now()
);
```

**Si la table manque :** `/suggest` et les votes échouent avec erreur
structurée côté module ; le reste du bot est intact.

---

## 5. `suggestion_votes` — votes des suggestions

**Consommateur :** même repository (méthodes `vote`, `delete`).
**Opérations :** INSERT, SELECT (`maybeSingle` par couple
`suggestion_id+user_id`), UPDATE (`value` par couple), DELETE (par
`suggestion_id`, nettoyage après suppression de la suggestion).

### Colonnes consommées

| Colonne | Type déduit | Preuve |
|---|---|---|
| `suggestion_id` | même type que `suggestions.id` | filtres/insert |
| `user_id` | `text` | filtres/insert |
| `value` | `smallint` (`1` / `-1`) | comparaisons `value === 1`, `=== -1` |

### Contraintes

| Contrainte | Statut | Justification |
|---|---|---|
| `UNIQUE (suggestion_id, user_id)` | **justifiée** | le flux `vote()` est select-then-insert/update sur le couple ; sans unicité, un membre pourrait voter plusieurs fois (double comptage). |
| FK `suggestion_id → suggestions.id` | **justifiée** (`on delete cascade` recommandé) | le repository supprime les votes par `suggestion_id` après avoir supprimé la suggestion → la cascade rend ce nettoyage automatique ; sans FK la ligne orpheline reste tolérée mais sale. |
| PK technique | à confirmer (non lue) |

### DDL documentaire (non exécutée)

```sql
create table if not exists public.suggestion_votes (
  id bigint generated always as identity primary key,
  suggestion_id bigint not null references public.suggestions(id) on delete cascade,
  user_id text not null,
  value smallint not null check (value in (1, -1)),
  created_at timestamptz not null default now(),
  unique (suggestion_id, user_id)
);
```

---

## 6. `giveaways` — concours

**Consommateur :** `src/modules/giveaways/persistence/SupabaseGiveawayRepository.js`.
**Opérations :** INSERT (record complet), SELECT (`maybeSingle` par `id`,
`maybeSingle` par `message_id`), UPDATE (`status: "closed"` par `id`).
Aucun DELETE.

### Colonnes consommées

| Colonne | Type déduit | Preuve |
|---|---|---|
| `id` | PK (passée en customId string → `bigint`/type compact recommandé) | filtres/updates |
| `guild_id` | `text` | insert |
| `channel_id` | `text` | insert |
| `prize` | `text` | insert |
| `winners_count` | `integer` | insert, lu par `draw()` (`giveaway.winners_count`) |
| `ends_at` | `timestamptz` | `new Date(...).toISOString()` inséré |
| `message_id` | `text` nullable | insert (`null` initial), lookup `maybeSingle` |
| `status` | `text` (`"open"`, `"closed"`) | insert/update |

### Contraintes

| Contrainte | Statut | Justification |
|---|---|---|
| PK sur `id` | **justifiée** (lookup/update par `id`) |
| `UNIQUE (message_id)` | à confirmer — `findByMessageId(...).maybeSingle()` suppose l'unicité |

### DDL documentaire (non exécutée)

```sql
create table if not exists public.giveaways (
  id bigint generated always as identity primary key,
  guild_id text not null,
  channel_id text not null,
  prize text not null,
  winners_count integer not null default 1,
  ends_at timestamptz not null,
  message_id text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
```

---

## 7. `giveaway_entries` — participations

**Consommateur :** même repository (`join`, `listEntries`).
**Opérations :** INSERT, SELECT (`user_id` par `giveaway_id`). Aucun
UPDATE/DELETE.

### Colonnes consommées

| Colonne | Type déduit | Preuve |
|---|---|---|
| `giveaway_id` | même type que `giveaways.id` | insert/filtre |
| `user_id` | `text` | insert/select |

### Contraintes

| Contrainte | Statut | Justification |
|---|---|---|
| `UNIQUE (giveaway_id, user_id)` | **PROUVÉE par le code** | `join()` intercepte l'erreur Postgres **`23505`** (unique_violation) pour renvoyer `alreadyJoined: true` — sans cette contrainte, les doublons passent silencieusement et un membre peut gonfler ses chances au tirage. |
| FK `giveaway_id → giveaways.id` | **justifiée** (`on delete cascade` recommandé ; le code ne supprime jamais les entries à la main) |

### DDL documentaire (non exécutée)

```sql
create table if not exists public.giveaway_entries (
  id bigint generated always as identity primary key,
  giveaway_id bigint not null references public.giveaways(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now(),
  unique (giveaway_id, user_id)
);
```

---

## 8. RPC `increment_ticket_counter` (10.4)

**Consommateur :** `src/modules/tickets/persistence/SupabaseTicketCounterRepository.js`
(`this.supabase.rpc("increment_ticket_counter", { p_guild_id: guildId })`).
Signature et corps documentés dans `docs/architecture/phase-10-4-ticket-counter.md`
(**non exécutée**). Exigences prouvées par le consommateur :

- paramètre `p_guild_id` (passé en string JS) ;
- retour **scalaire `integer`** (`Number(data)`, validé `>= 1`) ;
- atomique (verrou de ligne via `insert ... on conflict (guild_id) do update
  ... returning`) — Free `ticket-001…` et Premium `{number}` partagent ce
  compteur unique par guilde ;
- opère sur `guild_configs.ticket_counter` (colonne `integer not null
  default 0`, cf. §1) ;
- **upsert-capable** pour une guilde sans ligne `guild_configs` existante.

**Si la fonction manque :** `next()` throw → `TicketService` fail-closed →
repli nommage `ticket-<userId>`, **jamais bloquant**.

---

## 9. Table référencée ailleurs (hors duplication)

`analytics_events` est réellement consommée
(`src/modules/analytics/persistence/SupabaseAnalyticsRepository.js`) mais son
schéma est **déjà documenté** dans
`docs/architecture/phase-11-analytics-unification.md` — non dupliquée ici.

---

## 10. Dépendances entre tables

```
guild_configs (aucune dépendance — socle)
guild_entitlements (aucune FK — lignes manuelles propriétaire)
tickets (aucune FK — référence logique guild_id)
suggestions ──┐
              └─ suggestion_votes.suggestion_id → suggestions.id (cascade)
giveaways ────┐
              └─ giveaway_entries.giveaway_id → giveaways.id (cascade)
RPC increment_ticket_counter → lit/écrit guild_configs.ticket_counter
```

## 11. Ordre recommandé des migrations

1. `guild_configs` (socle ; requis par la RPC et tout le bot).
2. RPC `increment_ticket_counter` (dépend de `guild_configs.ticket_counter`).
3. `tickets`.
4. `suggestions`, puis `suggestion_votes` (FK).
5. `giveaways`, puis `giveaway_entries` (FK).
6. `guild_entitlements` (indépendante ; requise seulement pour Premium).
7. `analytics_events` (cf. doc phase-11).

## 12. RLS — uniquement ce qui est justifiable

**Constats de code :** le client est construit avec
`SUPABASE_SERVICE_ROLE_KEY` en priorité (bypasse RLS), fallback
`SUPABASE_ANON_KEY`. Rien dans le code ne prouve que RLS est activé ni n'exige
de policy précise.

**Recommandation justifiée :** si RLS est activée sur ces tables, le bot doit
utiliser **la clé service_role** (aucune policy nécessaire). Avec seulement
la clé anon et RLS activée sans policy, **toutes les requêtes échouent** —
comportement observable : modules Free/Premium muets, erreurs de persistence.
État RLS réel de la base : **à confirmer** côté dashboard (jamais exigé par
le code).

## 13. Rappel final

- Documentation reconstituée offline depuis HEAD `5ff595c` — aucune
  connexion Supabase, aucun credential lu ou demandé.
- **Aucune migration exécutée.** Les DDL ci-dessus sont documentaires.
- `create table if not exists` ne comble pas les colonnes manquantes d'une
  table existante : prévoir des `alter table ... add column if not exists`
  lors de l'application réelle (responsabilité du propriétaire).
