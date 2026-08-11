> **Historical document — not an active technical reference**
>
> This document describes a previous dashboard-oriented integration. CIVRAT is now
> developed as an autonomous Discord bot. Do not use this document to design,
> implement, or validate new functionality. Active engineering decisions are in
> [`docs/architecture/decisions.md`](docs/architecture/decisions.md).

# ✅ CIVRAT Bot v2.0 — Résumé de l'intégration

## 🏗️ Architecture finale

```
civrat-discord-mastery/
├── bot/                              # Bot Discord (NOUVEAU - restructuré)
│   ├── index.js                      # Point d'entrée principal
│   ├── deploy.js                     # Déploiement des commandes
│   ├── package.json                  # Dépendances
│   ├── .env                          # Secrets (NE PAS COMMIT)
│   ├── .env.example                  # Template
│   ├── .gitignore
│   │
│   └── src/
│       ├── config/
│       │   ├── index.js              # Configuration centralisée (.env)
│       │   └── database.js           # MongoDB + Supabase connections
│       │
│       ├── commands/                 # 17 commandes (1 fichier = 1 commande)
│       │   ├── ping.js
│       │   ├── infoserveur.js
│       │   ├── infomembre.js
│       │   ├── avatar.js
│       │   ├── bannir.js
│       │   ├── expulser.js
│       │   ├── debannir.js          # ← NOUVEAU (était manquant)
│       │   ├── warn.js              # ← NOUVEAU
│       │   ├── mute.js              # ← NOUVEAU
│       │   ├── unmute.js            # ← NOUVEAU
│       │   ├── slowmode.js          # ← NOUVEAU
│       │   ├── pseudo.js            # ← NOUVEAU
│       │   ├── verrouiller.js       # ← NOUVEAU
│       │   ├── deverrouiller.js     # ← NOUVEAU
│       │   ├── supprimer.js         # ← Corrigé (était non enregistré)
│       │   ├── ticketpanel.js
│       │   └── invites.js
│       │
│       ├── events/                   # 21 événements (1 fichier = 1 event)
│       │   ├── ready.js             # ← FIX: "clientReady" → "ready"
│       │   ├── interactionCreate.js # Tickets, boutons, menus
│       │   ├── guildMemberAdd.js    # ← Fusionné (3 → 1 listener)
│       │   ├── guildMemberRemove.js # ← Fusionné (2 → 1 listener)
│       │   ├── guildMemberUpdate.js # ← Fusionné (2 → 1 listener)
│       │   ├── messageCreate.js     # ← Fusionné (2 → 1 listener)
│       │   ├── messageDelete.js
│       │   ├── messageUpdate.js
│       │   ├── messageDeleteBulk.js
│       │   ├── channelCreate/Delete/Update.js
│       │   ├── threadCreate/Delete.js
│       │   ├── roleCreate/Delete/Update.js
│       │   ├── inviteCreate/Delete.js
│       │   └── guildBanAdd/Remove.js
│       │
│       ├── services/
│       │   ├── guildConfig.js       # ← LECTURE SUPABASE (source de vérité)
│       │   ├── inviteService.js     # Invite tracking (MongoDB)
│       │   └── placeholder.js       # Template engine ({user}, {server}, etc.)
│       │
│       ├── handlers/
│       │   ├── commandHandler.js    # Charge et dispatch les commandes
│       │   └── eventHandler.js      # Charge les événements
│       │
│       ├── utils/
│       │   ├── logger.js            # Logs structurés
│       │   └── auditLogCache.js     # Cache audit logs (anti rate-limit)
│       │
│       └── api/
│           └── server.js            # Express API (health, sync)
│
└── src/                              # Dashboard (EXISTANT - non modifié)
    ├── pages/dashboard/modules/      # 20+ modules
    ├── lib/supabase.ts              # Supabase client
    ├── lib/use-guild-config.ts      # Config hook (lit guild_configs)
    └── types/index.ts               # TypeScript types
```

