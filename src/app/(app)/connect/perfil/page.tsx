import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { getMyProfile } from "@/lib/profile/data";
import { ProfileForm } from "../_components/ProfileForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nexus Link · Mi perfil" };

export default async function ProfilePage() {
  const profile = await getMyProfile();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-stroke-soft bg-bg-surface px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon name="user" size={16} className="text-fg-link" />
          <h1 className="text-sm font-bold text-fg-primary">Mi perfil</h1>
        </div>
      </header>

      {profile ? (
        <ProfileForm profile={profile} />
      ) : (
        <EmptyState
          icon="user"
          title="No pudimos cargar tu perfil"
          hint="Tu sesión no está autenticada o el perfil aún no está disponible. Volvé a iniciar sesión e intentá de nuevo."
        />
      )}
    </div>
  );
}
