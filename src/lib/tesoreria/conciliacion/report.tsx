/**
 * Informe PDF de Conciliación Bancaria — Sprint 3.
 *
 * Genera el informe ejecutivo con @react-pdf/renderer (ya dependencia del
 * proyecto). Server-side: `renderConciliacionPdf` devuelve un Buffer para la
 * ruta de descarga. Incluye: resumen ejecutivo (KPIs), movimientos sistémicos,
 * conciliados, pendientes y diferencias, y el cruce de saldo.
 */
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { DashboardConciliacion } from "./dashboard";
import type { MatchLinea } from "./matching";

const peso = (c: number) => "$ " + (c / 100).toLocaleString("es-AR", { minimumFractionDigits: 2 });

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, color: "#0b1220", fontFamily: "Helvetica" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#050555" },
  sub: { fontSize: 9, color: "#5a6577", marginBottom: 10 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4, color: "#214576" },
  kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kpi: { width: "23.5%", border: "1 solid #dde3ec", borderRadius: 4, padding: 6 },
  kpiLabel: { fontSize: 7, color: "#69738a", textTransform: "uppercase" },
  kpiVal: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", borderBottom: "0.5 solid #eef1f6", paddingVertical: 2 },
  th: { flexDirection: "row", borderBottom: "1 solid #214576", paddingVertical: 3, fontFamily: "Helvetica-Bold" },
  cL: { flex: 1 },
  cR: { width: 90, textAlign: "right" },
  cC: { width: 60, textAlign: "center" },
  foot: { marginTop: 16, fontSize: 7, color: "#8a94a6", textAlign: "center" },
});

export function ConciliacionReportDoc({
  banco,
  periodo,
  metrics,
  matches,
}: {
  banco: string;
  periodo: string;
  metrics: DashboardConciliacion;
  matches: MatchLinea[];
}) {
  const deltaOk = metrics.deltaSaldoCents === 0;
  const diferencias = matches.filter((m) => m.estado === "posible" || m.estado === "no_conciliado");
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Informe de Conciliación Bancaria</Text>
        <Text style={s.sub}>
          {banco.toUpperCase()} · {periodo} · TOPS NEXUS — Tesorería
        </Text>

        <Text style={s.h2}>Resumen ejecutivo</Text>
        <View style={s.kpiRow}>
          <View style={s.kpi}><Text style={s.kpiLabel}>Conciliados</Text><Text style={s.kpiVal}>{metrics.conciliados}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Posibles</Text><Text style={s.kpiVal}>{metrics.posibles}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>No conciliados</Text><Text style={s.kpiVal}>{metrics.noConciliados}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Sistémicos</Text><Text style={s.kpiVal}>{metrics.sistemicos}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Monto conciliado</Text><Text style={s.kpiVal}>{peso(metrics.montoConciliadoCents)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Monto pendiente</Text><Text style={s.kpiVal}>{peso(metrics.montoPendienteCents)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Δ Saldo</Text><Text style={s.kpiVal}>{deltaOk ? "$ 0,00 ✔" : peso(metrics.deltaSaldoCents)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>% Conciliado</Text><Text style={s.kpiVal}>{metrics.pctConciliado}%</Text></View>
        </View>

        <Text style={s.h2}>Movimientos sistémicos</Text>
        <View style={s.th}><Text style={s.cL}>Concepto</Text><Text style={s.cC}>Mov.</Text><Text style={s.cR}>Monto</Text><Text style={s.cC}>%</Text></View>
        {metrics.sistemicosPorSubtipo.map((x) => (
          <View key={x.subtipo} style={s.row}>
            <Text style={s.cL}>{x.label}</Text>
            <Text style={s.cC}>{x.count}</Text>
            <Text style={s.cR}>{peso(x.montoCents)}</Text>
            <Text style={s.cC}>{x.pctMonto}%</Text>
          </View>
        ))}

        <Text style={s.h2}>Diferencias detectadas ({diferencias.length})</Text>
        <View style={s.th}><Text style={s.cL}>Movimiento banco</Text><Text style={s.cR}>Importe</Text><Text style={s.cC}>Score</Text><Text style={s.cL}>Motivo</Text></View>
        {diferencias.slice(0, 40).map((d, i) => (
          <View key={i} style={s.row}>
            <Text style={s.cL}>{d.linea.descripcion.slice(0, 40)}</Text>
            <Text style={s.cR}>{peso(d.linea.importe)}</Text>
            <Text style={s.cC}>{d.score > 0 ? `${d.score}%` : "—"}</Text>
            <Text style={s.cL}>{d.motivo}</Text>
          </View>
        ))}

        <Text style={s.foot}>
          {deltaOk
            ? "Cruce de saldo: extracto = Nexus (Δ 0,00). Reconciliación matemáticamente consistente."
            : "ATENCIÓN: el saldo del extracto no cuadra con Nexus — revisar diferencias."}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderConciliacionPdf(props: {
  banco: string;
  periodo: string;
  metrics: DashboardConciliacion;
  matches: MatchLinea[];
}): Promise<Buffer> {
  return renderToBuffer(<ConciliacionReportDoc {...props} />);
}
