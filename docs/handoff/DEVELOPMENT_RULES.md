# TOPS Nexus — Reglas de desarrollo permanentes

> Reglas no-negociables acordadas con la Dirección (Martín Battaglia, presidente de Logística TOPS). Aplican a TODO chat/agente que trabaje sobre este proyecto. Violarlas invalida la tarea.

## 1. Sin acciones automáticas hacia afuera
- **No deploy automático.** Nunca disparar deploy (Netlify u otro) sin pedido explícito.
- **No push automático.** Nunca `git push` sin autorización explícita. `main` se mantiene local hasta que Martín lo decida.
- **No commit automático.** Nunca commitear sin OK explícito. El working tree se prepara (staged) y se muestra; commitea Martín o se commitea con su autorización puntual.

## 2. Diagnóstico antes de implementar
- **Diagnóstico antes de implementar.** No parchear sobre una hipótesis. Identificar la causa raíz con **evidencia de ejecución real** (logs, errores reales con `code/details/hint`), no análisis teórico del SQL/código.
- Lección registrada (incidente 42804): un mensaje de error truncado en UI puede inducir un diagnóstico equivocado. Confirmar con el error completo antes de afirmar la causa.

## 3. Plan antes de código
- **Plan antes de código.** Para features o cambios multi-archivo: diseñar, presentar el alcance, **esperar aprobación**, y recién entonces construir. Metodología gate-heavy: diseño → OK → build → OK, una fase por vez.
- Cambios **aditivos**: no romper ni migrar en masa módulos existentes; sumar sin tocar lo validado.

## 4. Validación antes de cerrar
- **Validación antes de cerrar tarea.** Una tarea no está "hecha" hasta validarla con evidencia (caso de prueba ejecutado, lectura de estado real, build verde). Reportar resultados con honestidad: si algo falla o quedó pendiente, decirlo.

## 5. No tocar lo validado sin autorización
- **No modificar módulos validados sin autorización explícita.** Lo que ya está commiteado y validado (Cockpit, Compras, Tracking, WMS v1, Herramientas V1, etc.) no se altera sin pedido puntual.

## 6. Higiene de commits
- Commits **aislados por módulo/feature** (no mezclar dominios). El incidente del `Sidebar` mixto (WMS + 1 línea Cotizador) confirma la regla: limpiar el staging antes de commitear.
- No commitear secretos. `.env*`, `*.save` fuera de Git.

## 7. Base de datos
- Migraciones **numeradas, secuenciales, aplicadas a mano** por Martín en el SQL Editor de Supabase. El asistente NO puede ejecutar WRITES vía Management API (bloqueado; reads OK).
- Inmutabilidad y auditoría son no-negociables: ledgers append-only, stock solo modificable vía RPC `SECURITY DEFINER`.
- Cambios de esquema: entregar SQL idempotente listo para pegar; Martín lo aplica y confirma.

## 8. Comunicación
- Idioma: español (rioplatense).
- Reportar con precisión verificable: no afirmar "validado" sin evidencia real. No asumir; trabajar con lo verificable en repo/DB.
