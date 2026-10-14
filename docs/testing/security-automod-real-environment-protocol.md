# Protocole de validation Discord réelle — Sécurité & AutoMod

**Statut : jamais exécuté.** Aucune campagne Discord réelle n'a été menée à ce
jour. Les modules sont complets offline (services transport-neutral + tests),
mais la validation en environnement réel reste entièrement à faire. Aucun
résultat ne doit être présenté comme acquis avant cette campagne.

## 1. Préparation

Sur une guilde de test dédiée (jamais une guilde de production), disposer de :
un salon de journaux de modération (`log_moderation_channel_id`), un compte
technique « Owner » pour `/admin`, des comptes Discord de test (au moins 12)
pour simuler une rafale d'arrivées, et la possibilité de retirer/ajouter des
permissions au bot.

Vérifier d'abord les réglages depuis `/settings → Sécurité` : activation
globale (`security_enabled`), anti-raid (`security_anti_raid`), anti-bot
(`security_anti_bot`, whitelist), anti-nuke (`security_anti_nuke`), permissions
(`security_anti_perms`), mises à jour (`security_anti_updates`) — et
`/settings → AutoMod` : règles actives, sanctions (`none`, `warn`, `timeout`)
et exemptions.

## 2. Anti-raid

- [ ] 4 arrivées en moins de 15 s : aucune alerte, aucun durcissement ;
- [ ] 5ᵉ arrivée dans la fenêtre : alerte `SECURITY_RAID` dans le salon de
      modération, avec compteur/seuil/fenêtre exacts ;
- [ ] 20 arrivées en rafale : **une seule** alerte pendant la fenêtre (état,
      pas événement) ;
- [ ] fin de la fenêtre (15 s sans arrivée) puis nouveau seuil : nouvelle
      alerte, comportement identique ;
- [ ] deux guildes de test simultanées : aucun mélange de compteurs ;
- [ ] `security_anti_raid` désactivé : aucune alerte malgré 20 arrivées ;
- [ ] `isRaidActive(guildId)` (lecture seule) reflète l'état du moteur sans
      consommer ni écrire : `true` pendant la fenêtre, `false` après, isolation
      par guilde ; le CAPTCHA retiré en V1 ne consomme plus ce signal ;
- [ ] aucun seuil ni décision du moteur anti-raid n'est modifié par ce peek.

## 3. Anti-bot et whitelist

- [ ] bot non whitelisté : action configurée (kick/ban selon réglage) et alerte
      `SECURITY_BOT` avec l'identité réelle ;
- [ ] bot whitelisté : aucune sanction, aucune alerte ;
- [ ] humain : jamais traité comme un bot ;
- [ ] identifiant whitelisté invalide/hors guilde : aucun effet de bord ;
- [ ] vérifier que la whitelist n'accorde aucune exemption aux humains sanctionnés
      par AutoMod.

## 4. Anti-nuke

Créer puis supprimer par rafale, sur une guilde jetable : salons, rôles
(création/suppression), permissions gagnées par un rôle, mises à jour de salons
et de rôles. Pour chaque famille : seuil exact (10/12/30/32 selon la famille),
une seule alerte par épisode, acteur identifié depuis l'Audit Log lorsque
disponible (`null` sinon, jamais inventé), sanction configurée appliquée et
aucune action sur un membre non responsable.

- [ ] création de salons en rafale ;
- [ ] suppression de salons en rafale ;
- [ ] création de rôles en rafale ;
- [ ] suppression de rôles en rafale ;
- [ ] permissions sensibles gagnées par un rôle ;
- [ ] rafale de mises à jour de salons ;
- [ ] rafale de mises à jour de rôles ;
- [ ] Audit Log indisponible (permission retirée au bot) : alerte sans acteur,
      aucune donnée inventée, aucune exception visible pour les membres.

## 5. AutoMod

Pour chaque règle active (7 règles) : message déclencheur, sanction configurée
(`none`, `warn`, `timeout`), journal `automod` avec la règle concernée, et
vérification qu'une exemption s'applique sans journal parasite.

- [ ] sanction `none` : journal seul, aucun effet sur le membre ;
- [ ] sanction `warn` : avertissement enregistré, visible du membre ;
- [ ] sanction `timeout` : durée exacte, expiration vérifiée ;
- [ ] exemptions (salons rôles/membres selon configuration) respectées ;
- [ ] règle désactivée : aucune détection ;
- [ ] contenu bénin proche du seuil : aucune détection (faux positifs) ;
- [ ] volume : aucun doublon de journal pour un même message ;
- [ ] AutoMod et Sécurité cohabitent sans double sanction.

## 6. Journalisation et continuité

- [ ] chaque alerte arrive dans `log_moderation_channel_id` uniquement ;
- [ ] `logs_enabled = false` : aucune alerte, aucune erreur visible ;
- [ ] FR puis EN : titres et champs localisés ;
- [ ] panne de livraison de journal : la détection reste effective (best-effort) ;
- [ ] continuité AutoRole, Welcome, Tickets et Invites après un
      redémarrage complet du bot ;
- [ ] aucune écriture de configuration déclenchée par une alerte.

## 7. Compte rendu

Consigner : date, guilde(s), version/commit, résultats par case (cochée ou
non), écarts observés, et pour chaque écart le comportement réellement constaté.
Aucun résultat automatisé ne doit être présenté comme un résultat réel.
