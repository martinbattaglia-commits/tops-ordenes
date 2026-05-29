/**
 * Mock ARCA Service — simula WSFEv1 sin tocar AFIP.
 *
 * Devuelve CAE, vencimiento y número autorizado con la misma forma que el
 * web service real, de modo que la capa de invoicing funcione idéntica en
 * sandbox y en producción. La numeración es persistente en memoria por
 * proceso (suficiente para sandbox; en producción la da ARCA).
 */

import type {
  IArcaService,
  ArcaEmisor,
  CbteTipoCode,
  FECAESolicitarRequest,
  FECAESolicitarResponse,
  FECAEDetResponse,
} from "./types";

function yyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function yyyymmddHHmmss(d: Date): string {
  return (
    yyyymmdd(d) +
    String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0") +
    String(d.getSeconds()).padStart(2, "0")
  );
}

/** Genera un CAE de 14 dígitos verosímil (no válido fiscalmente). */
function fakeCae(): string {
  const prefix = "7"; // los CAE suelen arrancar en 7
  let rest = "";
  for (let i = 0; i < 13; i++) rest += Math.floor(Math.random() * 10);
  return prefix + rest;
}

export class MockArcaService implements IArcaService {
  readonly ambiente: ArcaEmisor["ambiente"] = "SANDBOX";

  /** Contador en memoria por `${ptoVta}-${cbteTipo}`. */
  private static counters = new Map<string, number>();

  private key(ptoVta: number, cbteTipo: CbteTipoCode): string {
    return `${ptoVta}-${cbteTipo}`;
  }

  async ultimoComprobanteAutorizado(
    ptoVta: number,
    cbteTipo: CbteTipoCode
  ): Promise<number> {
    return MockArcaService.counters.get(this.key(ptoVta, cbteTipo)) ?? 0;
  }

  async solicitarCAE(
    req: FECAESolicitarRequest,
    emisor: ArcaEmisor
  ): Promise<FECAESolicitarResponse> {
    // Latencia simulada de red.
    await new Promise((r) => setTimeout(r, 250));

    const { PtoVta, CbteTipo } = req.FeCabReq;
    const now = new Date();
    const vto = new Date(now);
    vto.setDate(vto.getDate() + 10); // CAE vence ~10 días

    const detResp: FECAEDetResponse[] = req.FeDetReq.map((det) => {
      // Avanza el contador como lo haría ARCA.
      const next =
        (MockArcaService.counters.get(this.key(PtoVta, CbteTipo)) ?? 0) + 1;
      MockArcaService.counters.set(this.key(PtoVta, CbteTipo), next);

      return {
        Concepto: det.Concepto,
        DocTipo: det.DocTipo,
        DocNro: det.DocNro,
        CbteDesde: det.CbteDesde,
        CbteHasta: det.CbteHasta,
        CbteFch: det.CbteFch,
        Resultado: "A",
        CAE: fakeCae(),
        CAEFchVto: yyyymmdd(vto),
        Observaciones: [
          {
            Code: 0,
            Msg: "Comprobante autorizado en ambiente SANDBOX (mock). Sin validez fiscal.",
          },
        ],
      };
    });

    return {
      FeCabResp: {
        Cuit: emisor.cuit.replace(/\D/g, ""),
        PtoVta,
        CbteTipo,
        FchProceso: yyyymmddHHmmss(now),
        CantReg: req.FeCabReq.CantReg,
        Resultado: "A",
        Reproceso: "N",
      },
      FeDetResp: detResp,
      Events: [
        { Code: 0, Msg: "Mock ARCA Service — ambiente de prueba." },
      ],
    };
  }
}
