# TOPS Nexus — Próximos pasos (roadmap priorizado)

> Generado 2026-06-02. Prioridad por valor operativo × dependencia técnica. Respetar siempre `DEVELOPMENT_RULES.md`.

## 🔴 ALTA PRIORIDAD (cerrar lo abierto antes de abrir nada nuevo)

1. **Validación funcional WMS Sprint 2 — Casos 2 a 6**
   Caso 1 ✅. Faltan: ANMAT (CHECK), Cuarentena + `release_quarantine`, Traslado/Movimientos, Idempotencia, Ledger inmutable. Detalle en `WMS_HANDOFF.md §7`.

2. **Quitar instrumentación temporal** de `src/lib/wms/receptions.ts` (`confirmReception`, bloque `console.error` FULL SUPABASE ERROR). Es código de diagnóstico, no de producción.

3. **Commit aislado de WMS Sprint 2** (post-validación): migraciones `0025/0026/0027` + `src/lib/wms/*` + UI recepciones/movimientos. Método: staged → revisión → OK. NO mezclar con el Grupo C.

4. **Backup/decisión de push de `main`** — `main` tiene **19 commits sin pushear**; todo el trabajo nuevo vive solo local. Definir estrategia (push a remoto privado o backup) para eliminar el riesgo de pérdida total.

5. **Decidir destino del Grupo C** (15 modificados parked: `clients/*`, `clientify`, `org`, `globals.css` a11y, `middleware` tracking ingest, `compras/pdf`+`email`, `OrderDetailTabs`): commitear, descartar o aislar.

## 🟡 MEDIA PRIORIDAD (siguiente capa de valor WMS + operación)

6. **Quarantine Flow (UI)** — vista para liberar cuarentena (`release_quarantine`) con confirmación y trazabilidad ANMAT. Backend ya existe.

7. **Transferencias (UI de Movimientos)** — alta de `traslado`/`ajuste`/`egreso` desde UI sobre `confirm_movement` (hoy solo por RPC). Selección de posición destino, validaciones.

8. **Picking** — diseño de órdenes de picking sobre inventario (reserva → `stock_reserved`), wave/ruta dentro del Mapa Inteligente.

9. **Expediciones / Despachos** — salida (`egreso`) consolidada, remito de salida, integración con Pedidos.

10. **Digital Twin completo (v2)** — espacios operativos `facility_space` + business_unit + cubículos clasificados. **BLOQUEADO** hasta recibir la matriz maestra de relevamiento de Dirección. Migración `0028_facility_spaces.sql`. NO iniciar sin la matriz.

11. **Dashboard Ejecutivo** — consolidar KPIs cross-módulo (Compras, Operaciones, WMS, Tracking) en el Cockpit.

## 🟢 BAJA PRIORIDAD (integraciones y capas de alcance amplio)

12. **CRM** — profundizar Comercial más allá de Herramientas V1 (pipeline, oportunidades, sincronización con portal B2B).

13. **Clientify** — integración real de contactos/empresas/deals (MCP `clientify_*` ya disponible) hacia el módulo Comercial.

14. **Google Workspace** — profundizar el dominio Workspace (Drive/Calendar/Gmail) según necesidades operativas.

15. **Tracking de Flota** — evolución sobre la base GPS/PostGIS ya productiva (geofences, eventos, alertas, reporting).

16. **Mapa Operativo** — vista operación en tiempo real (flota + sedes) en el Cockpit.

17. **Mapa Inteligente (escala)** — escalar el Digital Twin a todas las sedes/posiciones con performance y filtros.

## Regla de secuenciamiento
No abrir un sprint nuevo de WMS (Picking/Expediciones) hasta que **Recepciones + Movimientos** estén validados (6 casos) y commiteados. No tocar módulos validados sin autorización explícita (`DEVELOPMENT_RULES.md`).
