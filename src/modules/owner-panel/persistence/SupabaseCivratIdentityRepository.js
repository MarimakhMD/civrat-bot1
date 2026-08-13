"use strict";

// P20 — persistance PostgreSQL (via Supabase) de l'identité CIVRAT :
//  - table `civrat_owner_state` : ligne singleton (id = 1) portant l'Owner
//    CIVRAT actuel ; un transfert la réécrit => le transfert survit aux
//    redémarrages ;
//  - table `civrat_admins` : liste des Admins CIVRAT (user_id PK).
//
// AUCUN secret en base : uniquement des IDs Discord. DDL documentaire :
// docs/architecture/owner-panel-identity.md (convention P14 — pas de .sql
// suivi par Git). Suit les conventions des repositories existants :
// client injecté, erreur => throw (le provider la convertit en fail-closed).
//
// Le transfert est réalisé en DEUX écritures (owner puis retrait admin du
// nouveau Owner) : Supabase-js sans RPC dédiée ne permet pas la transaction
// multi-requêtes. Conséquence documentée : en cas de crash entre les deux,
// le nouveau Owner peut rester listé admin — sans effet de sécurité (le
// service traite Owner ≠ Admin et exclut déjà l'Owner des cibles).

class SupabaseCivratIdentityRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseCivratIdentityRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  async readOwnerId() {
    const { data, error } = await this.supabase.from("civrat_owner_state").select("owner_id").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data?.owner_id ?? null;
  }

  async writeOwnerId(ownerId) {
    const { error } = await this.supabase
      .from("civrat_owner_state")
      .upsert({ id: 1, owner_id: ownerId, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw error;
  }

  async readAdminIds() {
    const { data, error } = await this.supabase.from("civrat_admins").select("user_id");
    if (error) throw error;
    return (data || []).map((row) => row.user_id);
  }

  async addAdmin(userId) {
    // upsert : l'ajout reste idempotent face à un double-clic de confirmation.
    const { error } = await this.supabase
      .from("civrat_admins")
      .upsert({ user_id: userId, added_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
  }

  async removeAdmin(userId) {
    const { error } = await this.supabase.from("civrat_admins").delete().eq("user_id", userId);
    if (error) throw error;
  }

  async transferOwnership({ newOwnerId }) {
    await this.writeOwnerId(newOwnerId);
    // Le nouveau Owner ne peut rester listé comme admin (Owner ≠ Admin).
    const { error } = await this.supabase.from("civrat_admins").delete().eq("user_id", newOwnerId);
    if (error) throw error;
  }
}

module.exports = { SupabaseCivratIdentityRepository };
