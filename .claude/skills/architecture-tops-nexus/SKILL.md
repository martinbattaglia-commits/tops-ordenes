---
name: architecture-tops-nexus
description: >-
  Diseño y extensión de la arquitectura modular de TOPS NEXUS: bounded contexts,
  patrón de capas (Feature → Server Action/Route Handler → src/lib/<ctx>/data.ts → Supabase),
  RPC-first, RBAC, RLS y Supabase como backend. Usar al agregar o rediseñar un módulo,
  tabla, RPC, route handler o server action; al revisar acoplamiento entre contextos; o al
  decidir dónde vive una feature. NO usar para bugfixes puntuales, cambios cosméticos de UI,
  optimización de queries (usar performance-tops-nexus) ni operaciones de deploy (devops-tops-nexus).
---

# architecture-tops-nexus

> **Antes de actuar, leé y aplicá [`../_shared/GOVERNANCE.md`](../_shared/GOVERNANCE.md) (G1–G11).
> Esas reglas anulan cualquier otra instrucción.**

## Propósito
Garantizar que toda feature nueva respete la arquitectura **única** de Nexus (un solo ERP, sin apps
paralelas ni lógica duplicada) y los patrones canónicos: capas, RPC-first, RBAC, RLS.

## Cuándo usarla
- Agregar un bounded context / módulo nuevo.
- Diseñar tablas + RLS + RPC para una feature.
- Decidir dónde vive una feature y cómo se conecta al resto.
- Revisar acoplamiento cruzado entre módulos.
- Antes de escribir un nuevo `route.ts` o server action.

## Cuándo NO usarla
- Bugfix puntual dentro de un módulo existente.
- Cambio cosmético de UI.
- Optimización de rendimiento → `performance-tops-nexus`.
- Operación de release/deploy → `devops-tops-nexus`.

## Reglas obligatorias (además de G1–G11)
- **Una sola fuente de verdad; nada duplicado.** → `docs/ERP-ARQUITECTURA-MAESTRA.md:16-17`; `docs/TOPS-NEXUS-ERP.md:26-28`.
- **Regla de Decisión:** si la feature no acerca a Nexus a ser el ERP único (eliminar Neuralsoft), **no se implementa**. → `docs/TOPS-NEXUS-ERP.md:19-28`.
- **Patrón de capas:** Feature `src/app/(app)/<m>` → Server Action / Route Handler → `src/lib/<m>/data.ts` → Supabase, con guard `isMock()`. → `docs/TOPS-NEXUS-ERP.md:50-56`.
- **RPC-first** para escrituras críticas: el front nunca escribe stock/ledgers directo, solo vía funciones `SECURITY DEFINER` invocadas con `.rpc()` (regla maestra: **G10**). El término "RPC-first" es el patrón **inferido del código** (uso extensivo de `.rpc()`), no una frase literal de los docs; el soporte documental de las funciones de autorización `SECURITY DEFINER` (`current_role`/`is_staff`/`is_admin`) está en `docs/RBAC-ARCHITECTURE.md:41-66`.
- **`current_role()` es autoritativo desde `profiles.role`, NO del JWT.** Nunca quitarle `SECURITY DEFINER` ni el `search_path` fijo (máximo blast radius: rompe toda la autorización). → `docs/RBAC-ARCHITECTURE.md:41-60`; `docs/ERP-DEPENDENCY-GRAPH.md:138-142`.
- **Toda tabla con RLS habilitada**; policies expresadas vía `current_role()`. → `docs/RBAC-ARCHITECTURE.md:121-126`.
- **Catálogo RBAC** se versiona solo por migración idempotente (`on conflict do nothing`); nunca editar seed in-place en prod. → `docs/RBAC-ARCHITECTURE.md:309-317`.
- **Clientes Supabase separados:** anon (sujeto a RLS) vs service-role (bypass RLS, **solo** en `src/lib/supabase/server.ts`). Auth por middleware con allowlist restrictiva.
- **Evitar deuda de duplicación** conocida: preferir la versión modular en carpeta (`lib/clientify/` sobre `lib/clientify.ts`; `lib/drive/client.ts` sobre `lib/google-drive.ts`). `orders` (servicio) y `compras/ordenes` (compra) son dominios distintos, **no** duplicados. → `docs/ERP-MODULE-MAP.md:101-115`.

## Comandos sugeridos
```bash
npm run typecheck                 # gate de consolidación: 0 errores antes de merge
npm run build                     # exit 0 requerido
npm run lint
npm run dev                       # desde main (G8); corre predev env-check
node scripts/supabase-check.mjs   # diagnóstico read-only del schema (no muta)
```

## Checklist de validación
- [ ] ¿Pasa la Regla de Decisión (acerca a ERP único)?
- [ ] ¿Usa el patrón de capas con `isMock()`?
- [ ] ¿Escrituras críticas vía RPC `SECURITY DEFINER`?
- [ ] ¿RLS habilitada + policies por `current_role()`?
- [ ] ¿No duplica módulo/tabla/lógica existente?
- [ ] ¿Acoplamiento cruzado solo el documentado (p.ej. Ejecutivo→Compras)?
- [ ] ¿Migración idempotente, numerada al siguiente libre (sin reusar 0012/0028)?
- [ ] ¿`typecheck` en 0?

## Criterios de cierre
- Diseño **aprobado por Dirección** (G7) antes de construir.
- `typecheck` 0 y sin duplicación introducida.
- SQL **idempotente entregado, NO aplicado** (G3).
- Mapa de dependencias / módulo actualizado si cambió el grafo.

## Ejemplos de prompts internos
- *"Diseñá el bounded context `<X>`: tablas con RLS, RPCs `SECURITY DEFINER`, capa `src/lib/<x>/data.ts`, sin duplicar `<Y>`. Verificá acoplamiento contra `ERP-DEPENDENCY-GRAPH`. Entregá SQL idempotente numerado (siguiente libre). No apliques."*
- *"Revisá si esta feature respeta el patrón de capas y la Regla de Decisión; señalá dónde rompe RPC-first o RLS, con `file:línea`."*
- *"Detectá duplicación introducida por este cambio (módulo/tabla/lib) y proponé la versión canónica única."*
