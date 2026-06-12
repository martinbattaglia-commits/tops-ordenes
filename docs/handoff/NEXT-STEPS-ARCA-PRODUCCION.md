# NEXT-STEPS-ARCA-PRODUCCION — Hoja de ruta al ambiente productivo (NO iniciado)

**Fecha:** 2026-06-12 · **Naturaleza:** PLANIFICACIÓN — nada de este documento se ejecuta sin autorización presidencial. ARCA Producción NO está iniciado.

> **Posición actual:** la base fiscal está lista. Dominio canónico con garantías de base (0072), libros de compras y ventas con signo y corte de ambiente (0071/0073), NC/ND reales (RG 4540), anti doble facturación, emisión transaccional probada en vivo. Lo que falta para facturar de verdad es, casi exclusivamente, **credenciales y homologación** — más la depuración del stock SANDBOX.

## §1 — Prerrequisitos técnicos (en orden)

| # | Paso | Detalle | Estado |
|---|---|---|---|
| 1 | **Certificado X.509 + CSR** ante ARCA | alias informático para WSFE; clave privada en el host (cert_alias en fiscal_config ya previsto, 0011) | ⏳ trámite del contribuyente |
| 2 | **Habilitar WSFEv1** en el portal (Adm. de Relaciones) | asociar el servicio al CUIT 33-60489698-9 | ⏳ |
| 3 | **HOMOLOGACIÓN** | cargar credenciales homo en Netlify env; `fiscal_config.ambiente='HOMOLOGACION'`; suite real: Factura A → NC parcial (CbtesAsoc) → NC excedente (debe rechazar 10192) → anulación total — el plan de FISCAL-HARDENING §1 ya define los 4 casos | ⏳ |
| 4 | **Punto de venta WEBSERVICE productivo** | confirmar PV (hoy default 2; el PV 3 'Web Service — Nexus' ya existe en puntos_venta) y dar de alta en ARCA | ⏳ decisión |
| 5 | **Switch a PRODUCCIÓN** | `fiscal_config.ambiente='PRODUCCION'` → el corte de validez excluye AUTOMÁTICAMENTE los 3 comprobantes SANDBOX de KPIs, tesorería y libros (cero migraciones) | listo en diseño |
| 6 | **Depuración operativa del stock SANDBOX** | las 2 facturas de mayo tienen cobranzas REALES imputadas (~$2.190.000, cuentas Galicia/Santander): reimputar/anular los recibos ANTES del switch — decisión de Tesorería con gate propio | ⚠️ requiere plan |
| 7 | **Restaurar el estado de las OS de prueba** | OS-201613 (Verotin) quedó FACTURADA por la factura SANDBOX 2-3; revisar si vuelve a operativa | ⚠️ menor |

## §2 — Gaps de diseño que conviene cerrar ANTES de producción (del diseño aprobado)
1. **G9 — letra por condición IVA** (V2 del roadmap original): hoy la emisión consolidada hardcodea Factura A/RI; en producción real un monotributista debe recibir B. `comprobanteParaReceptor()` ya existe — falta conectarlo. **Bloqueante práctico para facturar a clientes reales no-RI.**
2. **G1 — exento / no gravado** (V3): hoy hardcodeados en 0 — solo si la operación lo requiere.
3. **G4 — percepciones emitidas** (V3): requiere completar el array `Tributos` de WSFEv1 — solo si Verotin es agente de percepción.
4. **PDF al bucket** (`storeInvoicePdf` sin call sites): el comprobante legal hoy se regenera on-demand; en producción conviene materializarlo.
5. **Fecha de emisión fiscal propia** (G3): los libros usan `created_at`/`periodo`; con ARCA real conviene persistir `CbteFch` como columna (`fecha_emision`) — previsto en DOMAIN-DESIGN §3.3.

## §3 — Qué NO hace falta tocar
El cliente WSFEv1 (SOAP + WSAA + CMS) ya está implementado (`src/lib/arca/{wsaa,wsfev1,soap,cms-forge,production-service}.ts`); `CbtesAsoc` ya se envía; el QR fiscal RG 4892 ya se genera; la numeración productiva la manda ARCA (el guard de SANDBOX no interviene). El switch es de **configuración**, no de arquitectura.

## §4 — Después de ARCA Producción (continuación del diseño aprobado)
V3 (retenciones/percepciones + exento/no gravado) → V4 (posición IVA mensual + paquete de cierre + TXT RG 4597) → V5 (conciliación ARCA ↔ Nexus: import "Mis Comprobantes" + FECompConsultar — su prerequisito G5/G10 ya quedó cerrado en hardening).

> Nada de lo anterior se inicia sin autorización presidencial explícita, fase por fase.
