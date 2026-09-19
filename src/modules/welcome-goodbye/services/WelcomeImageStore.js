"use strict";

const {
  WELCOME_IMAGE_BUCKET,
  buildWelcomeImageObjectKey,
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

function isNotFoundError(error) {
  if (!error) return false;
  const haystack = `${error.message || ""} ${error.code || ""}`.toLowerCase();
  return NOT_FOUND_MARKERS.some((marker) => haystack.includes(marker));
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
      this.logger?.warn?.("Welcome image upload failed", { guildId, errorType: error?.name || typeof error, errorMessage: error?.message || null });
      throw new WelcomeImageStorageError("Welcome image upload failed", {
        reason: "UPLOAD_FAILED",
        guildId,
        causeMessage: error?.message || null,
      });
    }
    if (result?.error) {
      this.logger?.warn?.("Welcome image upload rejected", { guildId, code: result.error.code || null, errorMessage: result.error.message || null });
      throw new WelcomeImageStorageError("Welcome image upload rejected", {
        reason: "UPLOAD_REJECTED",
        guildId,
        causeCode: result.error.code || null,
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
      this.logger?.warn?.("Welcome image download failed", { guildId, errorType: error?.name || typeof error });
      return null;
    }
    if (result?.error) {
      // Objet absent = état normal (guilde sans image) : pas un incident.
      if (!isNotFoundError(result.error)) {
        this.logger?.warn?.("Welcome image download rejected", { guildId, code: result.error.code || null });
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
      result = await client.remove([key]);
    } catch (error) {
      this.logger?.warn?.("Welcome image removal failed", { guildId, errorType: error?.name || typeof error });
      return false;
    }
    if (result?.error) {
      if (!isNotFoundError(result.error)) {
        this.logger?.warn?.("Welcome image removal rejected", { guildId, code: result.error.code || null });
      }
      // Un objet déjà absent est un état final acceptable.
      return isNotFoundError(result.error);
    }
    return true;
  }
}

module.exports = { WelcomeImageStore, WelcomeImageStorageError };
