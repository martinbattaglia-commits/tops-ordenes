import { getTableroData } from "@/lib/comercial/dashboard-data";
import { TableroShell } from "@/components/comercial/tablero/TableroShell";

export const metadata = { title: "Tablero Comercial · Clientify" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TableroPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[]>;
}) {
  const data = await getTableroData();
  return <TableroShell data={data} initialParams={searchParams ?? {}} />;
}
