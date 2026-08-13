# CIVRAT — Roadmap officielle vers V1.0

## Règle de planification

Le développement suit des petites missions ciblées : plan validé, développement, tests, vérifications, commit ciblé, puis mission suivante. Une phase peut être complète côté développement offline tout en restant en validation réelle Discord, Supabase ou MongoDB.

## Phases officielles

| Phase | Nom | État réel | Objectif |
| --- | --- | --- | --- |
| 1 | Foundation | Développement complet | Contrats Core, i18n, erreurs, permissions, interactions et configuration. |
| 2 | Guild Settings | Développement complet | Configuration Discord-native et composition runtime. |
| 3 | Welcome & Goodbye | Développement complet / validation réelle en attente | Welcome, Goodbye et fondation image. |
| 4 | Modération | Partielle | Moderniser les commandes et règles legacy. |
| 5 | Tickets | Développement complet / validation réelle en attente | Cycle complet Tickets, Transcript, logs locaux et Claim. |
| 6 | Logs & Audit serveur | Développement complet / validation réelle en attente | Logs guild-locales via Logs Foundation. |
| 7 | AutoMod & Protection | Partielle | Moderniser AutoMod et Security legacy. |
| 8 | Roles & Automatisation | Partielle | AutoRole achevé offline ; automatisations restantes. |
| 9 | Analytics | Développement complet / validation réelle en attente | Runtime unifié (une seule instance lue/écrite), classements XP/Invites sur les mêmes stockages que l'écriture, `/settings` XP + Invites, `/invites` câblée. Migration `analytics_events` documentée (cf. docs/architecture/phase-11-analytics-unification.md). |
| 10 | Premium | Partielle — Ticket Premium livré / validation réelle en attente | Entitlements via `guild_entitlements` livrés pour Ticket Premium 10.1–10.4 : panneau personnalisé, contenu (accueil + salon transcript), nommage atomique `{number}` — socle Free inchangé, fail-closed sans entitlement. Autres capacités Premium non démarrées. |
| 11 | API | Non démarrée | Aucune API n'est présente dans le repo (dépendances express/helmet/socket.io inutilisées, variables d'environnement mortes) ; le périmètre minimal V1 reste à décider — nettoyage ou socle minimal. |
| 12 | Stabilisation | En cours avancé / validation réelle en attente | Réalisé : hygiène `.env` (P12.1), corrections bloquantes tickets (P12.2 B1, P13 B2/B3), audit schéma Supabase (P14), convergence du moteur Tickets unique + nommage Free atomique (P15), audit release V1 (P16), correctif UX panneau + hygiène chargeur (P17). Reste : validation d'environnement réel. |
| 13 | CIVRAT V1.0 | Non commencé | Release readiness et livraison publique. |

## Priorités vers V1

1. Terminer la modernisation de la Modération.
2. Terminer AutoMod & Protection.
3. Finaliser les automatisations de rôles utiles au socle Free ; `/uploadsticker` est livré en commande (configuration depuis `/settings` restante).
4. Décider le périmètre minimal API de V1 (le périmètre Analytics V1 est livré).
5. Stabiliser, tester en environnement réel et préparer la release.

## Limites V1

Les éléments Premium restent découplés du socle Free. Enterprise relève d’une feuille de route distincte et ne constitue pas une phase de CIVRAT V1.0.

## /uploadsticker

`/uploadsticker` appartient à la Phase 8 — Roles & Automatisation : upload Discord automatisé, limite Free et configuration depuis `/settings`. Les extensions Premium sont planifiées en Phase 10 et ne doivent pas bloquer le socle Free.
