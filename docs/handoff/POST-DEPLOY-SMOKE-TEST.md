# POST-DEPLOY-SMOKE-TEST — TOPS NEXUS

**Fecha:** 2026-06-08 · Verificación post-deploy en producción (dominio Netlify, sesión autenticada).
**Tiempo estimado:** ~10 min. Marcar cada ítem; un fallo crítico → ROLLBACK-PLAN.md.

---

## 0. Infra
- [ ] El dominio prod carga (no 502/504). Estado Netlify = **Published**.
- [ ] Sin errores en la consola del navegador al cargar (F12 → Console).
- [ ] Sin warnings de hydration.

## 1. Auth / navegación
- [ ] Login con usuario real → entra al Cockpit.
- [ ] Sidebar: abrir 1 ítem por módulo (sin 404). Los 59 links resuelven (verificado en build).
- [ ] Topbar / breadcrumbs OK. Dark mode coherente.

## 2. CRM360 (core del release)
- [ ] `/comercial/oportunidades` abre en **Kanban** por defecto.
- [ ] Buscar "ANMAT" / un nombre / "OPP-2026" filtra en tiempo real; término inexistente → "No se encontraron oportunidades".
- [ ] Solo se ven pipelines ANMAT / Cargas Generales / Oficinas (sin "Logística Tops").
- [ ] **Ningún título es una URL** `https://api.clientify.net/...` (cards, tabla, ficha).
- [ ] Ficha 360°: header con nombre legible; pestaña **Contrato** muestra plantilla por servicio (ANMAT → Contrato ANMAT; Cargas Generales/Oficinas → Aceptación y Condiciones) + **estado documental** (badge color).

## 3. Digital Twin + reservas
- [ ] `/comercial/mapa-magaldi` y `/mapa-lujan` renderizan con colores desde `crm_units`.
- [ ] Click en unidad **disponible** (verde) → SidePanel → "Reservar unidad" → deep link a CRM360 con unidad precargada en Capacidad.
- [ ] Reservar y refrescar el mapa → la unidad pasa a **amarillo** (reservada).
- [ ] 2º intento sobre la misma unidad → mensaje **"Unidad ya reservada"** (atomicidad).

## 4. RRHH
- [ ] `/rrhh/empleados` lista; abrir 1 legajo.
- [ ] Documentos y recibos accesibles (signed URL OK).

## 5. Compliance
- [ ] Score visible; abrir 1 ficha; navegación OK.

## 6. Drive TOPS
- [ ] `/drive` lista carpetas desde el **root correcto** (no vacío/no de prueba).
- [ ] Búsqueda y navegación de carpetas OK. (Valida `GOOGLE_DRIVE_ROOT_FOLDER_ID`.)

## 7. Facturación
- [ ] Pendientes y emitidos cargan; KPIs con números (no NaN/—).

## 8. Integraciones
- [ ] Clientify: la data de CRM360 se ve (lectura de `crm_opportunities`). Si se usa sync live, confirmar que no hay 401 en logs (valida `CLIENTIFY_API_KEY` prod).

---

## Criterio GO/rollback
- **Todos los ítems de 0–2 OK** + sin fallos críticos en 3–7 → **release confirmado**.
- Fallo crítico (login, módulo core caído, 500 generalizado, títulos con URL) → **ROLLBACK** (Opción A inmediata).
- Fallo cosmético/menor → registrar en backlog, NO rollback.
