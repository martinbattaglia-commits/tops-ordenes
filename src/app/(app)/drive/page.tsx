import { DriveBrowser } from "./DriveBrowser";
import { isDriveConfigured, getServiceAccountEmail } from "@/lib/drive/client";

export const metadata = { title: "Drive TOPS" };
export const dynamic = "force-dynamic";

export default function DrivePage() {
  const configured = isDriveConfigured();
  const sa = getServiceAccountEmail();
  const rootName = configured ? "Drive raíz" : null;
  return (
    <DriveBrowser
      configured={configured}
      serviceAccountEmail={sa}
      rootFolderName={rootName}
    />
  );
}
