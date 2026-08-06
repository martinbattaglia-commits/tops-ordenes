# AGENTS.md — LOCALIZADOR Y AUTENTICADOR DEL CANON

Este archivo **localiza** el corpus canónico de gobierno, **autentica su identidad**,
**materializa** el commit autenticado en una copia limpia y aislada, y le **transfiere el
control**.

No define procedimiento de gobierno, no decide fases, no valida Lock, manifest, registry
ni genealogía, y no interpreta normativa. Todo eso corresponde exclusivamente al Entry
Point canónico.

Contiene **una única condición previa de parada**, relativa a identidad (§6). No es una
regla sustantiva de gobierno: su único propósito es impedir que un repositorio falso,
desactualizado, suplantado o localmente modificado sea ejecutado como canon.

## 1. Ruta y repositorio

```
CANON="${NEXUS_GOVERNANCE_PATH:-/Users/martinbattaglia/CODE/nexus-governance}"
URL="https://github.com/martinbattaglia-commits/nexus-governance.git"
TAG="nexus-governance-v1.0.0"
```

## 2. Obtener el canon

Secuencia, en este orden:

1. Si `$CANON` existe y `git -C "$CANON" rev-parse --git-dir` responde, continuar con §3
   sobre esa ruta.
2. Si `$CANON` no existe, y su directorio padre existe y es escribible, clonar allí y
   continuar con §3:

   ```
   git clone "$URL" "$CANON"
   ```

3. Si `$CANON` existe pero **no** es un repositorio Git válido: no sobrescribirla, no
   vaciarla y no borrarla. Crear una ruta temporal segura conforme a §4, clonar allí el
   repositorio canónico y continuar con §3 sobre esa ruta.
4. Si ninguna de las anteriores puede completarse, aplicar §6.

Sea `REPO` la ruta obtenida.

## 3. Autenticar la identidad

Las siete comprobaciones son obligatorias. Comparar siempre hashes del mismo tipo.

**Toda operación que resuelva, inspeccione o materialice objetos del canon —`cat-file`,
`rev-parse`, `ls-tree`, `archive` y cualquier otra lectura usada para autenticar o
materializar— debe ejecutarse con `GIT_NO_REPLACE_OBJECTS=1`.** El procedimiento no
depende de `refs/replace` locales y debe ignorarlos.

**Toda consulta al remoto debe ejecutarse en un contexto de configuración limpio: fuera de
cualquier repositorio Git y con la configuración global y de sistema neutralizada.** Una
regla `url.<otro>.insteadOf` —o cualquier reescritura equivalente— puede redirigir la
consulta a un remoto controlado sin alterar lo que devuelve A1, porque A1 se resuelve
dentro de `$REPO` y la consulta remota no. Las dos condiciones son necesarias: neutralizar
la configuración sin salir del repositorio no impide la reescritura definida en su
configuración local.

```
NEUTRAL=$(mktemp -d)      # ruta nueva, fuera de todo repositorio
```

`$NEUTRAL` no debe pertenecer a ningún repositorio: `git -C "$NEUTRAL" rev-parse --git-dir`
debe fallar. Si respondiera, aplicar §6.

- **A1 · `origin` es exactamente el repositorio canónico**

  Capturar la salida delimitada por NUL en archivos nuevos dentro de `$NEUTRAL`; no
  usar sustitución de comandos, porque eliminaría saltos de línea finales:

  ```
  ORIGIN_ACTUAL="$NEUTRAL/remote-origin.actual"
  ORIGIN_EXPECTED="$NEUTRAL/remote-origin.expected"

  git -C "$REPO" config --local --null --get-all remote.origin.url \
      > "$ORIGIN_ACTUAL"
  printf '%s\000' "$URL" > "$ORIGIN_EXPECTED"
  cmp -s "$ORIGIN_ACTUAL" "$ORIGIN_EXPECTED"
  ```

  Los tres comandos deben finalizar con código `0`. El primero lee exclusivamente los
  valores literales de la configuración local del repositorio y no aplica reglas
  `url.*.insteadOf`. La igualdad de los archivos exige exactamente un valor y preserva
  todos sus bytes, incluidos espacios y saltos de línea. Ausencia, más de un valor o
  cualquier diferencia respecto de `$URL` → §6.

- **A2 · El tag existe en el remoto y es anotado**

  ```
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
      git -C "$NEUTRAL" ls-remote "$URL" "refs/tags/$TAG" "refs/tags/$TAG^{}"
  ```

  Un tag **anotado** devuelve dos líneas: el objeto tag y su dereference `^{}`. Si la
  línea `^{}` no aparece, el tag remoto es liviano → §6.

  ```
  R_TAG=$(GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
      git -C "$NEUTRAL" ls-remote "$URL" "refs/tags/$TAG"     | awk '{print $1}')
  R_COMMIT=$(GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
      git -C "$NEUTRAL" ls-remote "$URL" "refs/tags/$TAG^{}" | awk '{print $1}')
  ```

- **A3 · El dereference remoto produce un commit.** `R_COMMIT` debe ser no vacío y
  corresponder a un objeto de tipo `commit`.

