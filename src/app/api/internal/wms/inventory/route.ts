import { handleUnconfiguredInventory } from "@/lib/wms/inventory/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleUnconfiguredInventory(request);
}
