# Admin Panel CIVRAT — gestion Premium & opérations (V1)

Statut : **documentaire** — aucune requête n'est exécutée automatiquement par
le bot. Les DDL ci-dessous sont à appliquer par le propriétaire (SQL editor
Supabase), comme `supabase-schema-v1.md` et `owner-panel-identity.md`
(convention P14 : pas de fichier `.sql` suivi par Git).

Ce document décrit le **CIVRAT Admin Panel** : l'espace opérationnel des
Admins CIVRAT (gestion Premium, statistiques, recherche serveur, audit),
strictement séparé des pouvoirs d'identité de l'Owner.

## 1. Séparation Owner / Admin

| Capacité | Owner | Admin CIVRAT |
|---|---|---|
| Accès au panel | Master Code (session 24 h) | permanent (statut `civrat_admins`), sans code ni session |
| Gérer Premium (activer / retirer / révoquer) | ✅ | ✅ |
| Voir statistiques / serveurs / audit | ✅ | ✅ |
| Ajouter / retirer un Admin | ✅ | ❌ (`CIVRAT_OWNER`) |
| Transférer l'Owner | ✅ | ❌ (`CIVRAT_OWNER`) |
| Recovery (élévation / canal) | ✅ | ❌ |
| Accès aux codes (Master / Transfer / Recovery) | ✅ (env, jamais affiché) | ❌ |
| Modifier SMTP / Recovery / secrets | ✅ (env) | ❌ |

Les routes d'identité (`ADD_ADMIN`, `REMOVE_ADMIN`, `TRANSFER`, `RECOVERY_*`)
restent **Owner-only** (`{ allOf: [CIVRAT_OWNER] }`, vérifié par le router ET
le service). Les routes opérationnelles du panel sont ouvertes côté registry
mais **re-vérifient l'accès dans chaque handler** : `isAdmin(userId)` (statut
persistant) **ou** `isOwner(userId) && session 24 h active`. Un Admin retiré
de la liste est immédiatement refusé (aucune session résiduelle).

## 2. Données Premium — rétrocompatibilité

La table `guild_entitlements` existante (`guild_id`, `feature_key`, `status`,
`ends_at`) est **étendue** (colonnes ajoutées, jamais de suppression) :

```sql
alter table public.guild_entitlements
  add column if not exists starts_at timestamptz,
  add column if not exists plan text;
```

- Les **anciennes lignes** restent valides : `starts_at` / `plan` absents sont
  lus comme `null` ; `plan` retombe alors sur `feature_key` (affichage et
  statut inchangés).
- **Activation** = upsert (`onConflict: guild_id, feature_key`) écrivant
  `status='active'`, `starts_at=now()`, `ends_at` (null = sans expiration),
  `plan` (défaut = `feature_key`).
- **Désactivation** (retirer / révoquer) = `update status` uniquement — la
  ligne est **conservée** (historique + réactivation possibles, aucune perte).
  `inactive` = retrait simple ; `revoked` = révocation pour abus.

## 3. Historique Premium (append-only)

```sql
create table if not exists public.guild_entitlement_history (
  id bigint generated always as identity primary key,
  guild_id text not null,
  feature_key text not null,
  action text not null check (action in ('activate', 'deactivate', 'revoke_abuse')),
  actor_id text not null,
  old_status text,
  new_status text,
  old_ends_at timestamptz,
  new_ends_at timestamptz,
  plan text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists guild_entitlement_history_guild_idx
  on public.guild_entitlement_history (guild_id);
```

Aucun secret : uniquement des ids, statuts, dates, plan et raison.

## 4. Audit des actions Admin (append-only)

```sql
create table if not exists public.civrat_admin_audit (
  id bigint generated always as identity primary key,
  actor_id text not null,
  guild_id text,
  action text not null,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists civrat_admin_audit_created_idx
  on public.civrat_admin_audit (created_at desc);
```

Chaque action Premium d'un Admin enregistre : `actor_id`, `guild_id`, `action`
(`premium.activate` / `premium.remove` / `premium.revoke_abuse`), `old_value`,
`new_value`, `reason` (si fournie), `created_at`. **Jamais** de Master Code,
Transfer Code, Recovery Code, token, SMTP ou autre secret.

## 5. Nom des serveurs

Aucun nom n'est stocké en base : le panel lit le **cache Discord**
(`client.guilds.cache`) lorsqu'il est disponible et affiche **« N/D »** sinon —
il ne prétend jamais détenir un nom inexistant. La recherche fonctionne
toujours par **ID Discord**.

## 6. Accès hors ligne (sans Supabase)

`supabase` absent ⇒ repositories `null` : lectures repliées (« N/D »,
`PREMIUM_LIST_UNAVAILABLE`, `AUDIT_UNAVAILABLE`…) et **mutations refusées**
(`PREMIUM_UNAVAILABLE`) — fail-closed, jamais de crash. L'état volatil
(sessions Owner, élévations Recovery) reste en mémoire processus.

## 7. Fichiers

- Module : `src/modules/admin-panel/` (register, routes, views, services,
  persistence, translations, tests).
- Core étendu : `src/core/entitlements/` + `src/adapters/supabase/SupabaseEntitlementRepository.js`.
- Analytics étendu : `getGlobalStats` / `getServerStats` (repositories).
- Composition : `src/runtime/createGuildSettingsRuntime.js`,
  `src/modules/owner-panel/runtime/getOwnerPanelRuntime.js`,
  `src/modules/owner-panel/interactions/ownerPanelRoutes.js` (branche Admin).
