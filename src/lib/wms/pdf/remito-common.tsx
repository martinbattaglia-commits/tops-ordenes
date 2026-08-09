import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { DOC, FONT } from "@/lib/doc-system/tokens";
import { ORG } from "@/lib/org";

/**
 * Primitivas de FORMULARIO compartidas por los remitos WMS (entrada/salida).
 * Principio F5: el PDF vuelca los datos que EXISTEN en la entidad y deja
 * líneas/casilleros EN BLANCO donde el dato no existe (líneas grises finas,
 * checkboxes vacíos), igual que la referencia de Dirección (REF-REMITO,
 * 2026-07-28). No inventa datos.
 */

export const remitoStyles = StyleSheet.create({
  fieldsRow: { flexDirection: "row", gap: 14, marginTop: 8 },
  twoCols: { flexDirection: "row", gap: 18 },
  col: { flex: 1 },

  // Tabla de mercadería
  thRow: {
    flexDirection: "row",
    borderBottomWidth: 1.5,
    borderBottomColor: DOC.navy,
    paddingBottom: 3,
    marginTop: 8,
  },
  th: {
    color: DOC.label,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  tr: {
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: 17,
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: DOC.rule,
  },
  cellN: { width: 26, color: DOC.labelSoft, fontFamily: FONT.mono, fontSize: 8 },
  cellDesc: { flex: 1, paddingRight: 6 },
  descLabel: { fontSize: 8.5, fontWeight: 700, color: DOC.ink },
  descSku: { fontSize: 7, color: DOC.labelSoft, fontFamily: FONT.mono },
  cellLote: { width: 76, fontFamily: FONT.mono, fontSize: 8 },
  cellBultos: { width: 46, textAlign: "right", fontFamily: FONT.mono, fontSize: 8.5 },
  cellUnidades: { width: 56, textAlign: "right", fontFamily: FONT.mono, fontSize: 8.5 },

  // Conformidades
  sigRow: { flexDirection: "row", gap: 14, marginTop: 26 },
  sigCol: { flex: 1 },
  sigLine: { borderTopWidth: 0.75, borderTopColor: DOC.labelSoft, paddingTop: 3 },
  sigName: {
    fontSize: 7,
    color: DOC.navy,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sigHint: { fontSize: 7, color: DOC.labelSoft, marginTop: 1 },

  emitterName: { fontSize: 11, fontWeight: 800, color: DOC.navy },
  emitterLine: { fontSize: 8.5, color: DOC.textSec, marginBottom: 2 },
});

const f = StyleSheet.create({
  // Sin flex por defecto: dentro de un contenedor columna, flex:1 colapsa y
  // superpone los campos (react-pdf). En filas se pide explícito con `grow`.
  wrap: {},
  grow: { flex: 1 },
  label: {
    color: DOC.label,
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  value: { color: DOC.ink, fontSize: 9.5, minHeight: 12 },
  valueMono: { fontFamily: FONT.mono, fontSize: 9 },
  valueStrong: { color: DOC.navy, fontWeight: 700 },
  blank: { height: 12, borderBottomWidth: 0.75, borderBottomColor: DOC.rule },
});

/**
 * Campo de formulario: si `value` existe lo imprime; si no, deja la línea
 * gris fina para completar a mano (como en la referencia).
 */
export function FormField({
  label,
  value,
  mono = false,
  strong = false,
  grow = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  strong?: boolean;
  /** flex:1 — usar SOLO dentro de filas (fieldsRow/twoCols). */
  grow?: boolean;
}) {
  return (
    <View style={grow ? f.grow : f.wrap}>
      <Text style={f.label}>{label}</Text>
      {value ? (
        <Text style={[f.value, mono ? f.valueMono : {}, strong ? f.valueStrong : {}]}>
          {value}
        </Text>
      ) : (
        <View style={f.blank} />
      )}
    </View>
  );
}

const cb = StyleSheet.create({
  row: { flexDirection: "row", gap: 4, marginTop: 8 },
  item: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  box: {
    width: 8,
    height: 8,
    borderWidth: 0.75,
    borderColor: DOC.labelSoft,
    borderRadius: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  boxInner: { width: 4.4, height: 4.4, backgroundColor: DOC.navy },
  label: { fontSize: 7.5, color: DOC.textSec },
});

/** Casillero de control: vacío por defecto; marcado sólo si el dato existe. */
export function CheckBox({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <View style={cb.item}>
      <View style={cb.box}>{checked ? <View style={cb.boxInner} /> : null}</View>
      <Text style={cb.label}>{label}</Text>
    </View>
  );
}

export function CheckRow({ items }: { items: { label: string; checked?: boolean }[] }) {
  return (
    <View style={cb.row}>
      {items.map((it) => (
        <CheckBox key={it.label} label={it.label} checked={it.checked} />
      ))}
    </View>
  );
}

/** Bloque de firma con línea superior, rótulo y aclaración (referencia §07). */
export function SignatureBlock({ name, hint }: { name: string; hint: string }) {
  return (
    <View style={remitoStyles.sigCol}>
      <View style={remitoStyles.sigLine}>
        <Text style={remitoStyles.sigName}>{name}</Text>
        <Text style={remitoStyles.sigHint}>{hint}</Text>
      </View>
    </View>
  );
}

// ── Datos compartidos ──────────────────────────────────────────────────────

/** Línea de mercadería del remito (los campos ausentes quedan en blanco). */
export interface RemitoLine {
  descripcion: string;
  sku?: string | null;
  lote?: string | null;
  bultos?: string | null;
  unidades?: string | null;
}

/** Depósito resuelto desde la cadena física del WMS (warehouses seed 0020). */
export interface DepotInfo {
  /** Rótulo corto: 'Magaldi · CABA' / 'Pedro Luján · CABA'. */
  label: string;
  /** Domicilio para el bloque Recibe/Emisor. */
  address: string;
  /** Código canónico `depot_t` (MAGALDI|LUJAN) o null si no mapea. */
  depotCode: string | null;
}

export function depotFromWarehouse(
  code?: string | null,
  name?: string | null
): DepotInfo | null {
  if (!code && !name) return null;
  if (code === "MAGALDI_1765") {
    return {
      label: "Magaldi · CABA",
      address: "Agustín Magaldi 1765 (C1286AFM)",
      // Código canónico, alineado con el enum `depot_t` de `profiles.depot`.
      depotCode: "MAGALDI",
    };
  }
  if (code === "PEDRO_LUJAN_3159") {
    return {
      label: "Pedro Luján · CABA",
      address: "Pedro de Luján 3159",
      depotCode: "LUJAN",
    };
  }
  // Depósito no mapeable a `depot_t`: se deja sin código para que el control
  // de ámbito falle cerrado ante un usuario acotado a un depósito.
  return { label: name ?? code ?? "", address: ORG.address, depotCode: null };
}

/** Filas de la tabla: datos reales primero + relleno en blanco hasta `min`. */
export function padLines(lines: RemitoLine[], min = 6): (RemitoLine | null)[] {
  const out: (RemitoLine | null)[] = [...lines];
  while (out.length < min) out.push(null);
  return out;
}

/** Bloque Verotin / Logística TOPS (Recibe en entrada · Emisor en salida). */
export function EmitterBlock({ depot }: { depot: DepotInfo | null }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={remitoStyles.emitterName}>{ORG.legalName.toUpperCase()}</Text>
      <Text style={[remitoStyles.emitterLine, { marginTop: 2 }]}>
        {ORG.brand} · Operador 3PL
      </Text>
      <Text style={remitoStyles.emitterLine}>
        {depot ? depot.address : ORG.address.split(" — ")[0]}
      </Text>
      <Text style={[remitoStyles.emitterLine, { marginBottom: 6 }]}>CABA · Argentina</Text>
      <View style={remitoStyles.twoCols}>
        <FormField label="CUIT" value={ORG.cuit} mono grow />
        <FormField label="Teléfonos" value={ORG.phone} mono grow />
      </View>
    </View>
  );
}

/** Tabla de detalle de mercadería (05) con relleno de filas en blanco. */
export function RemitoTable({ lines, headerLabel }: { lines: RemitoLine[]; headerLabel: string }) {
  const rows = padLines(lines, 6);
  return (
    <View>
      <View style={remitoStyles.thRow}>
        <Text style={[remitoStyles.th, { width: 26 }]}>N.°</Text>
        <Text style={[remitoStyles.th, { flex: 1 }]}>{headerLabel}</Text>
        <Text style={[remitoStyles.th, { width: 76 }]}>Lote / Serie</Text>
        <Text style={[remitoStyles.th, { width: 46, textAlign: "right" }]}>Bultos</Text>
        <Text style={[remitoStyles.th, { width: 56, textAlign: "right" }]}>Unidades</Text>
      </View>
      {rows.map((line, i) => (
        <View key={i} style={remitoStyles.tr} wrap={false}>
          <Text style={remitoStyles.cellN}>{String(i + 1).padStart(2, "0")}</Text>
          <View style={remitoStyles.cellDesc}>
            {line ? (
              <Text style={remitoStyles.descLabel}>
                {line.descripcion}
                {line.sku ? <Text style={remitoStyles.descSku}>  ({line.sku})</Text> : null}
              </Text>
            ) : null}
          </View>
          <Text style={remitoStyles.cellLote}>{line?.lote ?? ""}</Text>
          <Text style={remitoStyles.cellBultos}>{line?.bultos ?? ""}</Text>
          <Text style={remitoStyles.cellUnidades}>{line?.unidades ?? ""}</Text>
        </View>
      ))}
    </View>
  );
}