---

## 🔐 Sécurité — Corrigé

| Avant | Après |
|-------|-------|
| Token en clair dans index.js | `.env` avec `dotenv` |
| Token en clair dans deploy.js | `.env` partagé |
| MongoDB URI en clair | `.env` |
| Pas de CORS | CORS configuré pour dashboard |
| Pas de rate limiting | `express-rate-limit` (100 req/15min) |
| Pas de headers sécurité | `helmet.js` |

---

## 🐛 Bugs corrigés

| # | Bug original | Correction |
|---|-------------|------------|
| 1 | `client.once("clientReady")` inexistant | → `ready` |
| 2 | Commande `/supprimer` non enregistrée | → Enregistrée + handler |
| 3 | 8 commandes sans handler (deploy.js) | → Tous implémentés |
| 4 | `guildMemberAdd` × 3 listeners | → 1 listener fusionné |
| 5 | `guildMemberRemove` × 2 listeners | → 1 listener fusionné |
| 6 | `guildMemberUpdate` × 2 listeners | → 1 listener fusionné |
| 7 | `messageCreate` × 2 listeners | → 1 listener fusionné |
| 8 | `inviteStats` perdu au restart | → Persisté en MongoDB |
| 9 | `spam` Map jamais nettoyée (memory leak) | → Nettoyage par timestamps |
| 10 | MongoDB connecté mais jamais utilisé | → Utilisé pour invites, tickets, counting |
| 11 | Pas de `partials` dans le client | → Ajoutés (Message, Channel) |
| 12 | Pas d'intent `GuildModeration` | → Ajouté pour ban/unban |
| 13 | `fetchAuditLogs` sans cache (rate limit) | → Cache 3s |

---

## 🔄 Intégration Supabase

### Source de vérité unique

Le bot lit **toute la configuration serveur** depuis Supabase :

```javascript
// Au lieu de:
const LOG_JOIN = "1512783491157458965";  // ← Hardcodé

// Maintenant:
const config = await getGuildConfig(guildId);
const channelId = config.log_member_join_channel_id;  // ← Supabase
```

### Flux de données

```
Dashboard (React)
    │
    │ Écrit dans guild_configs
    ▼
Supabase (PostgreSQL)
    │
    │ Bot lit au démarrage + cache 5min
    ▼
Discord Bot (Node.js)
    │
    │ Écrit analytics/XP/counting
    ▼
MongoDB (NoSQL)
```

### Mapping Dashboard ↔ Bot

| Dashboard Field | Bot Usage |
|----------------|-----------|
| `welcome_enabled` | Active/désactive welcome |
| `welcome_channel_id` | Salon d'envoi |
| `welcome_message` | Message avec placeholders |
| `goodbye_enabled` | Active/désactive goodbye |
| `goodbye_channel_id` | Salon d'envoi |
| `tickets_enabled` | Active/désactive tickets |
| `ticket_category_id` | Catégorie des tickets |
| `ticket_support_role_id` | Rôle staff mentionné |
| `ticket_log_channel_id` | Salon de log tickets |
| `logs_enabled` | Active/désactive tous les logs |
| `log_member_join_channel_id` | Log des arrivées |
| `log_member_leave_channel_id` | Log des départs |
| `log_moderation_channel_id` | Log ban/kick/timeout |
| `log_message_delete_channel_id` | Log messages supprimés |
| `log_message_edit_channel_id` | Log messages modifiés |
| `log_role_update_channel_id` | Log rôles/nicknames |
| `log_channel_update_channel_id` | Log salons/threads |
| `automod_enabled` | Active/désactive auto-mod |
| `automod_anti_spam` | Anti-spam |
| `security_anti_raid` | Anti-raid |
| `security_log_channel_id` | Salon alertes sécurité |
| `invitations_enabled` | Tracking invitations |
| `invitations_log_channel_id` | Log invitations |
| `language` | Langue du bot (fr/en) |

