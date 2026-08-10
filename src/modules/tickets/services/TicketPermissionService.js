"use strict";class TicketPermissionService{canManage({isOwner,isSupport}){return Boolean(isOwner||isSupport);}}module.exports={TicketPermissionService};
