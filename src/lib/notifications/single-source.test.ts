// NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A · PRE-C4 (D).
//
// Guardián FAIL-CLOSED de la fuente única de verdad. Las tres categorías de la
// campanita y el estado de lectura salen de `v_link_notification_badges` y
// `v_link_my_notifications`. Este archivo escanea el código fuente y rompe si
// reaparece una SEGUNDA implementación personal.
//
// Es un control de código, no de comportamiento: existe porque cada uno de los
// cuatro defectos que se cerraron en este expediente entró por la misma puerta
// —una superficie personal que consultaba `notifications` por su cuenta, o que
// derivaba una cifra de una lista paginada—, y ninguna prueba de
// comportamiento lo habría visto hasta que un usuario lo reportara.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "..", "..");

/** Archivos .ts/.tsx bajo src/, excluidos los de prueba. */
function fuentes(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      fuentes(ruta, acc);
      continue;
    }
    if (!/\.tsx?$/.test(nombre)) continue;
    if (/\.test\.tsx?$/.test(nombre)) continue;
    acc.push(ruta);
  }
  return acc;
}

const ARCHIVOS = fuentes(SRC).map((f) => ({ ruta: relative(SRC, f), texto: readFileSync(f, "utf8") }));

/**
 * Caminos que SÍ pueden tocar `notifications` directamente: son emisores de
 * fan-out con `service_role` o el worker de correo, ninguno es una superficie
 * personal. Lista explícita: un archivo nuevo no se cuela solo.
 */
const EMISORES_AUTORIZADOS = new Set([
  "app/(app)/orders/new/actions.ts",     // insert service_role (aviso de fallo de email)
  "lib/connect/worker/automations.ts",   // insert service_role (efecto de automatización)
  "lib/connect/worker/email-notifications.ts", // worker: lee para enviar, filtra user_id not null
]);

describe("fuente única de verdad · notificaciones", () => {
  it("ninguna superficie personal consulta `notifications` por su cuenta", () => {
    const infractores = ARCHIVOS
      .filter(({ texto }) => /\.from\(\s*["'`]notifications["'`]\s*\)/.test(texto))
      .map(({ ruta }) => ruta)
      .filter((ruta) => !EMISORES_AUTORIZADOS.has(ruta));

    expect(infractores, [
      "Una superficie personal volvió a consultar `notifications` directamente.",
      "El aislamiento por destinatario NO puede delegarse en la RLS: su rama",
      "`current_role() = 'admin'` existe para auditar toda la organización.",
      "Usá `v_link_my_notifications` (lectura) o `v_link_notification_badges`",
      "(contadores). Si el archivo es un emisor con service_role, agregalo a",
      "EMISORES_AUTORIZADOS con su justificación.",
    ].join(" ")).toEqual([]);
  });

  it("nadie vuelve a calcular no-leídos restando secuencias", () => {
    // `connect_messages.seq` es una identidad GLOBAL de tabla: la resta
    // devuelve el ID del último mensaje, no cuántos faltan leer. Es el defecto
    // que produjo los badges 1572 / 1570 / 1569.
    const infractores = ARCHIVOS
      .filter(({ texto }) =>
        /lastMessageSeq\s*(\?\?\s*0\s*)?\)?\s*-\s*lastReadSeq/.test(texto) ||
        /last_message_seq\s*-\s*last_read_seq/.test(texto))
      .map(({ ruta }) => ruta)
      // El generador de datos de demostración reproduce el número histórico a
      // propósito y no toca producción.
      .filter((ruta) => ruta !== "lib/connect/mock.ts");

    expect(infractores).toEqual([]);
  });

  it("la escritura del estado de lectura pasa sólo por las RPC autorizadas", () => {
    const infractores = ARCHIVOS
      .filter(({ texto }) =>
        /\.from\([^)]*notifications[^)]*\)[\s\S]{0,200}?\.update\(/.test(texto))
      .map(({ ruta }) => ruta);

    expect(infractores, [
      "El UPDATE directo sobre `notifications` está cerrado en 0235 (revoke del",
      "grant por columna). Usá connect_notif_mark_read / connect_notif_mark_all_read.",
    ].join(" ")).toEqual([]);
  });

  it("los contadores no dependen de una página de 15 ni de 50 filas", () => {
    // La campanita y el Centro pueden PAGINAR su lista; lo que no puede pasar
    // es que una cifra se derive de esa página, que es lo que hacía el badge
    // rojo original (`.limit(15)` → "9+") y la tarjeta del home (`.limit(50)`).
    const bell = ARCHIVOS.find((a) => a.ruta === "components/shell/NotificationsBell.tsx")!;
    expect(bell.texto).toContain("v_link_notification_badges");
    expect(bell.texto).not.toMatch(/setCounts\([^)]*items/);

    const home = ARCHIVOS.find((a) => a.ruta === "app/(app)/connect/page.tsx")!;
    expect(home.texto).toContain("readNotificationBadges");
    expect(home.texto).not.toMatch(/badge=\{unread\.length\}/);
  });

  it("todas las superficies de badge usan la paleta canónica por categoría", () => {
    // Un pill rojo suelto es una fusión de categorías esperando ocurrir.
    const conBadge = ARCHIVOS.filter(({ texto }) => /unreadCount\s*>\s*0/.test(texto));
    expect(conBadge.length).toBeGreaterThan(0);
    for (const { ruta, texto } of conBadge) {
      expect(texto, `${ruta} pinta un badge sin la paleta por categoría`)
        .toContain("categoryForConversationKind");
    }
  });
});
