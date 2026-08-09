# Captcha / Vérification

## Architecture

Le module Captcha utilise `CaptchaConfigService`, `CaptchaPanelService`,
`CaptchaPanelDeliveryService`, `CaptchaVerificationService`,
`CaptchaReminderService` et `DiscordCaptchaTransport`. Les services métier ne
importent pas Discord.js. La configuration passe uniquement par
`GuildConfigResolver`.

## Configuration

La configuration Free contient `captcha_enabled`, `captcha_channel_id` et
`captcha_role_id`. Elle est gérée depuis `/settings → Captcha` avec ManageGuild,
Channel Select, Role Select, Preview et Retour, en français ou anglais.

## Panel persistant

`/captcha panel` publie le panel dans le salon configuré uniquement lorsque la
configuration est complète. Son bouton persistant est
`civrat:v1:captcha:verify` et le routing après redémarrage passe par le module
Captcha.

## Vérification

Le membre qui clique sur le bouton est le seul candidat à recevoir le rôle.
Captcha vérifie l’état activé, le rôle configuré, l’existence et la gestion du
rôle, puis évite toute double attribution. Le rôle de vérification reste
indépendant des rôles AutoRole.

## Reminder et logs

Le reminder DM est déclenché à l’arrivée d’un membre humain non vérifié. Les DMs
fermés retournent un résultat contrôlé. Les résultats de vérification utilisent
les logs de guild `CAPTCHA_VERIFIED` et `CAPTCHA_VERIFICATION_FAILED`; ils ne
sont pas envoyés à l’observabilité globale CIVRAT.

## Limites

Captcha image, méthodes avancées, Premium et entitlements sont hors périmètre.
La validation Discord/Supabase réelle reste requise avant production.
