# Archivo histórico · migraciones aplicadas 0205–0218

**Estado: `APPLIED_REMOTE_ARCHIVE` · NO EJECUTABLE · documental.**

Este directorio conserva el texto SQL que la base productiva del ERP
(`arsksytgdnzukbmfgkju`) ejecutó realmente para las migraciones `0205`–`0218`.
Existe porque esas catorce migraciones **están aplicadas en el remoto y no
figuran en `main`**: el repositorio no las tenía, y las copias que circulan en
ramas laterales no coinciden con lo aplicado.

## Qué es y qué no es

🔴 **Estos archivos NO son los originales históricos recuperados.** Los
originales, para doce de las catorce, no existen en ninguna parte del
repositorio ni de sus ramas.

Lo que hay acá es una **reconstrucción desde las sentencias aplicadas**,
tomadas de `supabase_migrations.schema_migrations.statements` —el registro que
la propia base conserva de lo que ejecutó—. Es la fuente autoritativa
disponible, y no es lo mismo que el archivo que un día se escribió.

Cada archivo es, byte a byte, la sentencia aplicada **más un único salto de
línea final** (LF), añadido por convención POSIX. Retirando ese LF se
reproduce exactamente el SHA-256 de la sentencia registrada en el remoto; el
`MANIFEST.json` publica ambos hashes y `validate.mjs` comprueba esa relación.

## Correspondencia con las copias laterales

| | |
|---|---|
| **2 de 14** | Coinciden con una copia lateral: `0210` (`candidate/link-wa-002-cumulative-20260730`) y `0211` (`feat/treas-recon-001-e2-20260728`). Sirven de validación cruzada independiente. |
| **12 de 14** | **Difieren de todas** las copias laterales disponibles. Para `0205` y `0207` se recorrieron todas las ramas remotas sin encontrar equivalente. |

De ahí la conclusión que gobierna este directorio: **las ramas laterales no son
la fuente de lo aplicado** y no deben tratarse como tal.

## Por qué está acá y no en `supabase/migrations/`

Sus prefijos ordinales `0205`–`0218` **no** son las versiones con las que el
remoto las registró: allí figuran como marcas de tiempo (`20260726191253` y
siguientes). Mantener los archivos bajo `supabase/migrations/` los dejaba al
alcance de `supabase db push` —que `scripts/setup-supabase.sh` invoca— con
riesgo real de reejecución sobre una base que ya las tiene aplicadas.

**Este directorio es documental. No debe alimentarse a la CLI de Supabase.**
No es una ruta de migraciones, no se descubre como tal y no debe convertirse en
una sin un expediente propio que lo autorice.

## Lo que este archivo NO resuelve

- **No reconcilia por sí mismo la historia ejecutable.** Que el texto esté
  archivado no significa que el repositorio pueda reproducir la base.
- **No permite afirmar que el repositorio ya reproduce íntegramente
  producción.** No lo hace: faltan las predecesoras `0001`–`0204` tal como se
  aplicaron, y un replay encadenado sigue siendo imposible desde el repositorio.
- **`0219` y `0220` continúan bloqueadas** y sin aplicar. Este archivo no las
  toca ni habilita.
- La divergencia entre el tracker por marca de tiempo y la numeración ordinal,
  el backfill de `client_id`, la identidad de cliente, los escritores, RLS,
  grants y RPC **pertenecen a expedientes posteriores**.

Cualquier restauración, replay o reejecución **requiere expediente propio y
autorización expresa de Dirección**.

## Contenido

| Ruta | Función |
|---|---|
| `0205_*.sql` … `0218_*.sql` | Las catorce sentencias aplicadas. Los nombres ordinales son **identificadores históricos**, no orden de ejecución local. |
| `MANIFEST.json` | Ordinal, nombre, versión remota, ambos SHA-256, longitudes, fuente, estado, `executable: false` y equivalencia lateral por entrada. |
| `validate.mjs` | Validador autónomo y fail-closed. No se conecta a producción. |

## Validación

```bash
node docs/migrations/applied-history/0205-0218/validate.mjs
```

Falla cerrado: cualquier hueco, duplicado, hash discrepante, CR, salto final
ausente o duplicado, entrada marcada como ejecutable, ruta no declarada, o
reaparición de cualquiera de los catorce archivos bajo `supabase/migrations/`
detiene la validación con código distinto de cero.
