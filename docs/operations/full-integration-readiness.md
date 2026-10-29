# Intégration complète Arena — prérequis et procédure de revue

Ce document accompagne le candidat dérivé de `8569b0284be194dc0c82089bdd6f506e9e200b4e`.
Il ne déclenche aucun déploiement, appel Discord, accès Supabase ou migration.
Une décision READY FOR MERGE n'est pas une certification de production.

## 1. Runtime et dépendances

- Minimum effectif : **Node >=22.0.0**, également déclaré dans package.json.
  Utiliser une version Node 22 maintenue et testée sur l'hébergement. Le SDK
  Supabase verrouillé en 2.111.0 exige Node 22 ; l'ancien minimum 18.17 était
  incohérent, indépendamment des correctifs de sécurité.
- Installer avec le lockfile : `npm ci --ignore-scripts`. La validation de ce
  candidat n'a exécuté aucun lifecycle de dépendance. Ne pas régénérer le lock
  sur le serveur et ne pas utiliser `npm audit fix` comme procédure de release.
- Canvas 1.0.9 utilise des paquets natifs optionnels : conserver celui de
  l'OS/architecture/libc du conteneur. Une installation avec omission des
  dépendances optionnelles peut casser le rendu. Vérifier import, décodage et
  rendu sur l'image Pterodactyl choisie, sans lancer le bot pour ce contrôle.
- Les overrides exacts de sécurité sont intentionnels : proxy-addr 2.0.8,
  body-parser 1.20.9, qs 6.16.1, engine.io 6.6.10, undici 6.29.1.
  Express 4.22.3 accepte qs ~6.16.0 ; ne pas revenir à Express 4.22.2 tout en
  forçant qs hors de sa plage ~6.15.1. Réévaluer ces pins lors d'une mise à jour
  future, avec revue du lock, audit et tests, plutôt que les retirer aveuglément.

### Exposition aux avis de sécurité

| Paquet | Chaîne | Chemin CIVRAT et limites de l'analyse |
|---|---|---|
| proxy-addr | Express -> proxy-addr | Aucun import/serveur Express trouvé dans le code de production suivi ; l'attaque de trust proxy IPv4/IPv6 n'est pas démontrée comme accessible. Ne jamais activer trust proxy sans topologie de proxy vérifiée. |
| body-parser | Express -> body-parser | Même absence de serveur Express identifié ; avis DoS sur corps compressé. Correction conservée pour éviter d'expédier la version vulnérable. |
| qs | Express et body-parser -> qs | Aucun appel direct de production trouvé ; risques de parsing/bracket/comma/stringify conditionnels. Parseur imbriqué et protections de prototype exercés hors réseau. |
| engine.io | Socket.IO -> Engine.IO | Aucun serveur Socket.IO trouvé dans le code de production suivi. Vérification ajoutée du refus d'une session utilisant une autre révision de protocole, sans socket. |
| undici | discord.js et @discordjs/rest -> undici | Chaîne effectivement chargée par le bot et la maintenance. Les scénarios TLS, WebSocket, EventSource et retry des avis ne sont pas tous prouvés accessibles ; mise à jour conservée car le client HTTP est utilisé. |

Cette analyse statique n'exclut pas une intégration externe ou un lancement
hors de l'arbre étudié. Zéro alerte npm signifie zéro avis connu renvoyé au
moment du contrôle, pas absence universelle de vulnérabilités.

## 2. Contrat Supabase

Les identifiants Discord restent des **textes**, jamais des nombres JS/SQL
flottants. Les lectures/écritures par guilde doivent utiliser le guild_id du
contexte authentifié, non une clé choisie par l'utilisateur. La table
`public.guild_configs` doit posséder une clé unique/PK sur `guild_id text`.
Les autres colonnes historiques sont décrites dans
[le schéma V1](../architecture/supabase-schema-v1.md).

| Colonne | Type et défaut attendus | Origine / usage |
|---|---|---|
| automod_exempt_roles | text[] NOT NULL DEFAULT '{}'::text[] | Nouveau depuis main ; IDs des rôles exemptés |
| automod_exempt_channels | text[] NOT NULL DEFAULT '{}'::text[] | Nouveau depuis main ; IDs des salons exemptés |
| welcome_image_key | text NULL, défaut NULL | Nouveau depuis main ; clé `{guildId}/welcome.png`, validée et isolée par guilde |
| welcome_image_enabled | boolean, défaut applicatif false | Toggle déjà consommé dans main ; le schéma documentaire ancien l'omettait. Une valeur NULL est traitée comme désactivée. |

