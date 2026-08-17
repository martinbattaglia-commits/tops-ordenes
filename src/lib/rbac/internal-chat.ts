import { canAccess } from "@/lib/rbac/guard";
import { getDepotManagerBoot } from "@/lib/rbac/boot-permissions";

type InternalCapability =
  | "nexus_link.internal_chat.read"
  | "nexus_link.internal_chat.send"
  | "nexus_link.internal_chat.media";

async function check(legacy: "connect.view" | "connect.create", exact: InternalCapability) {
  const scope = await getDepotManagerBoot();
  if (!scope.restricted) return canAccess(legacy);
  if (!scope.authorized) return false;
  return canAccess(exact);
}

export function canReadInternalChat() {
  return check("connect.view", "nexus_link.internal_chat.read");
}

export function canSendInternalChat() {
  return check("connect.create", "nexus_link.internal_chat.send");
}

export function canUseInternalChatMedia() {
  return check("connect.create", "nexus_link.internal_chat.media");
}
