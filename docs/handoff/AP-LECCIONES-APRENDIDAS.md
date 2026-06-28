# Lecciones Aprendidas — Conciliación OC↔Factura + Validación de Compras

Fecha: 2026-06-28 · Rama: `feat/conciliacion-oc`

## Técnicas
1. **El módulo de Conciliación nunca había sido funcional en producción.** A pesar de tener migraciones/RPCs desplegadas (Release 1), 4 bugs de runtime + la falta del on-ramp lo hacían inoperable. Lección: *desplegar el backend no equivale a un circuito validado de punta a punta*; la validación E2E sobre datos reales es insustituible.
2. **TZ de fechas: un solo formateador canónico.** Conviven dos: `utils.ts` (corregido con TZ AR fija, fix d) y `compras/format.ts` (TZ de máquina). El fix se aplicó a uno y no al otro → el bug −1 día persiste en los listados de Compras (H-2) y se filtra hasta la comparación de conciliación. Lección: *al corregir un bug transversal de formato/TZ, auditar TODOS los formateadores y componentes (incl. la vista previa A4 de OC — H-3), no solo el que disparó el incidente*.
3. **Causa raíz del incidente OCR.** Las facturas con líneas negativas (p.ej. "Seña") producían importes negativos que el guard `Number(x) || 0` dejaba pasar y rompían `z.min(0)` con un mensaje técnico. Lección: *los guards `|| 0` no atrapan negativos; validar y mensajear por campo*.
4. **CUIT sin normalizar (H-1).** El alta nueva guarda el CUIT en crudo mientras el legacy usa guiones → el `UNIQUE(cuit)` no frena duplicados por formato. Lección: *normalizar identificadores a forma canónica antes de persistir y de indexar la unicidad*.
5. **HTTP 503 = entorno, no código.** El 503 al guardar era cold-start + ráfaga concurrente del preview de Netlify; el RPC commiteaba bien. Lección: *distinguir fallas de infraestructura (preview draft) de bugs de código antes de "arreglar" el código*.

## De proceso
6. **Trabajo con gates explícitos.** Mantener separados validación / commit / push / merge / deploy, con autorización por etapa, evitó cambios prematuros en producción y permitió consolidar toda la documentación en un único commit de cierre.
7. **Trazabilidad de deploy desde el día uno.** `/api/version` + inyección de build (runbook `RELEASE.md`) permite confirmar que el SHA publicado es el esperado — control de release auditable.
8. **Datos de prueba como fixtures.** Conservar FP-2026-0024/0025/0026 y los proveedores QA permitió re-verificar en vivo (incl. el handoff a Tesorería y la conciliación ya aprobada) sin reconstruir escenarios.