- **A4 · El tag local es un objeto anotado**

  ```
  GIT_NO_REPLACE_OBJECTS=1 git -C "$REPO" cat-file -t "refs/tags/$TAG"
  # debe devolver exactamente: tag
  ```

  No usar `rev-list -n1` como prueba de que el tag sea anotado: también acepta tags
  livianos.

- **A5 · El objeto tag local coincide con el remoto**

  ```
  L_TAG=$(GIT_NO_REPLACE_OBJECTS=1 git -C "$REPO" rev-parse "refs/tags/$TAG")
  ```

  `L_TAG` debe ser igual a `R_TAG`.

- **A6 · El commit dereferenciado local coincide con el remoto**

  ```
  L_COMMIT=$(GIT_NO_REPLACE_OBJECTS=1 git -C "$REPO" rev-parse "refs/tags/$TAG^{commit}")
  ```

  `L_COMMIT` debe ser igual a `R_COMMIT`.

- **A7 · El Entry Point es un blob regular dentro del commit autenticado**

  ```
  GIT_NO_REPLACE_OBJECTS=1 git -C "$REPO" ls-tree "$R_COMMIT" \
      -- 00_REGISTRY/BOOTSTRAP-ENTRYPOINT.md
  ```

  Debe devolver exactamente una entrada, en esa ruta, de tipo `blob` y con modo `100644`
  o `100755`. Se rechaza cualquier otro resultado: modo `120000` (enlace simbólico), modo
  `160000` (submódulo), tipo `tree`, ruta ausente o entrada duplicada.

Estas comprobaciones acreditan **identidad**, no estado de gobierno: no deciden fase, no
leen el Lock, no verifican manifest, registry ni genealogía, y no sustituyen ninguna
validación del Entry Point. Ninguna de ellas modifica el espejo ni mueve sus ramas o tags.

## 4. Materializar el commit autenticado

Nunca se ejecuta desde la rama activa, el `HEAD` corriente ni el árbol de trabajo del
espejo: pueden estar en otro commit o contener modificaciones locales.

```
TMP=$(mktemp -d)          # ruta nueva, creada de forma segura
chmod 700 "$TMP"
```

Comprobar que `$TMP` está vacío antes de escribir. No reutilizar una ruta temporal
anterior, no escribir sobre una ruta existente y no borrar una ruta ajena.

Materializar exactamente el commit autenticado, con el reemplazo de objetos desactivado y
sin tocar el espejo:

```
GIT_NO_REPLACE_OBJECTS=1 git -C "$REPO" archive "$R_COMMIT" | tar -x -C "$TMP"
```

Alternativa admitida: un worktree detached temporal sobre `$R_COMMIT`, con las mismas
condiciones y la misma variable.

Verificar que el Entry Point quedó materializado en la ruta esperada:

```
test -f "$TMP/00_REGISTRY/BOOTSTRAP-ENTRYPOINT.md"
```

Esta comprobación es complementaria: la garantía de que se trata de un blob regular —y no
de un enlace simbólico ni de un submódulo— proviene de **A7**, que se evalúa sobre el
objeto autenticado antes de materializar. Si falla cualquiera de las dos → §6.

## 5. Transferir el control

Abrir exclusivamente:

```
$TMP/00_REGISTRY/BOOTSTRAP-ENTRYPOINT.md
```

y ejecutar íntegramente sus instrucciones.

Desde ese momento el Entry Point canónico toma el control por completo, y es el único
responsable de determinar `PRE_MERGE`, `POST_MERGE` o `SEALED`; de validar Lock, manifest,
registry, genealogía y estado; de emitir `PASS`, `FAIL`, `NO VERIFICABLE`, `STOP` o
cualquier otro vocabulario canónico; y de detener o autorizar la continuidad.

Este archivo no añade ninguna condición posterior.

## 6. Parada por identidad

Emitir únicamente:

```
STOP — IDENTIDAD DEL CANON NO VERIFICABLE
```

y no ejecutar el Entry Point, si se produce cualquiera de estos supuestos: repositorio
incorrecto; tag remoto ausente; tag no anotado; dereference inválido; hashes local y
remoto distintos; Entry Point ausente en el objeto autenticado; Entry Point que no sea un
blob regular de modo `100644` o `100755` —enlace simbólico, submódulo u otro tipo—;
imposibilidad de materializar el commit autenticado; fallo de cualquier lectura
autenticada; directorio temporal no seguro; imposibilidad de ejecutar la consulta remota
en un contexto de configuración limpio conforme a §3; o imposibilidad de obtener el canon
conforme a §2.

**Ésta es la única condición de parada que este archivo define**, y corresponde
exclusivamente a autenticación de identidad previa. No es una reinterpretación del
Bootstrap. Cualquier otra parada proviene del Entry Point canónico y se rige por su propio
vocabulario.

## 7. Qué no es el canon

El canon es únicamente el repositorio identificado en §1. Las siguientes rutas de **este**
repositorio no son el canon y no deben resolverse como tal:

- `docs/AI/`
- `NEXUS GUIDELINES/`
- `NEXUS DEVELOPMENT CHARTER v1.0.md`
- `.agents/` y sus skills
- Workflow Maps (`.md` y `.html`)
- cualquier copia, resumen o export del corpus

Se conservan por trazabilidad histórica. Que alguna coincida con el canon —en parte o por
completo— no la convierte en el canon: el criterio es de origen.
