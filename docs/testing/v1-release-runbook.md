# Runbook de validation V1 — CIVRAT

> **Protocole préparé offline.** Les cases Discord/Supabase/Mongo ci-dessous ne
> sont pas considérées comme validées tant qu’un opérateur ne les a pas exécutées
> et consignées. Les tests automatisés ne déploient aucune commande et ne se
> connectent à aucun serveur Discord réel.

## 1. Préconditions

- Node.js `>= 18.17` ;
- installation reproductible avec `npm ci` ;
- intents Discord requis par les fonctions utilisées ;
- migrations Supabase et éventuelle persistance Mongo appliquées ;
- secrets définis uniquement dans l’environnement d’hébergement.

### Variables principales

| Variable | Nature | Usage |
| --- | --- | --- |
| `DISCORD_TOKEN`, `CLIENT_ID` | secrets/config requise | connexion et REST Discord |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | secrets/config persistance | configuration, entitlements, identité, audit |
| `CIVRAT_ADMIN_GUILD_ID` | ID Discord public | seule guilde de déploiement de `/admin` |
| `CIVRAT_ADMIN_CHANNEL_ID` | ID Discord public | seul salon où `/admin` et ses composants sont autorisés |
| `CIVRAT_ADMIN_ROLE_ID` | ID Discord public | rôle requis pour toutes les routes `/admin` |
| `CIVRAT_OWNER_ID` | ID Discord public | Owner CIVRAT initial si aucun Owner persisté |
| `OWNER_PANEL_MASTER_CODE` | secret | déverrouillage de la section Owner |
| `OWNER_TRANSFER_CODE` | secret | transfert Owner avec confirmation |
| `RECOVERY_MASTER_CODE`, `RECOVERY_EMAIL` | secrets/config Recovery | première étape du double facteur intégré |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | secrets/config SMTP | envoi du code Recovery temporaire |
| `MONGO_URI`, `MONGO_DB_NAME` | optionnel | persistance des données dynamiques concernées |
| `LEGACY_GUILD_ID` | optionnel | purge ciblée d’anciennes commandes Guild |

Une configuration incomplète doit échouer fermée. Aucun code, token ou mot de
passe ne doit apparaître dans un log, une capture, un `customId` ou Git.

## 2. Préparation des stockages

Appliquer les migrations approuvées dans l’ordre de leurs dépendances, notamment :

1. `guild_configs` et ses colonnes actuelles ;
2. RPC `increment_ticket_counter` ;
3. `tickets` ;
4. suggestions/votes et giveaways/entries ;
5. `guild_entitlements` ;
6. `analytics_events` ;
7. tables d’identité Owner, historique Premium et audit Admin utilisées par le
   runtime actuel.

Si RLS est active, utiliser la clé `service_role` ou des policies explicitement
approuvées. Une clé anon bloquée par RLS doit être traitée comme indisponibilité,
pas comme absence de données.

## 3. Contrôles offline obligatoires

```bash
npm ci --ignore-scripts
npm run check
# Campagne exhaustive : tous les fichiers *.test.js sous src/ et test/
mapfile -t files < <(find src test -type f -name '*.test.js' | sort)
node --test "${files[@]}"
git diff --check
```

Valider également :

- parsing de tous les JSON ;
- parité stricte FR/EN du core et des modules ;
- scan des secrets et fichiers sensibles ;
- catalogue exact de 22 commandes globales + `/admin` technique ;
- aucun fichier CAPTCHA modifié pour cette évolution.

## 4. Déploiement explicite des commandes

Le démarrage normal et le déploiement restent deux opérations distinctes.

```bash
npm run deploy
```

Le déployeur doit effectuer :

1. un PUT global contenant exactement les 22 commandes normales ;
2. un PUT Guild contenant uniquement `/admin`, vers
   `CIVRAT_ADMIN_GUILD_ID`.

Le PUT global retire les anciennes définitions `/ownerpanel` et `/recovery`.
Toute divergence du catalogue doit interrompre le déploiement avant réseau.

Pour une prévisualisation à propagation immédiate, un ID explicite sélectionne
un déploiement Guild à un seul PUT, sans toucher au catalogue global :

- une guilde normale reçoit uniquement les 22 commandes normales ;
- `CIVRAT_ADMIN_GUILD_ID` reçoit uniquement `/admin` ;
- aucune autre guilde ne peut recevoir `/admin`.

Procédure ciblée obligatoire :

```bash
node deploy.js list <guildId>
node deploy.js deploy <guildId>
# exécuter uniquement les contrôles ciblés prévus
node deploy.js list <guildId>
node deploy.js clear <guildId>
node deploy.js list <guildId>
```