---

## 📊 MongoDB — Utilisation correcte

MongoDB est maintenant utilisé **uniquement** pour :

| Collection | Usage | Raison |
|-----------|-------|--------|
| `InviteStats` | Stats d'invitations par utilisateur | Volume élevé, lecture/écriture fréquente |
| `TicketCounter` | Compteur de tickets par serveur | État runtime |
| `CountingGame` | État du jeu de comptage | État runtime |
| *(futur)* `UserXP` | XP/Niveaux | Volume élevé |
| *(futur)* `CommandUsage` | Analytics commandes | Analytics |
| *(futur)* `AuditLog` | Logs haute fréquence | Volume élevé |

---

## 🌐 Placeholders supportés

| Placeholder | Description |
|-------------|-------------|
| `{user}` | Mention de l'utilisateur |
| `{username}` | Nom d'utilisateur |
| `{displayName}` | Nom affiché sur le serveur |
| `{server}` | Nom du serveur |
| `{memberCount}` | Nombre de membres |
| `{joinDate}` | Date d'arrivée |
| `{accountAge}` | Âge du compte |
| `{inviter}` | Mention de l'inviteur |
| `{inviteCode}` | Code d'invitation |
| `{channel}` | Mention du salon |
| `{date}` | Date actuelle |
| `{time}` | Heure actuelle |
| `{ticketNumber}` | Numéro du ticket |
| `{ticketOwner}` | Propriétaire du ticket |
| `{boostCount}` | Nombre de boosts |
| `{boostLevel}` | Niveau de boost |

---

## 🚀 Pour démarrer

### 1. Configurer les variables d'environnement

```bash
cd bot
cp .env.example .env
# Éditer .env avec tes credentials
```

### 2. Variables requises dans `.env`

```
DISCORD_TOKEN=ton_token_bot
CLIENT_ID=1478877109538652371
SUPABASE_URL=https://ton-projet.supabase.co
SUPABASE_ANON_KEY=ta-clé-anon
MONGO_URI=ton-uri-mongodb
```

### 3. Installer et lancer

```bash
npm install
node deploy.js    # Enregistrer les commandes (1x)
node index.js     # Démarrer le bot
```

---

## 📋 Prochaines étapes

### Phase 4 : MongoDB Analytics
- [ ] Modèle `UserXP` pour le leveling
- [ ] Modèle `CommandUsage` pour les analytics
- [ ] Service d'agrégation pour les graphiques

### Phase 5 : Features avancées
- [ ] Welcome images (canvas/node-canvas)
- [ ] Ticket transcripts
- [ ] XP/Leveling complet
- [ ] Suggestions system
- [ ] Giveaways
- [ ] Auto-responses
- [ ] Anti-nuke
- [ ] Temp voice channels
- [ ] i18n (FR/EN)

### Phase 6 : Dashboard improvements
- [ ] Remplacer les faux channels dans les selects par les vrais channels du serveur
- [ ] Ajouter le live preview pour welcome
- [ ] Ajouter l'embed builder visuel
- [ ] Ajouter les templates
- [ ] Ajouter l'import/export
- [ ] Supprimer la page Premium

---

## ⚠️ Notes importantes

