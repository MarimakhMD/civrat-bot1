# Protocole de validation production Captcha

**Statut : jamais exécuté.** Aucune campagne Discord/Supabase réelle n'a été
menée à ce jour ; les cases ci-dessous ne sont ni cochées ni remplacées par des
résultats automatisés. Les tests offline ne valident que la logique.

## 1. Socle (niveau 1)

Configurer `/settings → Captcha` en FR puis EN : activation, Channel Select,
Role Select, Preview et ManageGuild. Publier `/captcha panel`, vérifier le salon
configuré et le bouton `civrat:v1:captcha:verify`. Tester membre non vérifié,
membre déjà vérifié, rôle absent, rôle non gérable et Captcha désactivé.

Tester le reminder avec membre humain, DMs ouverts, DMs fermés, membre vérifié et
bot. Vérifier `CAPTCHA_VERIFIED` et `CAPTCHA_VERIFICATION_FAILED` avec guildId,
memberId et roleId si disponible.

Vérifier les limites de session : tentatives épuisées → message de blocage,
expiration de session, cooldown respecté, P6 (5 créations / 30 s / membre)
atteint, double clic simultané ne créditant qu'une seule tentative, rejeu d'un
ancien bouton sans effet.

## 2. Provisionnement et panneau (niveau 2)

- supprimer le rôle non vérifié puis provoquer une arrivée : l'auto-réparation
  recrée **uniquement** ce rôle (aucun autre salon, aucune autre permission) ;
- supprimer le salon configuré puis provoquer une arrivée : seul ce salon est
  recréé avec son overwrite minimal ;
- publier deux fois `/captcha panel` : l'ancien panneau est remplacé, un seul
  panneau officiel subsiste, les IDs persistés sont ceux du dernier message ;
- redémarrer le bot : aucun doublon de panneau n'apparaît ;
- `force-existing` : vérifier le résumé (traités / appliqués / bots / ignorés),
  l'absence de sanction, l'absence de scan infini et le fait qu'un second clic
  ne fait que désactiver le réglage ;
- retirer manuellement une colonne de la base (environnement de test) : la
  configuration existante n'est ni perdue ni écrasée, le repli mémoire est
  utilisé.

## 3. Niveaux, modes et challenges (niveau 3)

- sélectionner LOW, NORMAL, HIGH puis RAID : les limites écrites correspondent
  au preset (voir `docs/modules/captcha-verification.md`) ;
- sur un serveur **sans** entitlement : sélectionner HIGH/RAID ou le mode
  challenge → refus FR/EN, configuration inchangée, aucun challenge émis ;
- sur un serveur **avec** entitlement : vérifier les trois types de challenge
  (`CHOICE`, `ORDER`, `PICK`), une mauvaise réponse, une réponse partielle
  (ORDER), une réponse correcte, et le fait qu'un index forgé ne valide jamais ;
- révoquer l'entitlement en cours de session de challenge : la session est
  invalidée, aucune vérification n'est servie ;
- vérifier la prolongation bornée du RAID : deux tentatives réellement
  utilisables dans la même session, puis blocage, et que LOW/NORMAL/HIGH ne sont
  pas prolongés.

## 4. Journaux de cycle de vie (niveau 4)

Vérifier dans le salon `log_moderation_channel_id` (jamais dans un autre) :

- `captcha_provision_failed` lors d'un échec de réparation réel (par exemple
  permission manquante) ;
- `captcha_panel_published` avec la distinction publication / régénération et
  l'ID du message publié ;
- `captcha_force_existing` avec l'acteur et le résumé réellement appliqué ;
- l'anti-spam : plusieurs arrivées en échec rapprochées ne produisent pas une
  rafale d'embeds identiques ;
- `logs_enabled = false` → aucun envoi ; langue de guilde respectée (FR/EN) ;
- un échec de livraison de journal ne bloque jamais une vérification.

## 5. Durcissement raid (niveau 5)

Sur une guilde de test, activer `security_anti_raid` (et `security_enabled`)
puis déclencher un raid contrôlé (5 arrivées en moins de 15 s, comptes de test) :

- **Sans entitlement valide** (seul critère décisif) : le bouton standard reste
  le seul chemin, aucune tentative de challenge ; les limites passent à
  2 tentatives / 60 s de cooldown / 1 min d'expiration / blocage 120 s ;
- **Avec entitlement valide, même configuré en standard (NORMAL/panneau)** : le
  niveau effectif devient RAID (challenge) pendant le raid — une configuration
  standard ne prouve donc pas l'absence de droit Premium, et inversement ;
- **Session ouverte avant le raid** : constater qu'elle conserve son expiration
  initiale (aucune réécriture rétroactive) alors que ses tentatives et son
  cooldown sont durcis pendant l'incident ; la durée d'une minute ne concerne
  que les sessions créées pendant le raid ;
- retirer l'entitlement pendant le raid : repli sur le bouton standard, sans
  challenge, configuration intacte ;
- attendre la fin de la fenêtre (15 s sans nouvelle arrivée) : les valeurs
  configurées d'origine s'appliquent de nouveau (retour automatique) ;
- enchaîner deux raids : le durcissement se réapplique à l'identique, sans
  accumulation ni état persistant ;
- vérifier qu'aucune colonne de configuration n'a été modifiée par ces
  séquences (comparer la configuration avant/après) ;
- vérifier que les seuils et les décisions du moteur anti-raid (alertes
  `SECURITY_RAID`, sanctions éventuelles) sont strictement identiques à ceux
  observés sans CAPTCHA.

## 6. Continuité

Vérifier la continuité AutoRole, Welcome, Invites, Security et Logs, ainsi que
l'absence de double attribution et l'isolation entre deux serveurs (un raid sur
l'un ne durcit jamais l'autre).
