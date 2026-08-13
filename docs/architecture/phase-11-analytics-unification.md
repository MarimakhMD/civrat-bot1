# Phase 11 — Analytics V1 : unification du runtime et intégrations XP/Invites

> Préparée le 2026-08-12 (Phase 11, roadmap phase 9 « Analytics »).
> Périmètre : `src/modules/analytics`, `src/modules/xp`, `src/modules/invites`,
> composition `/settings` et adaptation minimale des événements legacy de
> tracking (dépendance directe, documentée ci-dessous). Aucun autre module
> n'est modifié. Aucune migration n'est exécutée dans cette phase.

## 1. Problème de fond : instances disjointes (P1/P2/P3)

Avant la phase, trois familles d'instances coexistaient :

| Rôle | Instance | Stockage | Conséquence |
| --- | --- | --- | --- |
| Écriture événements (messageCreate / guildMemberAdd) | `getAnalyticsRuntime()` (singleton mémoïsé) | `InMemoryAnalyticsRepository` privé | Données écrites mais **invisibles** |
| Lecture commandes et vues (`/analytics*`, `/settings`) | `new AnalyticsService(...)` construit dans `createGuildSettingsRuntime` | `InMemoryAnalyticsRepository` privé **distinct** | Toujours zéro/vide |
| Écriture XP (messageCreate) | `getXPRuntime()` | Mongo (prod) ou InMemory | Invisible aux classements |
| Écriture Invites (guildMemberAdd/Remove) | `src/services/inviteService.statsRepository` | InMemory partagé legacy | Invisible aux classements |

`/analytics`, `/analytics_xp` et `/analytics_invites` lisaient des instances
vierges : **perte fonctionnelle totale** des données collectées.

## 2. Corrections

- **Runtime unique** : `getAnalyticsRuntime()` devient la seule instance. La
  composition `/settings` utilise `runtime._service` et `runtime._configService`
  (exposés par `createAnalyticsRuntime`) au lieu de construire les siennes.
- **Classements sur la même instance que l'écriture** :
  - `xpRepository` = `getXPRuntime()._repository` (celui qui reçoit les upserts) ;
  - `inviteRepository` = `services/inviteService.statsRepository` (celui qui
    reçoit addInvite/removeInvite).
- **Contrat `getLeaderboard(guildId, limit)`** ajouté à `XPRepository`
  (InMemory + Mongo). Avant, la lecture Analytics retombait sur le champ interne
  `.store` (absent en prod Mongo → classement XP toujours vide en production).
- **Persistance des événements** : `SupabaseAnalyticsRepository` (existant mais
  jamais câblé) est utilisé quand le client Supabase est disponible ; sinon
  InMemory (hors ligne/tests) — comportement « non configuré » inchangé.
- **Sélection robuste du repo XP** : Mongo uniquement si
  `mongoose.connection.readyState === 1` (réellement connecté). Le modèle
  mongoose se construit sans connexion ; l'ancien test « le modèle existe »
  faisait bufferiser indéfiniment toute requête hors ligne dès l'activation de
  l'XP.

## 3. Intégration XP dans /settings (P5)

- Nouvelle sous-vue `/settings → XP` : toggle `xp_enabled` + salon restreint
  `xp_channel_id` (filtre déjà appliqué par `createXPRuntime.handleMessage`) +
  retour. `MANAGE_GUILD`, limites Discord respectées.
- Le taux `xp_rate` reste au défaut (1) : pas d'édition UI en V1.
- Aucun changement du moteur de gain XP (messageCreate → `getXPRuntime`).

## 4. Intégration Invites (P6)

- **`registerInvites` n'était jamais appelé** et ne pouvait pas l'être :
  `InviteComponentId` n'existait pas (crash à l'enregistrement) et le bouton
  Back rendait une vue codée en dur (`settingsView(t, "fr", [])` — sections
  vides, langue forcée). Les deux sont corrigés ; `settingsHome` est désormais
  fourni par la composition comme pour les autres modules.
- **Commande publique `/invites`** (stats membre + classement) : lit le même
  dépôt que le tracking. L'option `boolean` manquait à l'adaptateur de
  commandes Discord (`DiscordCommandAdapter`) — support ajouté (additif).
- **Garde de tracking** : `guildMemberAdd` et `guildMemberRemove` respectent
  désormais `invitations_enabled`, avec la sémantique « opt-out explicite » :
  clé absente ⇒ tracking actif (comportement historique inconditionnel
  préservé) ; `false` explicite ⇒ désactivé. Aligné avec le nouveau défaut
  `INVITE_DEFAULTS.invitations_enabled = true`.
- **Décrément réparé** : `guildMemberRemove` lisait `invitedBy` dans un modèle
  mongoose jamais alimenté par le service legacy (stockage disjoint interne) —
  décrément inopérant. Il lit désormais `inviteService.getInviteStats` (même
  stockage que l'écriture et que les classements).
- **Canal de log des invitations** : non dupliqué dans la sous-vue Invites —
  il se configure déjà via `/settings → Logs → catégorie invitations`.

## 5. Migration `analytics_events` (documentée, NON exécutée)

Le dépôt ignore les `*.sql` ; exécuter ceci dans l'éditeur SQL Supabase **avant
la mise en production** (ordre : migration → bot) :

```sql
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text,
  event_type text not null check (event_type in ('message', 'member')),
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_guild_idx
  on public.analytics_events (guild_id);

-- RLS : le bot utilise la clé service role (bypass) ; aucune lecture publique.
alter table public.analytics_events enable row level security;
```

Rollback : `drop table if exists public.analytics_events;`

Si la table est absente en production, `track` échoue et est intercepté par le
try/catch des événements (comportement « track failed » isolé, jamais bloquant)
— aucun crash ; mais les stats resteront vides tant que la migration n'est pas
exécutée.

## 6. Décisions et limites assumées

- **Membres Analytics** = décompte d'événements `member` dédupliqué par user à
  la lecture ; pas d'événement de départ (sémantique existante conservée).
- **Rétention** : `analytics_events` croît sans purge en V1 (table d'événements
  simple ; une politique de rétention relèverait d'une phase ultérieure).
- **`xp_rate`** non éditable via /settings en V1 (défaut 1).
- **Pas de nouvelle capacité Premium** (charte : Premium après socle Free).

## 7. Problèmes restants connus (non touchés)

- B1/B2/B3 Tickets (rapportés en phases 10.x) — hors périmètre, inchangés.
- `/rank` (commande publique XP) absente — proposition : phase dédiée XP publique.
- Aucune validation réelle Discord/Supabase/Mongo effectuée (aucun accès) ;
  la migration `analytics_events` doit être exécutée et vérifiée en production.
- Le legacy `nextTicketNumber` (COUNT(*)+1, non atomique) demeure hors de cette
  phase (moteur legacy conservé tel quel).
