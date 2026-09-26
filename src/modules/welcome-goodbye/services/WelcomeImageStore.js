"use strict";

const {
  WELCOME_IMAGE_BUCKET,
  buildWelcomeImageObjectKey,
  buildWelcomeImageMetaKey,
} = require("../configuration/welcomeImageStorage");

/**
 * Stockage de l'image Welcome personnalisée (Premium) dans Supabase Storage.
 *
 * Règles de sécurité :
 *  - la clé n'est JAMAIS fournie par l'appelant : elle est dérivée du `guildId`
 *    par `buildWelcomeImageObjectKey`, qui refuse tout identifiant non snowflake
 *    (donc ni traversée de chemin ni clé d'une autre guilde) ;
 *  - le bucket est privé : aucune URL publique n'est produite, l'image est
 *    récupérée par `download()` puis décodée en mémoire ;
 *  - `upsert: true` : remplacer l'image réécrit le même objet, il n'existe donc
 *    jamais deux objets pour une même guilde.
 *
 * Comportement en cas d'indisponibilité :
 *  - `upload` lève une `WelcomeImageStorageError` (l'administrateur doit voir
 *    l'échec, on ne lui ment pas sur un enregistrement) ;
 *  - `download` renvoie `null` et `remove` renvoie `false` : la LIVRAISON ne doit
 *    jamais être bloquée par le stockage, elle retombe sur le template standard.
 */
class WelcomeImageStorageError extends Error {
  constructor(message, { reason = "STORAGE_UNAVAILABLE", guildId = null, causeMessage = null, causeCode = null } = {}) {
    super(message);
    this.name = "WelcomeImageStorageError";
    this.reason = reason;
    this.guildId = guildId;
    // La cause d'origine est conservée : un message générique « upload failed »
    // ne dit pas si c'est la RLS, le réseau ou le bucket qui est en cause.
    this.causeMessage = causeMessage;
    this.causeCode = causeCode;
  }
}

/** Signatures d'erreur Supabase signifiant « objet absent », pas « panne ». */
const NOT_FOUND_MARKERS = ["not found", "resource not found", "object not found", "pgrst116"];

/**
 * Décrit une erreur de stockage de façon exploitable.
 *
 * Indispensable, et c'est la cause d'un diagnostic aveugle : les erreurs de
 * `@supabase/storage-js` (`StorageError` / `StorageApiError`) n'ont AUCUN champ
 * `code`. Elles exposent `status` (nombre HTTP), `statusCode` (chaîne) et
 * `message`. Un log construit sur `error.code` affiche donc `null` quelle que
 * soit la cause, rendant un rejet de bucket indistinguable d'un refus RLS ou
 * d'une panne 500.
 */
function describeStorageError(error) {
  if (!error) return { errorName: null, status: null, statusCode: null, errorMessage: null };
  const status = error.status === undefined || error.status === null ? null : Number(error.status);
  // `code` est conservé en dernier recours : les erreurs PostgREST, elles, en
  // portent un (par exemple `PGRST116` pour un objet absent).
  const statusCode = error.statusCode !== undefined && error.statusCode !== null
    ? String(error.statusCode)
    : (error.code !== undefined && error.code !== null ? String(error.code) : null);
  return {
    errorName: error.name || typeof error,
    status: Number.isFinite(status) ? status : null,
    statusCode,
    errorMessage: typeof error.message === "string" ? error.message.slice(0, 300) : null,
  };
}

