# Phase 4 — maintenance des commandes Discord

Aucune exécution réelle n'a été réalisée pour valider cet outil. Les tests REST
sont simulés. CAPTCHA demeure hors V1. Ne pas exécuter les exemples sans GO réel.

## Interface opérateur

`node deploy.js <list|clear|deploy> <cibles> [--apply --confirm EMPREINTE]`

Cibles explicites et combinables : `--global`, `--guild ID` (répétable),
`--all-guilds`. Aucun défaut implicite. Les anciennes syntaxes à ID positionnel
sont refusées. `npm run deploy` sans cibles échoue sans requête Discord.

Exemples de **simulation** :

```
node deploy.js list --global --all-guilds
node deploy.js clear --global --all-guilds
node deploy.js deploy --global --all-guilds
```

L'inventaire des guildes utilise `/users/@me/guilds`, paginé par 200,
avec le token bot. Les identifiants restent des chaînes. Une découverte ou
lecture incomplète bloque toutes les écritures. Les permissions effectives
sont celles de l'API pour le token/application ; 403, 429 et erreurs réseau
ne sont jamais convertis en succès. Pas de token dans le rapport.

La simulation retourne une empreinte SHA-256 liée à l'application, aux cibles,
à l'action, au catalogue souhaité et à l'inventaire. Après revue, répéter la
même commande avec `--apply --confirm EMPREINTE`. Un inventaire différent
nécessite une nouvelle simulation. Chaque portée est encore relue juste avant
son PUT ; Discord ne fournit pas ici de transaction conditionnelle atomique.

## Sémantique

- CLEAR : vide uniquement les collections de commandes d'application ciblées.
  Avec toutes les cibles, `/admin` est également retiré : fenêtre d'indisponibilité
  à prévoir jusqu'au DEPLOY autorisé suivant.
- DEPLOY : remplace le catalogue global par les 22 commandes actuelles ;
  la guilde technique reçoit uniquement `/admin` ; les autres guildes ciblées
  reçoivent un catalogue vide, pour éliminer les copies historiques.
- LIST : lecture uniquement, même avec `--apply`.
- Les cibles non sélectionnées restent inchangées. Pour une réconciliation
  complète, sélectionner explicitement global et toutes les guildes ; vérifier
  que la guilde technique fait partie de l'inventaire ou la cibler explicitement.
- Les seules écritures sont des PUT de collections de commandes. Aucun salon,
  rôle, membre, message ou donnée serveur n'est modifié.

Le rapport JSON distingue global/guildId, inventaire avant, catalogue souhaité,
PUT réalisé et relecture après. `ok:false` ou code de sortie 1 signale un blocage
ou un échec partiel. Une portée échouée n'empêche pas les autres portées de
terminer ; aucune annulation automatique. Le résultat par portée fait foi.
La vérification compare le schéma writable (options/localisations comprises),
pas seulement le nombre. Des valeurs par défaut ajoutées par Discord peuvent
nécessiter une normalisation supplémentaire : un écart produit un échec visible.

## Nettoyage CAPTCHA

Repérer `captcha` dans les inventaires globaux et guildes. Une réconciliation
DEPLOY des portées concernées le retire sans réintroduire de handler.
Relecture REST puis vérification client sont nécessaires ; l'affichage Discord
peut être mis en cache. Ne pas déclarer ce nettoyage réalisé sur la seule base
des tests locaux.

## Compatibilité et limites

Le déploiement automatique au démarrage (`DEPLOY_COMMANDS=1`) est neutralisé :
un avertissement renvoie à cette procédure explicite. Les anciens helpers d'écriture exportés sont désormais soumis au même service :
simulation par défaut et application avec empreinte. Le nettoyage implicite
LEGACY_GUILD_ID est désactivé (appel refusé). Aucun lanceur ne les appelle.
Pas de reprise automatique ni de rollback multi-portées. Conserver le rapport
avant d'appliquer ; limiter les accès au rapport (IDs et métadonnées de commandes).

## Pterodactyl : démarrage et maintenance séparés

Le champ « Start bash file » reste `start.sh`. Le démarrage par défaut est
`MODE="start"` : il charge uniquement le bot. Pour une opération ponctuelle,
configurer le script (sans toucher aux secrets) :

```bash
MODE="clear"
GUILD_ID=""
MAINTENANCE_ARGS=(--all-guilds)
```