1. **Le dashboard n'a PAS été modifié** — il fonctionne tel quel
2. **Le bot lit la config Supabase** que le dashboard écrit
3. **Pour que tout fonctionne**, il faut :
   - Configurer `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans `.env`
   - S'assurer que la table `guild_configs` existe dans Supabase
   - Les colonnes doivent correspondre au schéma dans `use-guild-config.ts`
4. **Les IDs hardcodés restants** (MEMBER_ROLE, BOT_ROLE) sont des fallbacks qui seront remplacés par la config Supabase quand les champs correspondants seront ajoutés au schéma

---

## Security Center — état réel

Les protections suivantes sont reliées au contrat `guild_configs` et actives côté bot lorsqu'elles sont configurées :

| Protection | Champ | État |
|---|---|---|
| Détection raid (5 arrivées / 15 s) | `security_enabled`, `security_anti_raid` | Opérationnelle |
| Bot non autorisé | `security_anti_bot`, `security_whitelist` | Opérationnelle |
| Créations/suppressions massives salons | `security_anti_nuke` | Opérationnelle |
| Créations/suppressions massives rôles | `security_anti_nuke` | Opérationnelle |
| Réponse quarantaine | `security_quarantine_role` | Opérationnelle si le bot peut gérer le membre/rôle |
| Log incident | `log_moderation_channel_id` | Opérationnelle |

Les actions anti-webhook, mass-ban, mass-kick, seuils personnalisables, retrait de permissions et exemptions de rôles/salons ne sont pas documentées comme fonctionnelles : elles requièrent des champs canoniques supplémentaires et/ou des événements/services dédiés.

---

## Invitations — état réel

| Fonctionnalité | Champ / source | État |
|---|---|---|
| Activation tracking | `invitations_enabled` | Opérationnelle |
| Cache au démarrage et refresh create/delete | Cache Discord + `InviteStats` | Opérationnelle |
| Attribution de l’invitation utilisée | Comparaison cache / uses Discord | Opérationnelle après cache initial |
| Totales, départs, actuelles/nettes | collection Mongo existante `InviteStats` | Opérationnelle |
| Classement `/invites` | agrégation Mongo existante | Opérationnelle |
| Log join par invitation | `invitations_log_channel_id` | Opérationnelle |
| Fake invites | aucune donnée canonique/modèle | Prêt à connecter |
| Vanity URLs / attribution après redémarrage avant premier cache | Discord ne fournit pas toujours l’information | Limité |

Un départ issu d’un kick détecté via Audit Logs n’est pas décrémenté comme départ volontaire. Les erreurs Discord et Mongo sont absorbées et journalisées sans faire tomber le listener.

---

## XP & Niveaux — état réel

| Fonctionnalité | Champ / source | État |
|---|---|---|
| Gain XP message | `xp_enabled`, `xp_per_message` | Opérationnelle |
| Cooldown durable | `xp_cooldown`, `UserXP.lastXpAt` | Opérationnelle |
| Niveaux | formule `100 × niveau²` | Opérationnelle |
| Rôles récompense | `role_rewards` | Opérationnelle si le bot peut gérer le rôle/membre |
| Annonce niveau | `xp_announce_channel_id` | Opérationnelle si le salon est accessible |
| `/niveau` | collection `UserXP` | Opérationnelle |
| `/classement` | index Mongo `guildId, xp` | Opérationnelle |
| Carte XP image | aucune dépendance image/canvas | Prêt à connecter |
| Multiplicateurs | aucun champ canonique | Prêt à connecter |
| Analytics XP dashboard | aucun endpoint API actif | Prêt à connecter |

Le modèle Mongo `UserXP` est la seule collection ajoutée pour XP : il contient guildId, userId, xp, level, lastXpAt et totalMessages, avec index unique `(guildId, userId)` et index de classement `(guildId, xp)`.

---

## Giveaways — état réel

| Fonctionnalité | Source | État |
|---|---|---|
| Activation | `giveaways_enabled` | Opérationnelle |
| Données giveaway | table Supabase existante `giveaways` | Opérationnelle |
| Participations | modèle Mongo minimal `GiveawayEntry` | Opérationnelle |
| Bouton participer | interaction `giveaway_join:<id>` | Opérationnelle |
| Fin automatique après redémarrage | requête Supabase toutes les minutes | Opérationnelle |
| Création / fin / reroll / annulation staff | `/giveaway` | Opérationnelle |
| Logs | `log_moderation_channel_id` | Opérationnelle |
| Modification d’un giveaway publié | aucun `message_id` existant | Prêt à connecter |
| Suppression physique / édition du message Discord | aucun `message_id` existant | Prêt à connecter |
| Conditions de participation avancées | champ `requirements` texte non interprété | Prêt à connecter |

La table existante ne possède pas de `message_id`; le bot envoie donc le résultat dans le salon à la fin sans modifier le message initial. Les entrées sont uniques par `(giveawayId, userId)` et persistent après redémarrage.

---

## Suggestions — état réel

| Fonctionnalité | Source | État |
|---|---|---|
| Activation / salons | `suggestions_enabled`, `suggestions_channel_id`, `suggestions_approval_channel_id` | Opérationnelle |
| État / compteurs | table Supabase existante `suggestions` | Opérationnelle |
| Votes uniques et changement de vote | Mongo `SuggestionVote` | Opérationnelle |
| Publication | `/suggestion proposer` | Opérationnelle |
| Accepter / refuser / archiver / supprimer | boutons staff `ManageGuild` | Opérationnelle |
| Réponse staff | `/suggestion repondre` + `staff_response` | Opérationnelle |
| Logs | `log_moderation_channel_id` | Opérationnelle |
| Mise à jour du message Discord après redémarrage | aucun `message_id` persistant | Partiellement fonctionnelle |
| Catégories | aucun champ canonique | Prêt à connecter |

Les colonnes `staff_response` et `archived_at` sont ajoutées de façon idempotente au script Supabase. Les boutons utilisent l’ID de suggestion persistant, ce qui permet aux votes de continuer après redémarrage tant que le message Discord existe.

---

## Captcha — état réel

| Fonctionnalité | Champ / source | État |
|---|---|---|
| Activation | `captcha_enabled` | Opérationnelle |
| Panneau staff | `/captcha panel` | Opérationnelle |
| Vérification bouton | `captcha_verify` | Opérationnelle |
| Attribution rôle | `captcha_role_id` | Opérationnelle si le bot peut gérer le rôle/membre |
| Double vérification | cache rôles Discord | Opérationnelle |
| Rappel nouveau membre | DM vers `captcha_channel_id` | Opérationnelle, best effort |
| Logs succès / échec | `log_moderation_channel_id` | Opérationnelle |
| Expiration / sanction non vérifié | aucun champ canonique | Prêt à connecter |
| Retrait rôle non vérifié | aucun champ canonique | Prêt à connecter |
| Image/texte captcha | `captcha_type` non implémenté côté bot | Prêt à connecter |

Le rôle `captcha_role_id` est actuellement le rôle attribué après vérification. Aucun rôle de pré-vérification n’est supprimé car le contrat n’en définit pas.

---

## Temporary Voice — état réel

| Fonctionnalité | Source | État |
|---|---|---|
| Activation / catégorie | `temp_voice_enabled`, `temp_voice_category` | Opérationnelle |
| Salon générateur | `temp_voice_creator_channel_id` | Opérationnelle |
| Création et déplacement | `voiceStateUpdate` | Opérationnelle |
| Un salon par propriétaire | Mongo `TemporaryVoice` | Opérationnelle |
| Suppression salon vide | `voiceStateUpdate` | Opérationnelle |
| Nettoyage après redémarrage | `ready` + Mongo | Opérationnelle |
| Logs création/suppression | `log_moderation_channel_id` | Opérationnelle |
| Nom configurable | aucun champ canonique | Prêt à connecter |
| Limite utilisateur | aucun champ canonique | Prêt à connecter |
| Permissions privées avancées | aucun champ canonique | Prêt à connecter |

Le modèle Mongo `TemporaryVoice` contient guildId, channelId, ownerId et categoryId. Il évite plusieurs salons simultanés pour un même propriétaire et permet de nettoyer les salons orphelins après redémarrage.

---

## Audit synchronisation Dashboard ↔ Bot

### Synchronisés par le contrat `guild_configs`

Welcome, Tickets, Logs, AutoMod, Security, Invitations, XP, Giveaways activation, Suggestions activation, Captcha, Temporary Voice, Settings et Language utilisent les mêmes noms canoniques dans les types React, les defaults dashboard, le script Supabase et `bot/src/services/guildConfig.js`.

Le `GuildContext` React actif charge/sauvegarde désormais la ligne Supabase `guild_configs` par `guild_id`. Le bot lit la même ligne avec un cache mémoire de cinq minutes.

### Limites connues

- La découverte des guilds, salons, rôles et présence bot dans le dashboard actif reste simulée/localisée ; il n’existe pas encore d’endpoint dashboard authentifié pour ces métadonnées Discord.
- L’endpoint bot `POST /api/guilds/:guildId/sync` invalide le cache mais n’a pas encore d’authentification ; le dashboard ne l’appelle pas.
- Giveaways et Suggestions conservent leurs données dans leurs tables Supabase, mais le dashboard actif affiche encore des données de démonstration faute d’un endpoint sécurisé de lecture.
- Moderation, Analytics, Backup et Embed Builder ne possèdent pas encore de contrat de données bot complet.

---

## Audit v1.0 — état de production

### Vérifications passées

- `npm run lint` dashboard actif : OK
- `npm run build` TypeScript/Vite : OK
- `node --check` sur les 70 fichiers JavaScript bot : OK
- `npm audit --omit=dev` bot avec lockfile : 0 vulnérabilité connue au moment de l’audit
- Contrat canonique : aucun ancien nom actif détecté dans les modules React ou services bot.

### Risques à traiter avant exposition publique

| Risque | État |
|---|---|
| RLS Supabase `Allow all operations` dans la migration | Critique : à restreindre selon l’identité/guild avant production publique |
| `POST /api/guilds/:guildId/sync` non authentifié | Élevé : ne pas exposer publiquement avant middleware API_SECRET/JWT |
| `API_SECRET` par défaut autorisé par config | Élevé : définir une valeur forte et faire échouer le boot en production si absente |
| Découverte dashboard de guilds/salons/rôles simulée | Élevé fonctionnel : intégrer une API authentifiée Discord/bot |
| Ancienne structure TanStack/React Start conservée | Moyen : non active Vite, à migrer/supprimer dans une tâche dédiée |
| Counting channel hardcodé et intervalles non stoppés explicitement | Moyen : isoler avant scale horizontal |
| Cache config bot TTL 5 min | Moyen : synchronisation non instantanée sans endpoint sécurisé |

### Modules synchronisés

Welcome, Tickets, Logs, AutoMod, Security, Invitations, XP, Giveaways, Suggestions, Captcha et Temporary Voice lisent le contrat canonique `guild_configs` côté bot. Le dashboard actif persiste désormais ses sauvegardes dans la même table.

### Modules partiels ou non reliés

Moderation history, Analytics, Backups, Embed Builder, metadata Discord dynamique, localisation complète et données dashboard réelles des giveaways/suggestions restent des travaux v1.1.

---

## QA pré-production — résultats statiques

| Contrôle | Résultat |
|---|---|
| Commandes chargées | 23, noms uniques |
| Événements enregistrés | 22, un listener par nom |
| Syntaxe JavaScript bot | 70 fichiers OK |
| Lint dashboard actif | OK |
| Build TypeScript/Vite | OK |
| `npm audit --omit=dev` bot | 0 vulnérabilité connue |
| Champs canoniques hérités actifs | Aucun détecté |

Les tests Discord/Supabase/MongoDB réels restent obligatoires dans une guild de test : le checkout ne contient pas de secrets de production et aucun appel vers les services réels n’a été exécuté.

---

## Diagnostic commandes 17/23 et doublons

Le commit Arena `799b5b4` contient 23 fichiers dans `bot/src/commands` et le loader charge 23 commandes lorsqu’il exécute ce dossier. Si un hébergement affiche 17, il exécute un dossier bot ancien ou une branche/archive différente ; le loader générique ne filtre aucun des six nouveaux fichiers.

`deploy.js` utilise `Routes.applicationCommands`, dont le PUT remplace toute la liste globale. Les doublons Discord ne peuvent donc pas venir de deux listes globales de ce même script ; ils correspondent à des commandes guild-scoped historiques ou à une autre application. Pour une guild de test, définir temporairement `LEGACY_GUILD_ID`, exécuter `npm run deploy` pour vider les commandes guild héritées, puis retirer la variable. Le loader logue désormais le chemin scanné et le nombre de fichiers trouvés afin de diagnostiquer le répertoire réellement lancé.

---

## Synchronisation immédiate cache configuration

Après chaque `upsert` dashboard réussi, le `GuildContext` appelle facultativement `POST /api/guilds/:guildId/sync` si `VITE_BOT_API_URL` est défini. Le dashboard transmet uniquement le bearer token de la session Supabase active ; aucun secret bot/API n’est exposé au navigateur. L’API bot valide le token avec Supabase, invalide seulement la clé cache de cette guild puis recharge immédiatement sa configuration.

| Élément | État |
|---|---|
| Sauvegarde Supabase | Opérationnelle |
| Invalidation ciblée `guildId` | Opérationnelle |
| Rechargement cache immédiat | Opérationnelle |
| Auth bearer Supabase sur endpoint | Opérationnelle |
| Fallback TTL 5 min sans `VITE_BOT_API_URL` | Opérationnel |

Configuration dashboard nécessaire pour l’instantané : `VITE_BOT_API_URL=https://api-bot.example.com` (URL publique non secrète du bot). L’endpoint ne modifie aucune donnée ; il ne fait que recharger le cache ciblé.