function isNotFoundError(error) {
  if (!error) return false;
  // Le statut HTTP est la signature la plus fiable d'un objet absent.
  if (Number(error.status) === 404 || String(error.statusCode) === "404") return true;
  const haystack = `${error.message || ""} ${error.code || ""} ${error.statusCode || ""}`.toLowerCase();
  return NOT_FOUND_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Content types tentés pour le sidecar, du plus exact au plus permissif.
 * Le bucket étant privé et le contenu relu en texte, le type déclaré n'a
 * aucun effet sur le comportement : il ne sert qu'à franchir l'éventuel
 * `allowed_mime_types` du bucket.
 */
const META_CONTENT_TYPES = Object.freeze([
  "application/json",
  "application/octet-stream",
  "text/plain",
  "image/png",
]);

/**
 * Faut-il retenter avec un autre content type ?
 *
 * Uniquement si le serveur a explicitement rejeté LE PAYLOAD (4xx de
 * validation). Retenter sur un 403 (RLS), un 5xx ou une erreur sans statut
 * réseau ne changerait rien et ne ferait que multiplier les requêtes.
 */
const PAYLOAD_REJECTION_STATUSES = new Set([400, 406, 413, 415, 422]);

function isRetriableContentTypeFailure(error) {
  return PAYLOAD_REJECTION_STATUSES.has(Number(error?.status));
}

class WelcomeImageStore {
  /**
   * @param {object|null} storage client `supabase.storage` ; null = non configuré.
   * @param {object|null} logger
   * @param {string} bucket
   */
  constructor({ storage = null, logger = null, bucket = WELCOME_IMAGE_BUCKET } = {}) {
    this.storage = storage;
    this.logger = logger;
    this.bucket = bucket;
  }

  /** Vrai si un backend de stockage est réellement disponible. */
  get available() {
    return Boolean(this.storage && typeof this.storage.from === "function");
  }

  /** Clé d'objet de la guilde — seule source de vérité, jamais saisie ailleurs. */
  keyFor(guildId) {
    return buildWelcomeImageObjectKey(guildId);
  }

  /** Clé du sidecar de métadonnées (géométrie détectée), même bucket privé. */
  metaKeyFor(guildId) {
    return buildWelcomeImageMetaKey(guildId);
  }

  #bucketClient() {
    if (!this.available) return null;
    return this.storage.from(this.bucket);
  }

  /**
   * Écrit (ou remplace) l'image de la guilde.
   * @returns {Promise<{key:string,size:number}>}
   * @throws {WelcomeImageStorageError} si le stockage est indisponible ou en erreur.
   */
  async upload(guildId, buffer, { contentType = "image/png" } = {}) {
    const key = this.keyFor(guildId);
    const client = this.#bucketClient();
    if (!client) {
      throw new WelcomeImageStorageError("Welcome image storage is not configured", {
        reason: "STORAGE_UNAVAILABLE",
        guildId,
      });
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new WelcomeImageStorageError("Welcome image buffer is empty", {
        reason: "EMPTY_IMAGE",
        guildId,
      });
    }

    let result;
    try {
      result = await client.upload(key, buffer, { contentType, upsert: true });
    } catch (error) {
      this.logger?.warn?.("Welcome image upload failed", { guildId, ...describeStorageError(error) });
      throw new WelcomeImageStorageError("Welcome image upload failed", {
        reason: "UPLOAD_FAILED",
        guildId,
        causeMessage: error?.message || null,
      });
    }
    if (result?.error) {
      this.logger?.warn?.("Welcome image upload rejected", { guildId, ...describeStorageError(result.error) });
      throw new WelcomeImageStorageError("Welcome image upload rejected", {
        reason: "UPLOAD_REJECTED",
        guildId,
        causeCode: describeStorageError(result.error).statusCode,
        causeMessage: result.error.message || null,
      });
    }
    return { key, size: buffer.length };
  }

  /**
   * Récupère l'image de la guilde.
   * @returns {Promise<Buffer|null>} null si absente, illisible ou backend indisponible.
   */
  async download(guildId) {
    const key = this.keyFor(guildId);
    const client = this.#bucketClient();
    if (!client) return null;

    let result;
    try {
      result = await client.download(key);
    } catch (error) {
      this.logger?.warn?.("Welcome image download failed", { guildId, ...describeStorageError(error) });
      return null;
    }
    if (result?.error) {
      // Objet absent = état normal (guilde sans image) : pas un incident.
      if (!isNotFoundError(result.error)) {
        this.logger?.warn?.("Welcome image download rejected", { guildId, ...describeStorageError(result.error) });
      }
      return null;
    }

    const data = result?.data;
    if (!data) return null;
    try {
      if (Buffer.isBuffer(data)) return data.length > 0 ? data : null;
      if (typeof data.arrayBuffer === "function") {
        const buffer = Buffer.from(await data.arrayBuffer());
        return buffer.length > 0 ? buffer : null;
      }
      return null;
    } catch (error) {
      this.logger?.warn?.("Welcome image could not be read", { guildId, errorType: error?.name || typeof error });
      return null;
    }
  }

  /**
   * Supprime l'objet de la guilde.
   * @returns {Promise<boolean>} true si l'objet a bien été retiré.
   */
  async remove(guildId) {
    const key = this.keyFor(guildId);
    const client = this.#bucketClient();
    if (!client) return false;

    let result;
    try {
      // L'image ET son sidecar partent ensemble : une géométrie orpheline
      // pourrait sinon s'appliquer à l'image suivante.
      result = await client.remove([key, this.metaKeyFor(guildId)]);
    } catch (error) {
      this.logger?.warn?.("Welcome image removal failed", { guildId, ...describeStorageError(error) });
      return false;
    }
    if (result?.error) {
      if (!isNotFoundError(result.error)) {
        this.logger?.warn?.("Welcome image removal rejected", { guildId, ...describeStorageError(result.error) });
      }
      // Un objet déjà absent est un état final acceptable.
      return isNotFoundError(result.error);
    }
    return true;
  }

  /**
   * Écrit le sidecar de métadonnées (géométrie détectée de la zone avatar).
   *
   * Ne lève JAMAIS : l'image est déjà stockée à ce stade, un échec du sidecar
   * ne doit donc ni annuler l'upload ni le faire apparaître comme raté. Le
   * rendu retombera simplement sur la géométrie du gabarit.
   * @returns {Promise<boolean>} true si le sidecar a bien été écrit.
   */
  async uploadMeta(guildId, meta) {
    const client = this.#bucketClient();
    if (!client) {
      this.logger?.warn?.("Welcome image meta upload skipped: storage unavailable", { guildId });
      return false;
    }

    let payload;
    try {
      payload = Buffer.from(JSON.stringify(meta), "utf8");
    } catch (error) {
      this.logger?.warn?.("Welcome image meta could not be serialized", { guildId, errorType: error?.name || typeof error });
      return false;
    }

    const key = this.metaKeyFor(guildId);
    // Le sidecar est un objet privé, relu par `downloadMeta` puis parsé en
    // texte : son content type déclaré n'a aucun effet fonctionnel. On tente
    // donc le type exact, puis des types plus permissifs, parce qu'un bucket
    // dont `allowed_mime_types` est restreint aux images rejette sinon
    // `application/json` alors que l'image, elle, passe très bien.
    let lastError = null;
    for (const contentType of META_CONTENT_TYPES) {
      let result;
      try {
        result = await client.upload(key, payload, { contentType, upsert: true });
      } catch (error) {
        lastError = describeStorageError(error);
        this.logger?.warn?.("Welcome image meta upload failed", { guildId, key, contentType, ...lastError });
        if (!isRetriableContentTypeFailure(lastError)) break;
        continue;
      }
      if (!result?.error) {
        if (contentType !== META_CONTENT_TYPES[0]) {
          // Le type exact a été refusé : il faut que cela se voie, sinon le
          // bucket restera mal configuré sans que personne ne le sache.
          this.logger?.warn?.("Welcome image meta stored with fallback content type", {
            guildId,
            key,
            contentType,
            rejectedContentType: META_CONTENT_TYPES[0],
            ...lastError,
          });
        }
        return true;
      }

      lastError = describeStorageError(result.error);
      this.logger?.warn?.("Welcome image meta upload rejected", { guildId, key, contentType, ...lastError });
      if (!isRetriableContentTypeFailure(lastError)) break;
    }

    // Toute la chaîne a échoué : la cause réelle est maintenant dans les logs
    // (status / statusCode / message), plus dans un `code: null` inexploitable.
    this.logger?.warn?.("Welcome image meta not stored", { guildId, key, ...lastError });
    return false;
  }

  /**
   * Retire le sidecar sans toucher à l'image.
   *
   * Sert au re-upload : si la nouvelle image n'obtient pas un verdict CONFIRME,
   * la géométrie de l'image précédente doit disparaître, sinon elle serait
   * appliquée à une image qui ne lui correspond pas.
   * @returns {Promise<boolean>} true si le sidecar est absent après l'appel.
   */
  async removeMeta(guildId) {
    const client = this.#bucketClient();
    if (!client) return false;

    let result;
    try {
      result = await client.remove([this.metaKeyFor(guildId)]);
    } catch (error) {
      this.logger?.warn?.("Welcome image meta removal failed", { guildId, ...describeStorageError(error) });
      return false;
    }
    if (result?.error) {
      // Un sidecar déjà absent est l'état voulu : ce n'est pas un incident.
      if (!isNotFoundError(result.error)) {
        this.logger?.warn?.("Welcome image meta removal rejected", { guildId, ...describeStorageError(result.error) });
      }
      return isNotFoundError(result.error);
    }
    return true;
  }

  /**
   * Lit le sidecar. Toute anomalie (absent, JSON invalide, forme inattendue,
   * backend indisponible) renvoie null : le rendu utilise alors la géométrie du
   * gabarit. Une métadonnée corrompue ne peut donc jamais casser un Welcome.
   * @returns {Promise<object|null>}
   */
  async downloadMeta(guildId) {
    const client = this.#bucketClient();
    if (!client) return null;

    let result;
    try {
      result = await client.download(this.metaKeyFor(guildId));
    } catch (error) {
      this.logger?.warn?.("Welcome image meta download failed", { guildId, ...describeStorageError(error) });
      return null;
    }
    if (result?.error) {
      // Sidecar absent = état normal (image antérieure à la détection, ou
      // détection non confirmée) : ce n'est pas un incident.
      if (!isNotFoundError(result.error)) {
        this.logger?.warn?.("Welcome image meta download rejected", { guildId, ...describeStorageError(result.error) });
      }
      return null;
    }

    const data = result?.data;
    if (!data) return null;
    try {
      const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(await data.text());
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      this.logger?.warn?.("Welcome image meta could not be parsed", { guildId, errorType: error?.name || typeof error });
      return null;
    }
  }
}

module.exports = { WelcomeImageStore, WelcomeImageStorageError };
