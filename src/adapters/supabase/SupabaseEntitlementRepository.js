"use strict";

const {
  EntitlementRepository,
  EntitlementFeatureList,
  PremiumMutationOperation,
  PremiumMutationPolicy,
} = require("../../core/entitlements");

// ───────────────────────────────────────────────────────────────
// 4D — bornes de lecture.
//
// PostgREST applique `db-max-rows` (1000 par défaut sur Supabase) et TRONQUE
// SILENCIEUSEMENT avec HTTP 200 : un `select()` sans `.range()` qui devrait
// renvoyer « toutes les lignes » s'arrête à 1000 sans aucune erreur. Le
// plafond est donc repris en main ici, page par page, avec un ordre
// déterministe — sans ORDER BY, PostgREST trie sur `ctid` et l'ordre change
// après un VACUUM, ce qui ferait sauter ou dupliquer des lignes d'une page à
// l'autre.
//
// PAGE_SIZE = 1000 : la taille de page déjà validée en P10 (Analytics) et M5
// (giveaways). SCAN_CAP = 10 000 lignes, soit 5 000 serveurs Premium × 2
// features : très au-delà du parc réel, mais la mémoire reste bornée et
// `truncated` signale honnêtement un dépassement au lieu de le masquer.
// ───────────────────────────────────────────────────────────────
const ENTITLEMENTS_PAGE_SIZE = 1000;
const ENTITLEMENTS_SCAN_CAP = 10000;

// Une guilde ne peut porter qu'une ligne PAR feature : la liste des features
// connues est donc la borne exacte de listFeatures (4D/R5).
const FEATURES_PER_GUILD_LIMIT = Math.max(EntitlementFeatureList.length, 1);

class SupabaseEntitlementRepository extends EntitlementRepository {
  constructor({ supabase, mutationPolicy = null }) {
    super();
    this.supabase = supabase;
    // A private default remains fail-closed for direct protected-guild writes.
    // Production injects the exact policy instance shared by EntitlementService.
    Object.defineProperty(this, "mutationPolicy", {
      value: mutationPolicy || new PremiumMutationPolicy(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  async findFeature(guildId, feature) {
    const { data, error } = await this.supabase
      .from("guild_entitlements")
      .select("*")
      .eq("guild_id", guildId)
      .eq("feature_key", feature)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listFeatures(guildId) {
    // 4D/R5 — `.limit()` explicite : une guilde ne peut avoir qu'une ligne par
    // feature, la borne est donc connue et gratuite. Défense en profondeur.
    const { data, error } = await this.supabase
      .from("guild_entitlements")
      .select("*")
      .eq("guild_id", guildId)
      .order("feature_key", { ascending: true })
      .limit(FEATURES_PER_GUILD_LIMIT);
    if (error) throw error;
    return data || [];
  }

  /**
   * 4D/R1 — toutes les lignes de la table, par pagination bornée.
   *
   * Renvoie `{ rows, totalRows, truncated }` :
   *   • rows      — lignes effectivement lues ;
   *   • totalRows — nombre EXACT de lignes en base (`count: "exact"` en HEAD,
   *                 aucune ligne transférée, total lu dans Content-Range) ;
   *   • truncated — true si le plafond ENTITLEMENTS_SCAN_CAP a été atteint.
   *                 Dans ce cas `rows` est un PLANCHER, pas le contenu réel.
   *
   * L'ordre `(guild_id, feature_key)` est la clé primaire de la table : il est
   * stable, donc la pagination ne peut ni sauter ni dupliquer de ligne.
   *
   * NOTE : `totalRows` compte des LIGNES, pas des guildes distinctes. Un total
   * exact de guildes distinctes exigerait un `COUNT(DISTINCT guild_id)`, que
   * PostgREST ne sait pas exprimer — il faudrait une RPC, hors périmètre 4D
   * (aucun SQL autorisé). `truncated` est le signal honnête d'une liste
   * incomplète ; rien n'est inventé.
   */
  async listAll() {
    const { count, error: countError } = await this.supabase
      .from("guild_entitlements")
      .select("guild_id", { count: "exact", head: true });
    if (countError) throw countError;
    // `count: "exact"` renvoie un nombre dans Content-Range. S'il manque, le
    // total est INCONNU et on retombe sur le seul signal disponible (le plafond).
    const countKnown = count !== null && count !== undefined;
    const counted = Number(count);
    const totalRows = countKnown && Number.isFinite(counted) && counted >= 0 ? counted : 0;

    const rows = [];
    let hitCap = false;
    for (let from = 0; ; from += ENTITLEMENTS_PAGE_SIZE) {
      if (rows.length >= ENTITLEMENTS_SCAN_CAP) {
        hitCap = true;
        break;
      }
      const { data, error } = await this.supabase
        .from("guild_entitlements")
        .select("*")
        .order("guild_id", { ascending: true })
        .order("feature_key", { ascending: true })
        .range(from, from + ENTITLEMENTS_PAGE_SIZE - 1);
      if (error) throw error;
      const page = data || [];
      for (const row of page) rows.push(row);
      // Page incomplète : la table est épuisée. Sans cette condition, une table
      // dont le cardinal est un multiple exact de PAGE_SIZE coûterait une
      // requête vide de plus.
      if (page.length < ENTITLEMENTS_PAGE_SIZE) break;
    }

    // Le count est EXACT, c'est donc lui qui fait foi — et non le fait d'avoir
    // touché le plafond. Une table dont le cardinal tombe EXACTEMENT sur
    // ENTITLEMENTS_SCAN_CAP a été lue intégralement et n'est pas tronquée ;
    // l'inverse (rows < totalRows) attrape la troncature silencieuse que
    // db-max-rows infligerait à une page.
    const truncated = countKnown ? rows.length < totalRows : hitCap;

    return { rows, totalRows, truncated };
  }

  async activate(record, permit = null) {
    this.mutationPolicy.assertRepositoryMutation({
      guildId: record?.guild_id,
      feature: record?.feature_key,
      operation: PremiumMutationOperation.ACTIVATE,
      permit,
    });

    const { error } = await this.supabase
      .from("guild_entitlements")
      .upsert(record, { onConflict: "guild_id,feature_key" });
    if (error) throw error;
  }

  async setStatus(guildId, feature, status, permit = null) {
    this.mutationPolicy.assertRepositoryMutation({
      guildId,
      feature,
      operation: PremiumMutationOperation.SET_STATUS,
      permit,
    });

    const { error } = await this.supabase
      .from("guild_entitlements")
      .update({ status })
      .eq("guild_id", guildId)
      .eq("feature_key", feature);
    if (error) throw error;
  }
}

module.exports = { SupabaseEntitlementRepository };
