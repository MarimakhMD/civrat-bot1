# Captcha / Vérification

État : **développement complet offline** (niveaux 1 à 5 livrés) — validation
Discord/Supabase réelle **non exécutée à ce jour** (voir
`docs/testing/captcha-production-validation.md`).

## Architecture

Services métier (aucun n'importe Discord.js) :

- `CaptchaConfigService` — lecture/écriture de la configuration par
  `GuildConfigResolver` ;
- `CaptchaPanelService` / `CaptchaPanelDeliveryService` — construction et
  publication du panneau officiel unique ;
- `CaptchaProvisioningService` — auto-réparation bornée des éléments
  (rôle non vérifié, rôle vérifié, salon) ;
- `CaptchaVerificationService` — vérification L1 (rôle configuré, existence,
  gestion, anti double attribution) ;
- `CaptchaReminderService` — DM de statut à l'arrivée ;
- `CaptchaSessionStore` — sessions en mémoire (une par `guild_id` + membre) ;
- `CaptchaChallengeService` — challenges serveur (génération et validation
  cryptographiques, historique anti-répétition) ;
- `captchaEntitlement` — décision `CAPTCHA_PREMIUM` fail-closed ;
- `runtime/createCaptchaRuntime` — arrivée de membre + réconciliation du
  panneau au démarrage ;
- `runtime/captchaLifecycleLogs` — pont d'émission des journaux de cycle de vie
  (voir « Logs » ci-dessous).

Le routage Discord passe par une seule route : le bouton
`civrat:v1:captcha:verify` (matcher `prefix`, permission-free) expose à la fois
le démarrage de session et les réponses de challenge
`civrat:v1:captcha:verify:<type>:<challengeId>:<index>` — aucune route
supplémentaire.

`src/services/captchaService.js` est un reliquat historique **non câblé** : ni
`interactionCreate` ni `/captcha` ne l'utilisent (verrou testé par
`CaptchaLegacyPanelMigration.test.js`).

## Configuration

Socle Free : `captcha_enabled`, `captcha_channel_id`, `captcha_role_id`.
Réglages de session (vue Avancé) : `captcha_expiry_minutes`,
`captcha_attempts`, `captcha_cooldown_seconds`.
Auto-réparation et panneau : `captcha_unverified_role_id`,
`captcha_force_existing`, `captcha_panel_channel_id`,
`captcha_panel_message_id`.
Niveaux (Premium) : `captcha_level`, `captcha_mode`, `captcha_challenge`.

Aucune nouvelle clé de configuration n'a été introduite par les niveaux 4 et 5.
Les colonnes correspondantes sont créées par migration manuelle côté
exploitant (aucun `.sql` n'est versionné dans ce dépôt) ; en l'absence de
colonne, la couche de configuration retombe sur le repli local documenté
(IDs de panneau en mémoire) sans jamais perdre la configuration existante.

Tout est géré depuis `/settings → Captcha` (ManageGuild, FR/EN) : activation,
salons, rôles, aperçu, réinitialisation, sous-vue Avancé (durée,
tentatives/cooldown, niveau, mode, challenge, force-existing).

## Niveaux, modes et challenges

| Niveau | Mode | Expiration | Tentatives | Cooldown |
| --- | --- | --- | --- | --- |
| LOW | bouton | 10 min | 5 | 5 s |
| NORMAL (défaut) | bouton | 5 min | 3 | 10 s |
| HIGH | challenge | 2 min | 3 | 30 s |
| RAID | challenge | 1 min | 2 | 60 s |

- Les niveaux HIGH/RAID et le mode challenge sont **Premium** : sans
  entitlement `CAPTCHA_PREMIUM` accordé, la sélection est refusée et la
  configuration n'est jamais écrite (fail-closed).
- Une configuration enregistrée reste la référence : le mode effectif d'une
  session est recalculé à chaque interaction, et un droit retiré en cours de
  session invalide la session de challenge sans consommer d'expérience Premium.
- Trois types de challenge existent (`CHOICE`, `ORDER`, `PICK`). Les réponses
  ne transitent jamais par le composant : seul un index est transmis, la
  validation est serveur.

## Sessions, tentatives et blocage

- Une session par `guild_id` + membre, en mémoire ; succès = terminal (session
  retirée), échec = cooldown puis nouvelle tentative.
- Cooldown, expiration et blocage proviennent des réglages configurés
  (`blocage = cooldown × tentatives`).
- Expiration : mesurée depuis la création et jamais prolongée tant que la
  prochaine tentative reste possible avant elle. Exception bornée (correctif
  RAID) : lorsque le cooldown atteint ou dépasse l'expiration en cours
  (RAID : 60 s de cooldown pour 1 min d'expiration), la session est prolongée
  d'**une** fenêtre d'expiration après la fin du cooldown — au plus une
  prolongation par tentative, tentatives elles-mêmes bornées. LOW/NORMAL/HIGH
  restent strictement inchangés (test de non-prolongation).
- P6 (rate-limit de création, 5 créations / 30 s / membre / serveur) et les
  protections anti double-clic, anti-rejeu et anti-bypass restent applicables
  sur les deux chemins (démarrage et réponse de challenge).

## Panneau et provisionnement

- Un seul panneau officiel par guilde : publier régénère l'ancien (suppression
  best-effort puis publication), et un delivery concurrent est refusé.
- IDs persistés en configuration ; repli mémoire si la colonne est absente.
- Auto-réparation **bornée** : seul un élément manquant est recréé (aucun autre
  salon, aucune autre permission, rôle créé repositionné sous le rôle du bot).
- `force-existing` est opt-in, borné à 1000 membres par exécution, best-effort
  par membre, sans bot ni sanction ; il ne s'applique qu'à des ajouts de rôle.
- Sécurité de l'état : la clé `captcha_force_existing` n'est activée qu'après
  une exécution réussie.

## Logs

Les journaux CAPTCHA réutilisent l'infrastructure Logs existante : catégorie
`moderation`, salon `log_moderation_channel_id`, rendu et traduction du
transport (`logs.captcha_*`). Aucun salon, aucune catégorie et aucun canal
dédié n'a été ajouté.

- `captcha_verified`, `captcha_verification_failed` — vérification (L1).
- `captcha_provision_failed` — un élément n'a pas pu être réparé (élément,
  code, rôle ou salon concerné) ;
