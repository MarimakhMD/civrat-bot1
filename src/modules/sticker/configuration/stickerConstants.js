"use strict";

// Phase 1 (C12) : deux constantes mortes ont été retirées —
//   • StickerConfigKey.LIMIT (« sticker_limit ») : jamais lu. La limite
//     appliquée est STICKER_LIMIT_FREE, injectée dans StickerService ; la
//     colonne de guild_configs n'était ni lue, ni écrite, ni configurable.
//   • StickerComponentId.SECTION (« civrat:v1:sticker:section ») : absent du
//     registre d'interactions et du catalogue Settings — aucune vue ne le
//     rendait, aucun bouton ne le portait.
// Aucun des deux symboles n'était importé où que ce soit dans src/ ou test/.
// Une section Sticker réellement configurable (limite par palier Free/Premium)
// relèvera de la phase Settings, avec sa route et sa vue.

// Limite Free appliquée par StickerService (seule constante réellement consommée).
const STICKER_LIMIT_FREE = 5;

module.exports = { STICKER_LIMIT_FREE };