Les nouveaux champs d'exemption ont un défaut de lecture vide ; cela ne rend
pas une écriture possible si les colonnes manquent. Une colonne manquante peut
faire échouer l'upsert complet. L'upload d'image précède l'écriture de sa clé :
une erreur de schéma peut donc laisser un objet stocké sans référence utilisable.
Aucune suppression automatique de cet objet n'est prescrite ici.

### DDL à revoir, jamais auto-exécutée

[review-full-integration-schema.sql](review-full-integration-schema.sql) est une
proposition **additive et transactionnelle**, non exécutée. Elle ajoute les
colonnes absentes, sans toucher aux valeurs existantes. Elle refuse des types
ou contraintes incompatibles plutôt que convertir/backfiller silencieusement.
Les quatre ajouts comprennent les trois champs nouveaux et le toggle
préexistant, uniquement s'il manque. Aucun DROP ni UPDATE de données.

Ordre d'une future intervention séparément autorisée :

1. Relever le schéma, contraintes, défauts et politiques réels avec un DBA ;
   vérifier aussi les migrations historiques Tickets/entitlements si nécessaires.
2. Comparer la proposition au réel ; inspecter explicitement les défauts des
   tableaux (tableau vide), les éventuels NULL et la PK de guild_id. Si un
   champ existe avec un autre type/default, arrêter et décider de son évolution.
3. Sauvegarder ; essayer la DDL sur un projet jetable équivalent ; vérifier
   conservation des données, idempotence et comportement des deux guildes.
4. Appliquer uniquement après un GO de migration distinct. Faire rafraîchir le
   cache de schéma PostgREST par la procédure Supabase appropriée si nécessaire.
5. Ne pas supprimer les colonnes ajoutées en cas de retour au code précédent :
   l'additivité permet de les conserver. Aucun rollback destructif automatique.

Ni l'état de production, ni le schéma, ni les politiques n'ont été lus pendant
la préparation hors ligne. Aucun succès de migration n'est revendiqué.

## 3. RLS, privilèges et isolation

- `public.guild_configs` doit être couvert par RLS et des grants minimaux.
  Pour ce déploiement serveur, aucune policy générale de lecture/écriture pour
  `anon` ou `authenticated` ne doit exposer les guildes. Examiner les policies
  existantes avant de les modifier ; une policy permissive large existante ne
  devient pas restrictive en ajoutant simplement une policy `false`.
- La clé serveur service_role contourne RLS. RLS ne prouve donc **pas**
  l'isolation lorsque le bot l'utilise : celle-ci dépend des permissions du
  routeur, du contexte guild_id, des filtres de repository, des clés de stockage
  et des tests cross-guild. Les scans opérateur multi-guildes restent privilégiés.
- L'identité Discord n'est pas automatiquement un JWT Supabase. Ne pas inventer
  une policy `auth.uid() = guild_id` : ce sont des identités distinctes. Un accès
  navigateur direct nécessiterait un modèle de membership séparé et validé ;
  aucun accès direct de cette nature n'est ajouté ici.
- Le runtime préfère supabaseAdmin mais peut retomber sur un client anon si
  seule une configuration anon est fournie. Cela ne garantit PAS les droits
  pour le bucket privé ; ne pas ouvrir RLS pour contourner cet échec.
- Stocker les credentials uniquement dans le gestionnaire de secrets serveur ;
  jamais dans Git, cette documentation, le navigateur ou start.local.sh.

Contrôles futurs sur projet de test, jamais effectués ici : accès anon et
JWT ordinaire refusés ; opérations serveur permises ; guilde A incapable de
lire, écraser, supprimer ou sélectionner les données/objets de B via les
interfaces applicatives. Le fait qu'un client service_role puisse techniquement
accéder à toutes les lignes doit être inclus dans le modèle de menace.

## 4. Storage Welcome

- Bucket exact : **civrat-welcome-images**, `public = false`.
- Objets image : `{guildId}/welcome.png`, clé dérivée par le serveur. Le suffixe
  est déterministe mais les octets ne sont pas systématiquement reconvertis en
  PNG : le code stocke le buffer original et son contentType accepté.
- Formats d'upload applicatifs : image/png, image/jpeg, image/webp, image/avif,
  image/gif. Des limites MIME du bucket doivent rester compatibles avec cette
  liste. Ajuster sa limite d'octets à la politique approuvée ; l'application
  utilise attachmentSizeLimit de Discord et valide signatures/dimensions.