- `captcha_panel_published` — panneau publié ou régénéré (`created` /
  `regenerated`, salon, message, rôle distribué) ;
- `captcha_force_existing` — exécution de l'action de masse (acteur et résumé
  réel).

Ces trois derniers événements sont émis en **best-effort** (une panne de
journalisation n'interrompt jamais le flux CAPTCHA) et **anti-spam** : une même
clé (guilde + élément + code, guilde + panneau, guilde + acteur) n'est
journalisée qu'une fois par fenêtre courte, en mémoire. Aucun état persistant
n'est créé.

## Durcissement pendant un raid (niveau 5)

Le CAPTCHA consomme l'état du moteur anti-raid **existant** (`SecurityRaidService`,
activé par `security_anti_raid`) en **lecture seule** : `check()` ne consomme
rien, les seuils et les décisions du moteur sont inchangés, et la fenêtre
glissante (5 arrivées / 15 s) fait retomber l'état toute seule.

- **Axe A — tous les serveurs, Free compris** : pendant un raid, les limites de
  session sont durcies vers le preset RAID (2 tentatives, cooldown 60 s,
  expiration 1 min, donc blocage 120 s) selon une règle **monotone** : le
  durcissement ne peut que réduire les tentatives, allonger le cooldown et
  raccourcir l'expiration. Une configuration déjà plus stricte est conservée.
- **Axe B — décidé par l'entitlement réel, jamais par le niveau configuré** :
  pendant un raid, un serveur dont l'entitlement `CAPTCHA_PREMIUM` est accordé
  passe au **niveau RAID** (mode challenge), **même si son niveau configuré est
  standard (NORMAL/panneau)** — « bouton standard » ne signifie donc pas
  « serveur sans droit Premium ». À l'inverse, un serveur **réellement dépourvu
  d'entitlement valide** ne reçoit jamais de challenge : la sélection Premium
  est refusée (fail-closed), le mode configuré est conservé et le bouton
  standard reste le seul chemin. Ces deux situations doivent être distinguées
  explicitement lors d'un diagnostic.
- **Session ouverte avant le raid (sémantique exacte)** : elle **conserve son
  expiration initiale**, sans réécriture rétroactive ; en revanche, les
  tentatives et le cooldown appliqués à chaque interaction pendant le raid sont
  ceux durcis (le plafond durci s'applique aussi à ces sessions et peut les
  faire basculer dans le blocage de 120 s). La durée d'**une minute** ne
  concerne donc que les sessions **créées pendant le raid** et ne doit jamais
  être présentée comme une garantie rétroactive. La prolongation bornée d'une
  fenêtre après le cooldown (règle L1) continue de s'appliquer lorsque le
  cooldown atteint l'expiration en cours.
- La configuration n'est **jamais écrite**, aucune session existante ne voit son
  expiration initiale réécrite, et rien n'est persisté : après le raid, les
  valeurs configurées d'origine s'appliquent de nouveau, à l'identique.
- Un signal raid indisponible ou en erreur n'empêche jamais un membre de se
  vérifier (repli sur les limites configurées).
- Limite honnête : ce durcissement réduit fortement le débit d'essais
  (NORMAL → RAID ≈ 4 à 5 fois moins d'essais par minute) mais **n'empêche pas**
  un bot de réussir au premier clic correct lorsque le serveur Free n'utilise
  pas de challenge — le challenge Premium reste la barrière anti-bot.

## Vérifications offline

Suites dédiées : `CaptchaSessionFlow`, `CaptchaChallengeFlow`,
`CaptchaRaidHardening`, `CaptchaLevels`, `CaptchaProvisioning`,
`CaptchaPanelDelivery`, `CaptchaPanelLifecycle`, `CaptchaMemberJoinFlow`,
`CaptchaForceExisting`, `CaptchaLifecycleLogs`, plus le routage et le rendu des
journaux en PHASE 1. Les tests couvrent les niveaux, les modes, les challenges,
les limites, les échecs, la concurrence (doubles clics, rejeu), les
entitlements, les journaux, ainsi qu'une **session ouverte avant le raid**
(expiration initiale conservée, limites durcies pendant l'incident, retour aux
valeurs configurées ensuite) ; **aucun test local ne remplace une campagne
Discord/Supabase réelle**.

## Limites

Captcha image et méthodes avancées restent hors périmètre ; la personnalisation
Premium du CAPTCHA (niveau 6) est reportée après V1. La validation réelle
Discord/Supabase reste requise avant production (protocole dédié).