---

## Synchronisation cache — contrôles d’accès

`POST /api/guilds/:guildId/sync` applique désormais les contrôles suivants avant toute invalidation :

| Contrôle | Réponse en échec |
|---|---|
| Bearer Supabase valide | 401 |
| Guild Discord connue du bot | 404 |
| Utilisateur membre de la guild | 403 |
| `Administrator` ou `ManageGuild` | 403 |
| Maximum 20 sync / utilisateur / 15 min | 429 |

Un cooldown par guild de 8 secondes coalesce les sauvegardes rapprochées. La première recharge immédiatement. Les suivantes retournent 202 et planifient un unique rechargement ciblé qui relit la dernière ligne Supabase. Aucun token, secret ou configuration complète n’est écrit dans les logs.

---

## Migration Dashboard → Bot API (pré-RLS)

Les endpoints autorisés suivants sont désormais le chemin production pour `guild_configs` :

| Endpoint | Action |
|---|---|
| `GET /api/guilds/:guildId/config` | lecture autorisée de la configuration |
| `PUT /api/guilds/:guildId/config` | écriture whitelistée et rechargement cache |
| `POST /api/guilds/:guildId/sync` | invalidation/rechargement ciblé |

Tous vérifient token Supabase, membre Discord et `Administrator`/`ManageGuild`. Le `PUT` n’accepte que les clés canoniques de `guild_configs`; les clés inconnues sont refusées. Le client bot privilégie `SUPABASE_SERVICE_ROLE_KEY` côté serveur et conserve un fallback anon uniquement pour compatibilité contrôlée tant que RLS permissif existe. Avant le durcissement RLS, définir `VITE_BOT_API_URL` dans le dashboard et `SUPABASE_SERVICE_ROLE_KEY` uniquement sur Bot-Hosting.

