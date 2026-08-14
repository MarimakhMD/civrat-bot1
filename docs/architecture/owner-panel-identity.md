# Owner Panel — identité CIVRAT (P20)

Statut : **documentaire** — aucune requête n'est exécutée automatiquement par
le bot. Les DDL ci-dessous sont à appliquer par le propriétaire (SQL editor
Supabase), comme `supabase-schema-v1.md` (convention P14 : pas de fichier
`.sql` suivi par Git).

Ce document justifie le stockage de l'identité CIVRAT (brief P20 §9) :
**pourquoi, quelles données, contraintes, sécurité, comportement hors ligne.**

## 1. Pourquoi une persistance est nécessaire

Le Owner CIVRAT initial vient de `CIVRAT_OWNER_ID` (env hosting). Mais le
Owner Panel introduit trois **mutations** administrables à chaud : ajouter /
retirer un Admin CIVRAT, et **transférer le Owner**. Sans persistance :

- un transfert serait annulé au prochain redémarrage (l'env redeviendrait la
  source) — trou de sécurité : l**'ancien Owner redeviendrait Owner** ;
- les listes d'admins seraient perdues à chaque redéploiement.

La persistance prime donc sur l'env dès qu'elle contient un Owner ; l'env
reste le repli de lecture quand la base n'a jamais été écrite (installation
initiale). C'est la phase « PostgreSQL Owner Panel » prévue par la couture
core (`CivratOwnerProvider`, `DisabledCivratOwnerProvider`).

## 2. Données stockées — aucun secret

| Table | Colonnes | Contenu |
|---|---|---|
| `civrat_owner_state` | `id` (singleton = 1), `owner_id` text, `updated_at` | l'Owner CIVRAT actuel (un **ID Discord public**) |
| `civrat_admins` | `user_id` text (PK), `added_at` | la liste des Admins CIVRAT (IDs Discord publics) |

**Aucun secret en base** : `RECOVERY_MASTER_CODE`, `OWNER_PANEL_MASTER_CODE`,
`OWNER_TRANSFER_CODE`, les SMTP et les tokens restent **exclusivement** dans
les variables d'environnement du hosting. Ils ne sont jamais écrits ici, ni
loggés, ni renvoyés.

## 3. DDL documentaire (à appliquer par le propriétaire)

```sql
-- Owner CIVRAT : une seule ligne possible (id = 1).
create table if not exists public.civrat_owner_state (
  id smallint primary key default 1,
  owner_id text not null,
  updated_at timestamptz not null default now(),
  constraint civrat_owner_state_singleton check (id = 1)
);

-- Admins CIVRAT : un ID Discord par ligne.
create table if not exists public.civrat_admins (
  user_id text primary key,
  added_at timestamptz not null default now()
);
```

Ordre : les deux tables sont indépendantes (aucune FK), applicables dans
n'importe quel ordre. `create table if not exists` est idempotent mais **ne
modifie pas** une table existante (rappel P14 §11).

Rollback : `drop table if exists public.civrat_admins;` puis
`drop table if exists public.civrat_owner_state;` — l'env `CIVRAT_OWNER_ID`
redevient l'unique source (comportement installation initiale).

## 4. Contraintes et limites connues

