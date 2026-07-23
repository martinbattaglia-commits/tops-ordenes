import "server-only";

// Perfil de Usuario (RC1.4) — LECTURA de mi perfil (RLS: 0040 select propia o admin). isMock()→seed.

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { type UserProfile, type PresenceStatus, type NotifFreq, initialsFrom } from "./types";

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export async function getMyProfile(): Promise<UserProfile | null> {
  if (isMock()) return mockProfile();
  const supabase = createClient();
  if (!supabase) return mockProfile();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, avatar_url, presence_status, profile_meta, notif_freq_default")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    fullName: (r.full_name as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    role: String(r.role ?? "operaciones"),
    avatarUrl: (r.avatar_url as string | null) ?? null,
    initials: initialsFrom(r.full_name as string | null),
    presence: ((r.presence_status as string) ?? "offline") as PresenceStatus,
    notifFreq: ((r.notif_freq_default as string) ?? "instant") as NotifFreq,
    preferences: ((r.profile_meta as Record<string, unknown>) ?? {}) as UserProfile["preferences"],
  };
}

function mockProfile(): UserProfile {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    fullName: "Martín Battaglia", email: "martin.battaglia@logisticatops.com", role: "presidente",
    avatarUrl: null, initials: "MB", presence: "online", notifFreq: "instant",
    preferences: { theme: "system", locale: "es-AR", signature: "Martín Battaglia · Logística TOPS" },
  };
}