Le `PUT /api/guilds/:guildId/config` applique une allow-list des clés canoniques et valide types, IDs Discord, enums, bornes numériques, tailles texte et structures de récompenses avant toute écriture Supabase. Les clés inconnues ou valeurs invalides retournent 400.

---

## RLS strict — prérequis production

La migration supprime toutes les policies existantes sur `guild_configs`, `giveaways`, `suggestions` et `tickets`, puis révoque les privilèges `anon`/`authenticated`. Aucune policy `USING (true)` ou `WITH CHECK (true)` n’est conservée. Le bot doit avoir `SUPABASE_SERVICE_ROLE_KEY` sur Bot-Hosting ; il refuse désormais de démarrer sans cette clé. Le dashboard doit avoir `VITE_BOT_API_URL` et passe exclusivement par l’API Bot autorisée pour la configuration. Tester la migration dans une instance Supabase de test avant application production est obligatoire.

---

## Métadonnées Discord production

| Endpoint | Vérifications | Données |
|---|---|---|
| `GET /api/discord/guilds` | session Supabase + token Discord correspondant à l’identité | guilds owner/Admin/ManageGuild, présence bot |
| `GET /api/guilds/:guildId/metadata` | session, membre Discord, Administrator/ManageGuild | salons, catégories, rôles, emojis, permissions |

