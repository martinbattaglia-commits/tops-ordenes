import { listChannelDirectory } from "@/lib/connect/read/channel-data";
import { ChannelDirectory } from "../_components/ChannelDirectory";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Canales" };

export default async function ConnectChannelsPage() {
  const channels = await listChannelDirectory();
  return <ChannelDirectory channels={channels} />;
}
