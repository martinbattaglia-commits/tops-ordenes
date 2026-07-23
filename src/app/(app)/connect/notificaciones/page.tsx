import { listNotificationCenter } from "@/lib/notifications/data";
import { NotificationCenter } from "../_components/NotificationCenter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Centro de Notificaciones" };

export default async function NotificationCenterPage() {
  const items = await listNotificationCenter();
  return <NotificationCenter items={items} />;
}
