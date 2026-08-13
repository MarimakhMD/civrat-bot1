# Runbook de validation V1 — CIVRAT (P18)

> **Documentation uniquement, préparée offline.** Aucune migration exécutée,
> aucune connexion Discord/Supabase/Mongo, aucun credential lu, demandé ou
> affiché. Des tests offline verts ne constituent **pas** une validation
> Discord, Supabase ou MongoDB réelle (convention du dépôt, cf.
> `tickets-production-validation.md`). Ce runbook ordonne la fenêtre de
> validation réelle, exécutée uniquement par le owner.
>
> État du code au moment de l'écriture : HEAD `f978b47` (P17), tests
> offline 650/650, vérificateurs statiques verts.

## 0. Principes

1. Jamais dans une guild de production sans procédure approuvée — guild de
   test dédiée.
2. Aucun secret dans le dépôt : `.env` gitignoré, `.env.example` =
   placeholders (P12.1). Toute valeur exposée est **rotée** (voir §5).
3. Ordre strict : base de données → intents → déploiement des commandes →
   démarrage → smoke tests → GO/NO-GO.
4. L'API et le Dashboard sont **conservés tels quels** (dépendances et
   variables présentes mais inutilisées à ce jour) : aucune suppression,
   aucune décision de périmètre dans ce runbook.

## 1. Préconditions hébergeur

