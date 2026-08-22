import { redirect } from "next/navigation";

export default function LegacyFinanceInboxRedirect() {
  redirect("/tesoreria/inbox");
}
