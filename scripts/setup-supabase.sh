#!/usr/bin/env bash
# =========================================================================
# TOPS Órdenes — Setup completo de Supabase
#
# Aplica las 4 migraciones SQL contra el proyecto Supabase configurado.
# Requiere: supabase CLI (`brew install supabase/tap/supabase`) y haber
# corrido `supabase login` previamente.
#
# Uso:
#   1. supabase link --project-ref <YOUR_PROJECT_REF>
#   2. ./scripts/setup-supabase.sh
# =========================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "→ Verificando supabase CLI…"
if ! command -v supabase >/dev/null 2>&1; then
  echo "✗ supabase CLI no encontrado."
  echo "  Instalalo con: brew install supabase/tap/supabase"
  exit 1
fi

echo "→ Verificando vinculación al proyecto…"
if [ ! -f "supabase/.temp/project-ref" ] && [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "✗ El proyecto no está vinculado."
  echo "  Corré primero: supabase link --project-ref <YOUR_REF>"
  exit 1
fi

echo "→ Aplicando migraciones…"
supabase db push

echo ""
echo "✓ Migraciones aplicadas correctamente."
echo ""
echo "Próximo paso: crear tu primer usuario admin."
echo "  1. Andá a Authentication → Users en el dashboard Supabase"
echo "  2. Add user → con tu email corporativo y una password fuerte"
echo "  3. En la tabla 'profiles' cambiá el role del usuario recién creado a 'admin'"
echo ""
echo "Después, en Netlify, configurá las env vars y forzá un redeploy."