- Node.js `>= 18.17` (champ `engines` ; développé et testé sous Node 22).
- `npm ci` (de `package-lock.json`), aucune dév-dependence requise en
  production au-delà des `dependencies` déclarées (dont `@napi-rs/canvas`
  pour les images Welcome — module natif, compilé à l'install).

### Variables d'environnement (noms uniquement, valeurs jamais ici)

| Variable | Requis | Rôle déduit du code |
|---|---|---|
| `DISCORD_TOKEN` | oui | login ; **manquant/placeholder => exit 1 sans appel réseau** (index.js, deploy.js) |
| `CLIENT_ID` | oui | enregistrement des commandes ; manquant => exit 1 |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | oui (persistance) | client Supabase ; sans eux : modules muets en fail-closed (config non persistée) |
| `SUPABASE_ANON_KEY` | fallback | utilisée seulement si la service key est absente — attention RLS (§2.3) |
| `MONGO_URI` / `MONGO_DB_NAME` | optionnel | persistance XP/Invites ; défaut db `civrat` ; **sans Mongo : classements volatils au redémarrage** |
| `LEGACY_GUILD_ID` | optionnel | purge des commandes guild legacy au `deploy` |
| `RECOVERY_MASTER_CODE`, `RECOVERY_EMAIL` | optionnel | `/recovery` (P20) : Master Code permanent (env-only) + adresse e-mail de réception du code temporaire ; **sans le couple complet : `/recovery` se contente d'une réponse générique et n'envoie rien (fail-closed)** |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | optionnel | relais SMTP (Brevo : `smtp-relay.brevo.com`, `587` STARTTLS ou `465` TLS) pour l'e-mail de récupération ; config incomplète => récupération indisponible, rien n'est envoyé ni loggé |
| `CIVRAT_OWNER_ID` | recommandé | Owner CIVRAT initial (ID Discord public, **≠** Server Owner) ; repli de lecture tant que `civrat_owner_state` est vide — tables : `docs/architecture/owner-panel-identity.md` §3 |
| `OWNER_PANEL_MASTER_CODE` | optionnel | `/ownerpanel` : débloque le contenu (session 10 min) ; **vide ⇒ panneau indisponible, fail-closed** |
| `OWNER_TRANSFER_CODE` | optionnel | exigé (avec confirmation finale) pour transférer le Owner ; vide ⇒ transfert impossible |
| `API_PORT`, `API_SECRET`, `DASHBOARD_URL`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | **non** | conservées, **inutilisées par le code actuel** — ne pas peupler |

### Intents Discord (portail développeur)

- **Privileged à activer obligatoirement** : `Server Members`
  (`GuildMembers`), `Message Content` — sinon login refusé
  (« disallowed intents »).
- Non privilégiés (rien à activer) : `Guilds`, `GuildModeration`,
  `GuildMessages`, `GuildVoiceStates`, `GuildInvites`.
- Référence code : `INTENTS`/`PARTIALS` dans `index.js`.

### Permissions du bot (déduites des usages code, à confirmer par smoke test)

`ManageChannels`, `ManageRoles`, `ModerateMembers`, `KickMembers`,
`BanMembers`, `ManageMessages`, `ManageGuild` (lecture des invitations),
`ManageNicknames`, `SendMessages`, `EmbedLinks`, `AttachFiles`
(transcripts + images Welcome), `ViewChannel`, `ReadMessageHistory`,
`Connect` (Temp Voice), `Manage Guild Expressions` (`/uploadsticker` —
**à confirmer**).

## 2. Base Supabase — ordre obligatoire (P14 §11)

1. `guild_configs` (table cœur ; base fraîche : DDL P14 §1 **incluant** les 8
   colonnes Premium 10.1 et `ticket_counter` 10.4 ; base existante : `alter
   table … add column if not exists` — `create table if not exists` **ne
   comble pas** les colonnes manquantes, rappel P14 §13).
2. RPC `increment_ticket_counter` (SQL de `phase-10-4-ticket-counter.md` ;
   dépend de `guild_configs.ticket_counter`). **Sans cette fonction :
   nommage en repli silencieux `ticket-<userId>`** (fail-closed), et aucun
   format Premium `{number}` ne rend.
3. `tickets`.
4. `suggestions`, puis `suggestion_votes` (FK).
5. `giveaways`, puis `giveaway_entries` (FK).
6. `guild_entitlements` (indépendante ; requise uniquement pour Premium).
7. `analytics_events` (SQL de `phase-11-analytics-unification.md`).

### 2.1 Vérifications post-migration (lecture seule côté bot)

- Tables présentes et colonnes visibles depuis le SQL editor Supabase.
- Appel contrôlé `increment_ticket_counter` (write test assumé owner) :
  retour entier `>= 1`.
- Le bot n'exige aucune autre table/fonction (audit P14 exhaustif).

### 2.2 RLS (P14 §12)

État réel **à confirmer** côté dashboard. Si RLS activée : le bot doit
utiliser la **clé service_role** (aucune policy nécessaire). Anon seule +
RLS sans policy => **toutes** les requêtes échouent (modules muets,
erreurs de persistence observables).

## 3. Rotation de la clé exposée

La publishable key Supabase figure dans l'historique git (commit `44ecd02`).
**Action owner-only** : régénérer côté dashboard Supabase, mettre à jour les
variables d'environnement d'hébergement. Ne jamais la recoller dans le dépôt.

## 4. Entitlements Premium (optionnel, pour le smoke Premium)

INSERT documentaire (à exécuter par le owner) : ligne `guild_entitlements`
avec `guild_id` de la guild de test, `feature_key = 'TICKET_PREMIUM'`,
`status = 'active'`, `ends_at = null`. Test de révocation : `status =
'revoked'` (ou `ends_at` passé) => **retour Free immédiat** à vérifier.

## 5. Déploiement des commandes

```bash
npm run deploy
```

- Refuse tout token manquant/placeholder **sans appel réseau** (garde
  P12.1).
- Purge les commandes guild legacy si `LEGACY_GUILD_ID` est défini.
- Enregistre **24 commandes globales** (liste exacte : `settings`, `captcha`,
  `warn`, `mute`, `unmute`, `bannir`, `debannir`, `expulser`, `supprimer`,
  `slowmode`, `verrouiller`, `deverrouiller`, `pseudo`, `automod`,
  `uploadsticker`, `giveaway`, `suggest`, `analytics`, `analytics_xp`,
  `analytics_invites`, `invites`, `ticketpanel`, `recovery`, `ownerpanel`).
  La propagation globale peut prendre du temps (comportement Discord
  documenté).

## 6. Démarrage

```bash
node index.js        # ou npm start
```

Logs attendus : `24 slash commands available.`, puis `MongoDB connected.`
**ou** `MongoDB connection failed — continuing without it.` (toléré :
persistance XP/Invites en mémoire seulement), puis `CIVRAT is online as
<tag>.`

Échecs typiques : `DISCORD_TOKEN`/`CLIENT_ID` manquants (exit 1, aucun
réseau), intents privilégiés non activés (refus de login), Supabase muet
si clés absentes (fail-closed documenté P14).

## 7. Smoke tests Discord (guild de test)

Ordre recommandé ; chaque case = preuve visuelle dans la guild.

### 7.1 Configuration

- [ ] `/settings` s'ouvre en FR ; bascule langue EN ; sections présentes
      (Welcome, AutoRole, AutoMod, Security, TempVoice, Giveaway, Suggestion,
      Tickets, Captcha, Logs, Analytics, XP, Invites).
- [ ] Tickets : activer, configurer catégorie + rôle support + salon
      logs/transcripts (sélecteur P13-B3).

### 7.2 Parcours Tickets Free (réf. `tickets-production-validation.md`)

- [ ] `/ticketpanel` : panneau **traduit** dans le salon d'invocation
      (P12.2 + P17) — FR : titre « 🎫 Tickets », description « Cliquez
      ci-dessous pour créer un ticket. », bouton « Créer un ticket » ;
      EN après bascule : « Click below to create a ticket. » /
      « Create a ticket ». Aucune clé brute.
- [ ] Création : salon `ticket-001` (RPC appliquée) — sinon repli documenté
      `ticket-<userId>` ; accueil avec **5 boutons** traduits (Fermer /
      Prendre en charge / Renommer / Ajouter / Retirer) ; `@everyone` sans
      accès ; créateur + support avec accès.
- [ ] Claim (staff), Rename (modale), Ajouter/Retirer un membre.
- [ ] Fermeture : créateur ne peut plus écrire ; notice staff
      [Réouvrir = succès / Supprimer = danger] ; transcript `.txt` vers le
      salon logs Free configuré.
- [ ] Réouverture : notice sans boutons ; créateur peut réécrire.
- [ ] Suppression : salon supprimé après 5 s ; statut `deleted`.
- [ ] Concurrence : deux créations simultanées => numéros distincts
      (compteur atomique).

### 7.3 Premium (si entitlement actif, §4)

- [ ] Panneau personnalisé (titre, description, couleur, image, label).
- [ ] Accueil Premium (message + placeholders) et salon transcript dédié.
- [ ] Nommage personnalisé `{number}` (ex. `vip-{number}` => `vip-00N`,
      compteur **partagé** avec Free).
- [ ] Révocation => retour Free immédiat (panneau et nommage).

### 7.4 Autres modules

- [ ] Welcome : bouton Test (embed) ; arrivée réelle => message + image
      template Free (intents membres) ; logs d'arrivée.
- [ ] `/giveaway` création + tirage ; `/suggest` + votes ; `/invites`.
- [ ] Captcha (bouton de vérification) ; sanctions warn/mute
      (logs modération) ; automod (suppression message interdit).
- [ ] XP : quelques messages puis `/analytics_xp` ; **redémarrage** =>
      classement conservé **si** Mongo configuré (sinon perte assumée).
- [ ] `/recovery` (P20 — **owner uniquement, nécessite le couple
      `RECOVERY_*` + SMTP configurés**) : Master Code erroné => même réponse
      générique qu'un code juste (aucun oracle) ; Master Code juste =>
      e-mail reçu sur `RECOVERY_EMAIL` (code 6 chiffres) ; code saisi =>
      « Récupération validée » ; réutilisation du même code => refus ; sans
      configuration recovery => réponse générique, aucun e-mail.
- [ ] `/ownerpanel` (P20 — tables `owner-panel-identity.md` §3 appliquées +
      `CIVRAT_OWNER_ID` + `OWNER_PANEL_MASTER_CODE` définis) : membre simple
      => refus générique éphémère ; Owner/Admin => modale Master Code ;
      mauvais code => refus générique identique ; bon code => panneau
      (Owner/Admins visibles) ; **Admin** : aucun bouton d'action ; **Owner** :
      ajout admin / retrait admin avec confirmation ; transfert Owner exige
      `OWNER_TRANSFER_CODE` + confirmation finale, puis l'ancien Owner perd
      immédiatement le rôle (vérifier `isOwner` des deux côtés) ; Recovery
      validé => `/ownerpanel` ouvrable pendant 15 min en **mode récupération**
      (P20.1 — vue sans aucune donnée d'identité) : transfert possible
      UNIQUEMENT avec `OWNER_TRANSFER_CODE` + confirmation finale (revérif
      de l'élévation à chaque étape) ; élévation consommée au succès (pas de
      second transfert) ; jamais de promotion automatique ; mauvais Transfer
      Code => refus générique (et compté dans le verrou anti force brute).
- [ ] Réfs : `welcome-image-production-validation.md`,
      `captcha-production-validation.md`, `autorole-production-validation.md`,
      `logs-production-validation.md`, `phase-3-real-environment-protocol.md`.

## 8. GO / NO-GO

**GO** si : toutes les cases §7 cochées, aucun secret non roté, migrations
§2 appliquées et vérifiées, 24 commandes visibles, aucun crash en
redémarrage.

**NO-GO** (bloquer et corriger avant diffusion) : clés brutes dans le
panneau, repli `ticket-<userId>` alors que la RPC est censée être
appliquée, tables manquantes, intents refusés, RLS bloquante.

Rollback : pointeurs SQL dans `phase-10-4-ticket-counter.md` (section
Rollback) ; retrait des commandes via nouveau `deploy` ; Premium :
supprimer la ligne `guild_entitlements` (retour Free immédiat, sans
déploiement).

## 9. Traçabilité offline (au jour de l'écriture)

- 650/650 tests offline, verify-static 531 fichiers, verify-commands 5/5,
  verify-repository OK, diff --check OK, scan secrets strict vide,
  parité i18n EN/FR sur les 16 modules.
- Rappel : ces preuves sont des **préconditions**, pas la validation réelle.
