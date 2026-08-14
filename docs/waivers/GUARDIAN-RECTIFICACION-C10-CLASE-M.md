# Rectificación formal · C10 · reclasificación a Clase M

Registro exigido por Dirección. **No reinterpreta retroactivamente** el
resultado anterior: lo declara **inválido y sustituido**, y deja ambos —el
inválido y el que lo reemplaza— documentados por separado.

## Qué pasó

El commit `c70b4e3` clasificó C10 contra el **diff del commit** (`HEAD -- ` vs
`HEAD^`), que no contenía SQL, y declaró **clase I**. Eso satisface la letra del
Guardián §5 leída commit a commit, pero no lo que Dirección exige: el candidato
completo — el que se va a mergear — sí contiene SQL, y **la clase la determina
el diff que efectivamente entra al repositorio con el merge**, no cada
commit por separado.

## Recalculado contra el diff correcto

```
$ git merge-base origin/main HEAD
b6f2eaab1406cff5537713028cac22043d3aacb0

$ git diff --name-only origin/main...HEAD -- | grep -E '\.sql$'
supabase/migrations/0236_nexus_link_channel_capabilities.sql
supabase/migrations/0237_nexus_link_channel_rls.sql
supabase/migrations/0238_nexus_link_upload_lifecycle.sql
supabase/migrations/ROLLBACK_0236_nexus_link_channel_capabilities.sql
supabase/migrations/ROLLBACK_0237_nexus_link_channel_rls.sql
supabase/migrations/ROLLBACK_0238_nexus_link_upload_lifecycle.sql
```

Seis archivos `.sql`, 50 rutas en total. Guardián §5: *«M · Esquema/SQL —
Incluye migración o función SQL»*.

## Declaración

**El candidato `NEXUS-LINK-NOTIFICATIONS-MEDIA-001` FASE B es, y siempre fue,
clase M.** El veredicto `PASS clase I` emitido para el commit `c70b4e3` —
registrado en el mensaje de ese commit y en
`docs/waivers/C4-REVISION-ADVERSARIAL-NEXUS-LINK-MEDIA-001.md`— **queda
INVÁLIDO**. No autorizó nunca el commit siguiente ni ningún otro: un Guardián
mal clasificado no es un Guardián ejecutado (Guardián §12: *«declarar una clase
que no se corresponda con el diff»* es una prohibición permanente).

Esto **no** afecta la validez del commit `c70b4e3` en sí —ya existe, no se hace
`amend` ni `rebase`—, pero sí significa que **desde ese commit en adelante no
hubo Guardián válido** hasta el que se ejecute al final de esta remediación,
sobre el árbol final, expresamente como clase M con C5 y C6 evaluados.

## Consecuencia inmediata

Por Guardián §5, clase M activa **C5 · rollback probado**. El Guardián mismo
declaraba C5 estructuralmente NO VERIFICABLE por falta de entorno
institucional — Dirección **cierra ese vacío en el punto 4** de su mandato,
definiendo el entorno representativo. C5 se ejecuta contra esa definición, no
se dispensa.

No se agrega `0239` a este candidato hasta que este documento quede
commiteado: es la instrucción explícita del punto 1.5 del mandato.