Cela **simule** le nettoyage des guildes, sans toucher au global. Ajouter
`--global` dans le tableau pour inclure explicitement le global. Pour une seule
guilde, utiliser `GUILD_ID="<identifiant valide>"` ou `--guild ID`.
Un GUILD_ID vide est donc normal pour les autres cibles. Sans aucune cible,
la maintenance est refusée. Ne pas utiliser de chaîne d'arguments ni `eval`.

Si l'hébergeur transmet les arguments après le nom du fichier :

```
start.sh list --global --all-guilds
start.sh clear --all-guilds
start.sh deploy --global --all-guilds --guild <guilde-technique>
```

Un mode seul (ex. `start.sh clear`) conserve les cibles configurées. Dès que
des options suivent le mode, elles remplacent les cibles configurées.
`start.sh start` ignore les options de maintenance persistées.
La chaîne est `start.sh → start.js → deploy.main(argv) → maintenanceCli`.
Les anciennes syntaxes positionnelles `deploy ID` et `clear ID` sont refusées.

Après revue d'une simulation et **GO d'application distinct**, reprendre la même
sélection avec `--apply --confirm EMPREINTE`. Ne pas laisser ce mode appliqué dans
la configuration de démarrage. Restaurer ensuite MODE="start" et vider le tableau.

La maintenance affiche le bilan JSON puis **termine sans connecter le bot**.
Code de sortie 0 : lecture/simulation valide ou application vérifiée ; code 1 :
arguments invalides, confirmation refusée, découverte incomplète ou échec partiel.
Prévoir une fenêtre de maintenance : le bot n'est pas démarré par cette opération.
Désactiver la relance automatique de l'hébergeur pour cette exécution ponctuelle,
sinon il peut répéter le mode au lieu de démarrer normalement.

Chaque cible expose `role` (global/technical/ordinary), `stage`, `written`,
`before`, `desired`, puis `after` si relu. `error.stage` distingue inventory,
preflight, write, readback et schema. `ok:false` avec `written:true` signifie
qu'une écriture a pu réussir malgré l'échec de validation : ne pas la présenter
comme un échec total ni relancer aveuglément. Aucun diagnostic ne prétend
identifier rétroactivement la cause du précédent échec Pterodactyl.

La validation réelle doit commencer par LIST puis simulation seulement, après
accord. Le retrait d'anciennes commandes (dont CAPTCHA) reste une application
séparée, explicitement approuvée et vérifiée. Aucune correction MongoDB/Supabase
n'est incluse ici.

## Correctif du lancement CLEAR sans cible

`MODE="clear"`, `GUILD_ID=""` et `MAINTENANCE_ARGS=()` ne sélectionnent aucune
portée. Le refus est volontaire : il ne faut jamais interpréter l'absence de
cible comme « tout supprimer ». Le lanceur contrôle maintenant ces arguments
avant de charger le déploiement ou d'appeler REST ; il affiche un diagnostic de
configuration (code 1), pas une erreur fatale générique du bot.

Pour conserver les cibles sur l'hébergement sans éditer le script versionné,
copier `start.local.example.sh` vers **`start.local.sh`**, fichier ignoré par Git,
puis adapter explicitement :

```bash
MODE="clear"
GUILD_ID=""
MAINTENANCE_ARGS=(--all-guilds)
```

C'est une simulation des guildes uniquement. Ajouter `--global` pour inclure
les commandes globales. Le champ Pterodactyl reste `start.sh`, ou `start.sh clear`
si l'egg transmet les arguments. Le script charge sa configuration depuis son
propre répertoire, indépendamment du dossier courant. Un mode seul ne perd plus
les cibles enregistrées. Avec des options complètes dans le champ, par exemple
`start.sh clear --global`, ces options sont prioritaires sans fusion des cibles.

`start.local.sh` est du Bash de confiance : accès en écriture réservé à
l'opérateur, pas de secret, pas de contenu provenant d'un utilisateur Discord.
Il persiste entre démarrages sur un stockage conservé et n'est pas remplacé par
un simple checkout Git. Un egg qui réinstalle/efface tout le répertoire peut
néanmoins le perdre : sauvegarder sa configuration hors du conteneur et vérifier
la commande Startup effectivement exécutée. Aucun script ne peut garantir la
persistance face à un effacement du volume par l'hébergeur.

Pour revenir en ligne : utiliser **`start.sh start`**, ou remettre MODE="start"
dans la configuration et vider MAINTENANCE_ARGS. Les modes de maintenance restent
des processus ponctuels qui terminent ; ils ne démarrent pas le bot, même après
une simulation réussie. Ne pas les laisser en boucle de redémarrage automatique.
Aucune cible, confirmation ou application n'est ajoutée automatiquement.
