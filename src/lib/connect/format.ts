// Nexus Link · helpers de formato de tiempo (puros, client+server safe).

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

export function timeHM(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