Le dashboard ne conserve pas le token provider Discord au-delà de la session Supabase et ne le journalise pas. Les métadonnées sont récupérées uniquement après autorisation Bot API.

---

## Diagnostic guilds Discord

`GET /api/discord/guilds` journalise sans secret : token provider présent (booléen), nombre brut Discord, nombre après filtre owner/Admin/ManageGuild, nombre après présence bot et nombre final. La réponse finale ne contient que les guilds administrables où CIVRAT est dans le cache du bot. Le dashboard affiche une erreur avec retry si l’API, la session ou le token provider échoue au lieu de masquer l’échec comme `0 serveur`.

---

## OAuth Discord — token provider

Le callback dashboard échange explicitement le code PKCE avec `exchangeCodeForSession` et capture `provider_token` uniquement en mémoire. `getSession()` ou un refresh token peut ne pas restituer ce token provider : c’est attendu et la découverte guilds demande alors une nouvelle autorisation Discord. `VITE_AUTH_DEBUG=true` active des logs sûrs (présence/longueur uniquement, jamais valeur token). L’API `/api/discord/guilds` journalise aussi les compteurs de filtre sans token.

---

## Callback OAuth PKCE et implicite

Le callback accepte `?code=` (PKCE) et `#access_token=...&refresh_token=...` (implicite historique). Le token provider Discord est capturé avant suppression du fragment URL, utilisé uniquement pour la découverte guilds, puis retiré du stockage transitoire. Les logs debug ne contiennent jamais les valeurs des tokens.

---

## Endpoints métadonnées Discord

| Endpoint | État | Données |
|---|---|---|
| `/api/guilds/:guildId/overview` | Opérationnel | serveur, bot, uptime, ping, boosts, compteurs cache |
| `/api/guilds/:guildId/stats` | Opérationnel | membres, humains, bots, salons, rôles, emojis, boosts, tickets, giveaways |
| `/api/guilds/:guildId/channels` | Opérationnel | salons texte/vocal/forums/threads |
| `/api/guilds/:guildId/categories` | Opérationnel | catégories Discord |
| `/api/guilds/:guildId/roles` | Opérationnel | rôles non gérés |
| `/api/guilds/:guildId/emojis` | Opérationnel | emojis guild |
| `/api/guilds/:guildId/members` | Opérationnel | pagination membres réels |
| `/api/guilds/:guildId/settings` | Opérationnel | config canonique autorisée |
| `/api/guilds/:guildId/logs` | 501 volontaire | historique persistant non encore stocké |

Les selects de configuration migrés utilisent le metadata context dynamique. Les statistiques dashboard métier restantes doivent consommer les endpoints dédiés plutôt que les données mock dans une phase UI dédiée.