- Métadonnée historique voisine : `{guildId}/welcome.json`. Le mode personnalisé
  actuel ne l'utilise plus pour ajouter un avatar ; un remplacement tente de la
  supprimer. Prévoir le droit DELETE serveur. Si des outils historiques écrivent
  encore du JSON, revoir séparément leurs MIME/droits ; ne pas rendre le bucket
  public et ne pas lancer une purge globale.
- Permissions attendues côté serveur : lecture, insert/update (upsert) et delete
  des objets du bucket. Aucun accès général anonyme/authenticated au bucket via
  les policies de `storage.objects`. Pas de getPublicUrl pour contourner RLS.
- L'isolation applicative vérifie forme et préfixe guild_id des clés, refuse une
  référence étrangère et invalide le cache après remplacement. La clé privilégiée
  contourne les policies Storage : les tests RLS réels restent indispensables.
- Vérifier sur projet de test privé : formats acceptés, upload/remplacement,
  relecture, reset/suppression autorisée, clés étrangères refusées, cache et
  absence d'URL publique. Ces opérations nécessitent une autorisation distincte.

## 5. Pterodactyl et maintenance

1. Choisir une image Node 22 compatible avec les dépendances natives ; conserver
   le lockfile et les dépendances optionnelles Canvas de la plateforme.
2. Vérifier le volume et sauvegarder hors conteneur les réglages d'exploitation.
   Un egg réinstallant tout le volume peut supprimer start.local.sh.
3. Le démarrage normal doit aboutir à `bash start.sh start` (ou mode start
   explicitement configuré). `npm start` appelle index.js et ne lit pas les
   réglages de maintenance du wrapper start.sh : ne pas confondre les chemins.
4. `start.local.sh`, si utilisé, est du Bash opérateur de confiance, ignoré par
   Git : MODE=start, cibles vides et MAINTENANCE_ARGS sans options d'application
   pour le fonctionnement normal. Aucun secret dans ce fichier.
5. DEPLOY_COMMANDS=1 ne publie plus au démarrage. Le déploiement des commandes est
   une opération distincte documentée dans [command-maintenance.md](command-maintenance.md).
   Les anciens appels sans cible explicite ne sont plus une procédure valide.
6. Les modes list/clear/deploy sont ponctuels, ne lancent pas le bot ensuite et
   ne doivent pas être laissés dans une boucle de redémarrage. Revoir preview,
   scopes, confirmation et validation avant un GO séparé ; retirer les flags
   d'application et restaurer start après l'opération.
7. `/admin` reste uniquement dans la guilde technique configurée. Préparer un
   inventaire des registrations existantes et un retour arrière contrôlé ;
   jamais de clear global implicite ni déplacement de /admin pour simplifier.

Cette préparation ne démarre pas Pterodactyl ni le bot et ne publie aucun payload.

## 6. CAPTCHA et ancienne destination Security

Le retrait CAPTCHA des 40 commits est conservé. `/captcha`, ses panneaux,
handlers, service et section de paramètres ne sont plus fournis. Ne plus compter
sur ce parcours pour filtrer les nouvelles arrivées. Les rôles/données historiques
ne sont pas automatiquement révoqués ou effacés. Prévoir le retrait manuel
approuvé des anciens panneaux et commandes encore enregistrées dans Discord.
Le catalogue final contient 22 commandes globales plus `/admin` technique,
avec `/welcomeimage` et sans `/captcha`.

Conserver les colonnes historiques `captcha_enabled`, `captcha_channel_id`,
`captcha_role_id` et `security_log_channel_id`. Elles ne doivent plus être
écrites comme réglages actifs. Les alertes Security passent par les Logs
centraux, catégorie modération : vérifier logs_enabled, destination
log_moderation_channel_id, permissions du bot et View Audit Log lorsque requis.
Aucun transfert ou effacement automatique de données n'est proposé.

## 7. Portée de la validation

La suite hors ligne vérifie les contrats avec doubles, pas Supabase, Discord,
Storage ou Pterodactyl en production. Deux tests HTTP Welcome « Flux réel »
restent exclus explicitement par `--test-skip-pattern=^Flux` pour ce fichier ;
la sélection doit être prouvée (24 autres cas), pas déduite d'un filtre négatif.
Toute publication, migration réelle, recette externe ou fusion nécessite un GO
explicite distinct. Aucun protocole HTTP réel ni secret n'est requis pour la
qualification locale de ce candidat.
