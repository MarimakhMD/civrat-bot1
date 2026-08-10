# Fondation Logs

Les journaux de guild sont configurés depuis `/settings → Logs` avec ManageGuild.
Chaque catégorie Free choisit son salon : Messages, Membres, Modération, Rôles,
Salons et Invitations. Les services Logs sont transport-neutres; Discord est
isolé dans `DiscordLogsTransport`. Les logs de guild ne sont ni stockés ni
transmis vers l'observabilité globale CIVRAT.

Événements migrés : suppressions/modifications de messages y compris bulk,
arrivée/départ/changement de pseudo, ban/unban/kick/timeout/untimeout/warn/mute/
unmute, rôles, salons/threads et invitations. Les tests offline sont validés;
la validation Discord réelle reste requise.
