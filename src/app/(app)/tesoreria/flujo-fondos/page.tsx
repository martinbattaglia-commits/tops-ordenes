import { redirect } from "next/navigation";

export default function LegacyTreasuryCashflowRedirect() {
  redirect("/finanzas/flujo-fondos");
}
