import { Icon } from "@/components/Icon";
import { listMessages } from "@/lib/connect/read/inbox-data";
import { getCurrentUserId } from "@/lib/connect/data";
import { getChannelBySlug, getMyRole, listParticipants, listPinned } from "@/lib/connect/read/channel-data";
import { ChannelView } from "../../_components/ChannelView";

export const dynamic = "force-dynamic";

export default async function ConnectChannelPage({ params }: { params: { slug: string } }) {
  // DEFECT-6: getChannelBySlug incluye archivados → un canal archivado abierto por URL directa
  // resuelve y ChannelView lo muestra read-only (en vez de "no existe").
  const channel = await getChannelBySlug(params.slug);

  if (!channel) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Icon name="x" size={22} className="text-fg-muted" />
        <p className="text-sm text-fg-muted">El canal no existe o no tenés acceso.</p>
      </div>
    );
  }

  const myRole = await getMyRole(channel.id);

  if (!myRole) {
    // Canal público del que NO soy miembro: vista de unión (sin mensajes — RLS exige membresía).
    return <ChannelView channel={channel} myRole={null} currentUserId={null} />;
  }

  const [initialMessages, members, pinned, currentUserId] = await Promise.all([
    listMessages(channel.id),
    listParticipants(channel.id),
    listPinned(channel.id),
    getCurrentUserId(),
  ]);

  return (
    <ChannelView
      channel={channel}
      myRole={myRole}
      members={members}
      pinned={pinned}
      initialMessages={initialMessages}
      currentUserId={currentUserId}
    />
  );
}
