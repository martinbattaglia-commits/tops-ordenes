# Runbook de Release — Reglas Fiscales Contadora (2026-06-28)

Release de las 8 reglas fiscales/contables (branch `feat/fiscal-contadora-rules`).
Sigue el proceso general de [`RELEASE.md`](./RELEASE.md) y agrega los pasos de migración
y de activación MiPyME. **Orden obligatorio: migraciones → código → verificación.**

Entorno prod (único): Supabase `arsksytgdnzukbmfgkju` · Netlify `tops-ordenes`
(https://nexus.logisticatops.com).

## 0. Pre-checks
- [ ] Gates en verde local: `npm run lint && npm run typecheck && npm run test && npm run build`.
- [ ] Working tree limpio y commiteado (deploy reproducible; el prebuild lo exige).
- [ ] Backup/seguridad: las migraciones son idempotentes y additive-only; no borran datos.

## 1. Migraciones (aplicar a Supabase prod, EN ORDEN)
Aplicar 0120 → 0124. Todas idempotentes (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`),
por lo que en prod son no-op salvo lo nuevo. Validadas previamente vía transacción + ROLLBACK.

| Mig | Efecto en prod | Verificación post-aplicación |
|-----|----------------|------------------------------|
| `0120_chart_of_accounts_baseline` | Versiona chart_of_accounts/accounting_rules + agrega 12 cuentas gasto | `select count(*) from chart_of_accounts;` → **79** (era 67) |
| `0121_legajo_cuenta_contable` | `cuenta_contable` en vendors y clients | columnas presentes en `information_schema.columns` |
| `0122_mipyme_foundation` | Campos MiPyME + `mipyme_config` (activo=false) | `select activo from mipyme_config;` → **false** |
| `0123_comprobante_tipo_fce_enum` | Valores FCE en enum comprobante_tipo_t | 6 labels nuevos en `pg_enum` |
| `0124_contabilidad_permissions_seed` | Seed perms contabilidad.* (ya existen en prod → no-op) | `select count(*) from permissions where slug like 'contabilidad.%';` → **5** |

> Nota: prod renombra migraciones a timestamp al aplicar. Verificar numeración real antes.

## 2. Deploy de código
```bash
git status                      # limpio
npm run build                   # banner ▶ BUILD VERSION sha=… branch=feat/fiscal-contadora-rules
npx netlify deploy --prod       # sube el .next construido
```

## 3. Verificación post-deploy (smoke)
```bash
curl -s https://nexus.logisticatops.com/api/version   # version == git rev-parse --short HEAD
```
- [ ] `/settings/plan-de-cuentas` lista el catálogo (incl. cuentas nuevas).
- [ ] Alta de proveedor/cliente muestra Categoría fiscal + Cuenta contable.
- [ ] PDF/email de una OS muestra Subtotal / IVA (21%) / Total.
- [ ] Emisión de factura común sigue funcionando igual (MiPyME desactivado).

## 4. Activación MiPyME (DIFERIDA — requiere confirmación Contadora)
NO hacer en este release. Cuando Mariela confirme:
1. `update fiscal_config set emisor_es_mipyme = true where id = 1;` (si VEROTIN es MiPyME).
2. `update mipyme_config set monto_minimo = <MÍNIMO_NORMATIVO>, vigente_desde = current_date;`
3. Cargar `clients.es_mipyme = true` en los clientes del Registro MiPyME.
4. `update mipyme_config set activo = true;` ← recién acá empieza a bloquear comprobante común.
5. Emisión real de FCE (códigos 201/206, Opcionales/CBU, WS padrón): requiere credenciales ARCA
   (clave privada) + cliente WSFEv1 de producción. Pendiente del mismo bloqueo histórico de facturación.

## 5. Rollback
- Código: `npx netlify deploy --prod` del commit anterior (o "Publish deploy" del deploy previo en el panel).
- Migraciones: son additive-only; no requieren rollback funcional. Si se quisiera revertir:
  `alter table vendors drop column cuenta_contable;` etc. (las cuentas nuevas se pueden desactivar con
  `update chart_of_accounts set is_active=false where code between '6.1.14' and '6.1.25';`).
  El enum no se revierte (Postgres no soporta DROP VALUE) — inofensivo si no se usa.
