import { Icon } from "@/components/Icon";
import { getConversation, listMessages } from "@/lib/connect/read/inbox-data";
import { listConversationLinks, getCurrentUserId } from "@/lib/connect/data";
import { getMyRole, listParticipants, listPinned } from "@/lib/connect/read/channel-data";
import { getProfileRole } from "@/lib/rbac/boot-permissions";
import { canChannel } from "@/lib/rbac/nexus-link";
import { ENTITY_TYPE_LABELS, type ConversationKind } from "@/lib/connect/types";
import { getWaContact } from "@/lib/connect/read/wa-contact";
import { ThreadView } from "../../_components/ThreadView";
import { WaContactCard } from "../../_components/WaContactCard";
import { ConversationAdmin } from "../../_components/ConversationAdmin";
import { JoinChannelPrompt } from "../../_components/JoinChannelPrompt";
import { UnarchiveButton } from "../../_components/UnarchiveButton";

export const dynamic = "force-dynamic";

// INC-04-R2/H-2 · CUARTO mapa incompleto, y el único que el compilador no veía:
// estaba tipado `Record<string, string>`, así que la ausencia de `task` no era
// un error de tipos. El arreglo real es el TIPO: con `ConversationKind` como
// clave, el próximo kind que entre al universo rompe la compilación acá también.
const KIND_LABEL: Record<ConversationKind, string> = {
  dm: "Mensaje directo", group: "Grupo", channel: "Canal", erp: "Contexto ERP",
  incident: "Incidente", task: "Tarea", whatsapp: "WhatsApp", ai: "Asistente",
};

