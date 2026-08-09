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
| 9 | Analytics | Partielle | Définir et stabiliser les capacités XP et analytics réellement retenues. |
| 10 | Premium | Non commencé | Entitlements et capacités Premium après un socle Free stable. |
| 11 | API | Partielle | Stabiliser l’API existante et ses contrats. |
| 12 | Stabilisation | Partielle | Tests transverses, sécurité, reprise et validation d’environnement. |
| 13 | CIVRAT V1.0 | Non commencé | Release readiness et livraison publique. |

## Priorités vers V1

1. Terminer la modernisation de la Modération.
2. Terminer AutoMod & Protection.
3. Finaliser les automatisations de rôles utiles au socle Free, dont `/uploadsticker` Free.
4. Décider le périmètre minimal Analytics et API de V1.
5. Stabiliser, tester en environnement réel et préparer la release.

## Limites V1

Les éléments Premium restent découplés du socle Free. Enterprise relève d’une feuille de route distincte et ne constitue pas une phase de CIVRAT V1.0.

## /uploadsticker

`/uploadsticker` appartient à la Phase 8 — Roles & Automatisation : upload Discord automatisé, limite Free et configuration depuis `/settings`. Les extensions Premium sont planifiées en Phase 10 et ne doivent pas bloquer le socle Free.