- **Transfert en deux écritures** (owner puis retrait du nouveau Owner de la
  liste des admins) : `supabase-js` sans RPC ne permet pas la transaction
  multi-requêtes. En cas de crash entre les deux, le nouveau Owner peut
  rester listé admin — **sans effet de sécurité** (Owner ≠ Admin dans le
  service, l'Owner est déjà exclu des cibles admin et des vérifications
  d'admin). Dédoublement impossible : `id = 1` + PK `user_id`, écritures en
  `upsert`.
- **Une instance d'écriture** : le bot est mono-process ; pas de verrou
  distribué (cohérent avec `tickets` P14 §3).
- **RLS** : même recommandation que P14 §12 — si RLS est activée, le bot doit
  utiliser `SUPABASE_SERVICE_ROLE_KEY` (aucune policy nécessaire). À confirmer
  côté dashboard.

## 5. Sécurité du modèle d'accès

```
membre Discord      Admin CIVRAT        Owner CIVRAT        Recovery validé
      │                  │                   │                     │
      ▼                  ▼                   ▼                     ▼
  refus générique   /ownerpanel         /ownerpanel          élévation 15 min
                    accès PERMANENT     + Master Code        ► vue récupéra-
                    (statut Admin       = session 24 h       tion (AUCUNE
                    persistant)         lecture + actions    donnée) : un
                    lecture seule       (CIVRAT_OWNER router) seul canal —
                    (aucun bouton,                          transfert sous
                    aucun code,                             Transfer Code
                    aucune session)                         + confirmation
```

- L'**ouverture** de `/ownerpanel` exige : Owner CIVRAT **ou** Admin CIVRAT
  **ou** élévation Recovery active (temporaire, fail-closed, jamais une
  promotion automatique). Tout autre utilisateur : réponse générique éphémère.
- **Owner CIVRAT** : le **contenu** exige `OWNER_PANEL_MASTER_CODE`
  (session **24 h** en mémoire ; 5 échecs ⇒ verrouillage 5 min ; comparaison à
  temps constant ; le code n'est jamais loggé ni réaffiché). L'expiration de
  la session ne retire JAMAIS le statut Owner : l'Owner se ré-authentifie
  simplement. Tout transfert réussi révoque immédiatement la session de
  l'ancien Owner (aucune session automatique pour le nouveau).
- **Admin CIVRAT** : accès **permanent** lié à sa présence dans la liste
  persistante `civrat_admins` — aucun Master Code, aucune session, aucune
  expiration. L'accès est re-vérifié à chaque interaction ; un retrait de la
  liste referme l'accès immédiatement. L'Admin ne voit que la vue en lecture
  seule (aucun bouton d'action) et ne satisfait jamais `CIVRAT_OWNER`.
- Les **actions** portent `{ allOf: [CIVRAT_OWNER] }` vérifié par le router
  **et** re-vérifiées dans le service (défense en profondeur). Chaque action
  exige une **confirmation explicite** (action en attente 10 min, consommée
  une fois, confirm OU cancel).
- Le **transfert normal** exige en plus `OWNER_TRANSFER_CODE` + confirmation
  finale ; il est **Owner-only** — jamais accessible à un simple admin.
- **P20.1 — transfert par récupération** : un utilisateur dont l'ÉLÉVATION
  Recovery est encore active peut initier un transfert Owner via un **canal
  dédié** (routes `recovery:*`), à ces conditions cumulatives : 1) Recovery
  correctement validé, 2) élévation encore active (revérifiée à chaque étape,
  y compris à la confirmation), 3) `OWNER_TRANSFER_CODE` exact (comparaison
  à temps constant ; échecs comptés dans le verrou anti force brute PARTAGÉ
  avec le Master Code), 4) confirmation finale explicite, 5) validations du
  service (ID valide, cible ≠ Owner actuel, persistance disponible).
  Garanties : jamais de `CIVRAT_OWNER` temporaire ni de promotion avant le
  transfert ; l'élévation est **consommée au succès** (une élévation = un
  seul transfert ; pas de second transfert) ; la mutation persistée est
  IDENTIQUE au transfert normal (le nouveau Owner est retiré des Admins,
  l'ancien perd immédiatement son statut, l'env ne peut plus le restaurer) ;
  le Recovery ne donne AUCUN autre pouvoir (la vue récupération n'affiche
  aucune donnée d'identité ; la lecture complète reste derrière le Master
  Code). Un simple Admin ne satisfait jamais la condition 1.

## 6. Comportement hors ligne (sans Supabase)

`repository = null` : lecture = env uniquement (`CIVRAT_OWNER_ID`, admins =
aucun) ; **toutes les mutations sont refusées** (`PERSISTENCE_UNAVAILABLE`,
fail-closed, jamais de crash).

L'état volatil complet (sessions, verrouillages, confirmations, élévations
Recovery) vit en mémoire processus : un redémarrage l'efface — l'utilisateur
se ré-authentifie simplement. Notamment (P20.1) : un transfert déjà confirmé
n'est jamais rejouable, et une élévation expirée ou consommée ne peut plus
rien ouvrir ni confirmer. Testé offline.

## 7. Références

- Module : `src/modules/owner-panel/` (services, persistence, interactions,
  tests `OwnerPanelFlow.test.js`).
- Couture consommée : `PermissionName.CIVRAT_OWNER` +
  `CivratIdentityOwnerProvider` injecté dans `PermissionService`
  (`createGuildSettingsRuntime`).
- Lien Recovery : `getRecoveryRuntime().hasActiveElevation` (P20 §8).