export default async function ConnectThreadPage({
  params,
}: {
  params: { conversationId: string };
}) {
  // Un único instante por request: se serializa y se reutiliza en SSR y en el
  // primer render del cliente, incluso si la hidratación cruza medianoche.
  const initialNowIso = new Date().toISOString();
  const [conversation, messages, links, currentUserId, participants] = await Promise.all([
    getConversation(params.conversationId),
    listMessages(params.conversationId),
    listConversationLinks(params.conversationId),
    getCurrentUserId(),
    // F4.1B: mencionables (@) — miembros con nombre resuelto (la FK de menciones exige miembros).
    listParticipants(params.conversationId),
  ]);
  const mentionables = participants
    .filter((m) => m.profileId && m.name)
    .map((m) => ({ profileId: m.profileId as string, name: m.name as string }));

  // Frontera de canal (0236) en la RUTA, no sólo en la lista: entrar por URL
  // directa a un hilo de WhatsApp sin la capacidad devuelve la MISMA respuesta
  // que un hilo inexistente. No se confirma ni se desmiente su existencia, y no
  // se rendereó ningún contenido antes de decidir.
  const accesoDenegadoPorCanal =
    conversation?.kind === "whatsapp" && !(await canChannel("nexus_link.whatsapp.read"));

  if (!conversation || accesoDenegadoPorCanal) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Icon name="x" size={22} className="text-fg-muted" />
        <p className="text-sm text-fg-muted">La conversación no existe o no tenés acceso.</p>
      </div>
    );
  }

  // DEFECT-8/9/10: canales y grupos exponen la superficie de administración compartida DESDE ESTA RUTA
  // (la del sidebar), con el MISMO criterio de permisos que /connect/canales/[slug]
  // (owner/moderator/admin). Los grupos no tienen slug ni entran al directorio → esta es su única
  // superficie de administración.
  if (conversation.kind === "channel" || conversation.kind === "group") {
    const [myRole, profileRole, members, pinned] = await Promise.all([
      getMyRole(conversation.id),
      getProfileRole(),
      listParticipants(conversation.id),
      listPinned(conversation.id),
    ]);
    // F4.1D · F-1: no-miembro no-admin en canal PÚBLICO activo → rama "Unirme" (espejo de
    // /connect/canales/[slug]). Antes veía el hilo vacío (RLS) y el envío fallaba.
    if (
      conversation.kind === "channel" &&
      conversation.visibility === "public" &&
      !conversation.archivedAt &&
      myRole === null &&
      profileRole !== "admin"
    ) {
      return (
        <JoinChannelPrompt
          conversationId={conversation.id}
          title={conversation.title ?? (conversation.slug ? `#${conversation.slug}` : "Canal")}
        />
      );
    }
    return (
      <ConversationAdmin
        conversationId={conversation.id}
        kind={conversation.kind}
        title={conversation.title}
        topic={conversation.topic}
        slug={conversation.slug}
        contextId={conversation.contextId}
        visibility={conversation.visibility}
        archivedAt={conversation.archivedAt}
        myRole={myRole}
        isAdmin={profileRole === "admin"}
        members={members}
        pinned={pinned}
        initialMessages={messages}
        currentUserId={currentUserId}
        links={links}
        archiveRedirectTo="/connect"
        initialNowIso={initialNowIso}
      />
    );
  }

  // Ficha de contacto: SÓLO para WhatsApp y sólo después de la guarda. El
  // resolutor vuelve a exigir la capacidad por su cuenta, así que aunque este
  // llamado se moviera de lugar no podría entregar el teléfono a quien no
  // corresponde. Un hilo interno no la pide y por eso no la muestra.
  const contactoWa =
    conversation.kind === "whatsapp" ? await getWaContact(conversation.id) : null;

  // Otras conversaciones (dm / erp / incident / whatsapp / ai): header + hilo (comportamiento actual).
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header del hilo */}
      <header className="flex items-center justify-between gap-3 border-b border-stroke-soft bg-bg-surface px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-bold text-fg-primary">
              {conversation.title ?? KIND_LABEL[conversation.kind]}
            </h2>
            <span className="chip text-[10px]">{KIND_LABEL[conversation.kind]}</span>
            {conversation.archivedAt && (
              <>
                <span className="chip text-[10px] bg-amber-400/15 text-amber-500">
                  <Icon name="folder" size={10} /> Archivado
                </span>
                {/* H1 (D3): reversa visible también en hilos de entidad. */}
                <UnarchiveButton conversationId={conversation.id} />
              </>
            )}
          </div>
          {/* UX-003: línea humana (tema); el context_id técnico pasa a tooltip.
              LINK-MEDIA-001: en WhatsApp el context_id ES el teléfono, y un dato
              personal no se expone como cadena técnica al pasar el mouse: para
              eso está ahora la ficha de contacto, que es explícita y deliberada. */}
          <p
            className="mt-0.5 truncate text-[11px] text-fg-muted"
            title={conversation.kind === "whatsapp" ? undefined : conversation.contextId ?? undefined}
          >
            {conversation.topic ?? "Sin tema"}
          </p>
        </div>
        {/* El contenedor se monta SÓLO si hay algo adentro: el header es un flex
            con `gap-3`, y un div vacío igual consume esa separación, recortando
            12px al título en todo hilo sin vínculos ni ficha. */}
        {(contactoWa || links.length > 0) && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {contactoWa && <WaContactCard contacto={contactoWa} />}
            {links.map((l) => (
              <span key={l.id} className="chip text-[10px]" title={l.entityId ?? l.entityIdText ?? ""}>
                <Icon name="database" size={11} className="text-fg-link" />
                {ENTITY_TYPE_LABELS[l.entityType]}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* WA-8 · el kind REAL viaja hasta el composer: es el único criterio de
          ruteo entre Connect y el outbound WhatsApp. */}
      <ThreadView
        conversationId={conversation.id}
        kind={conversation.kind}
        initialMessages={messages}
        currentUserId={currentUserId}
        readOnly={!!conversation.archivedAt}
        mentionables={mentionables}
        initialNowIso={initialNowIso}
        handoverState={(conversation as unknown as { handover_state?: "BOT_ACTIVE" | "PAUSED_HUMAN" }).handover_state ?? "BOT_ACTIVE"}
        lastCustomerMessageAt={messages.filter(m => m.wa?.direction === "inbound").pop()?.createdAt ?? conversation.lastMessageAt}
      />
    </div>
  );
}