Le `clear` ciblé ne touche jamais les commandes globales. Après nettoyage, une
guilde normale utilise de nouveau le catalogue global. Un ID explicitement
fourni mais invalide doit produire zéro appel REST et ne doit jamais déclencher
le déploiement de production par fallback.

## 5. Matrice de validation Discord réelle

Renseigner les IDs/noms réels dans le compte rendu d’exécution, pas dans Git.

### 5.1 Trois guildes de test non techniques

À répéter séparément sur **Test A**, **Test B** et **Test C** :

- [ ] les 22 commandes normales sont visibles ;
- [ ] `/admin`, `/ownerpanel` et `/recovery` sont absentes ;
- [ ] `/settings` affiche sept catégories non vides et les 13 fonctions ;
- [ ] bascule FR → EN → FR sans perte de section ;
- [ ] membre sans `Gérer le serveur` refusé proprement sur `/settings` ;
- [ ] essai Tickets Free complet ;
- [ ] tentative Premium sans entitlement : fonction visible, message FR/EN,
      lien `https://discord.gg/BA3aDFqtXr`, demande d’ouverture de ticket ;
- [ ] panne entitlement simulée/contrôlée : message « indisponible », distinct
      de « Premium requis » ;
- [ ] CAPTCHA vérifié selon son protocole dédié, sans régression.

### 5.2 Guilde technique

- [ ] `/admin` est visible ; `/ownerpanel` et `/recovery` sont absentes ;
- [ ] rôle correct + salon correct : dashboard éphémère ouvert ;
- [ ] rôle correct + mauvais salon : refus générique ;
- [ ] salon correct + rôle absent : refus générique ;
- [ ] aucun refus ne révèle guilde, salon, rôle, Owner, Premium ou backend ;
- [ ] guilds installées = données réellement présentes dans le cache Discord ;
- [ ] diagnostics/configuration distinguent disponible et indisponible ;
- [ ] Premium liste/activation/retrait/révocation + historique/audit ;
- [ ] utilisateur Admin non-Owner : aucun bouton/ contenu Owner ;
- [ ] vrai Owner avec rôle technique : fonctions Admin accessibles ;
- [ ] vrai Owner : mauvais `OWNER_PANEL_MASTER_CODE` ⇒ refus générique ;
- [ ] vrai Owner : bon code ⇒ section Owner ; aucun code réaffiché/loggé ;
- [ ] ajout/retrait d’identité Admin et transfert Owner exigent leurs
      confirmations ; transfert exige `OWNER_TRANSFER_CODE` ;
- [ ] Recovery intégré : réponse anti-oracle, e-mail temporaire, code single-use,
      élévation courte, transfert dédié et confirmation dédiée.

### 5.3 DM avec le bot

- [ ] `/admin` absent ;
- [ ] `/ownerpanel` et `/recovery` absentes ;
- [ ] les 22 commandes Guild-only ne sont pas proposées ;
- [ ] une ancienne interaction/composant rejoué ne révèle aucune donnée et
      échoue fermé.

## 6. Smoke tests fonctionnels complémentaires

- [ ] `/ticketpanel` envoie le panneau dans le salon d’invocation, jamais dans
      la catégorie ; création, claim, rename, ajout/retrait membre, fermeture,
      réouverture, transcript et suppression ;
- [ ] personnalisation Ticket Premium active puis retour Free après révocation ;
- [ ] Welcome/Goodbye, image Premium, AutoRole, AutoMod, sécurité, TempVoice,
      giveaways, suggestions, logs, Analytics, XP et invitations ;
- [ ] persistance après redémarrage pour les stockages configurés ;
- [ ] démarrage normal sans PUT de commandes inattendu.

Références spécialisées :
`tickets-production-validation.md`, `welcome-image-production-validation.md`,
`captcha-production-validation.md`, `autorole-production-validation.md`,
`logs-production-validation.md`, `phase-3-real-environment-protocol.md`.

## 7. GO / NO-GO

**GO** uniquement si : contrôles offline verts, migrations vérifiées, 22+1
commandes aux bonnes portées, toute la matrice des quatre environnements cochée,
aucun secret détecté et aucun crash au redémarrage.

**NO-GO** si : `/admin` fuit hors guilde technique, une garde salon/rôle manque,
un backend indisponible est présenté comme zéro/Free, une fonction Settings ou
Premium disparaît, un secret apparaît, CAPTCHA régresse, ou une case réelle n’a
pas été exécutée.

Le compte rendu de release doit séparer explicitement résultats automatisés et
résultats Discord réels.
