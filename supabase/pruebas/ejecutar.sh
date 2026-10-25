#!/bin/sh
# Prueba las migraciones y la seguridad (RLS) en un Postgres local vacío que imita a Supabase.
# Uso: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres sh supabase/pruebas/ejecutar.sh
set -e
cd "$(dirname "$0")/.."
psql -q -v ON_ERROR_STOP=1 -f pruebas/00_emular_supabase.sql
psql -q -v ON_ERROR_STOP=1 -f migrations/001_registros.sql
psql -q -v ON_ERROR_STOP=1 -f pruebas/01_semilla.sql
psql -q -v ON_ERROR_STOP=1 -f migrations/002_equipo.sql
psql -q -v ON_ERROR_STOP=1 -f pruebas/02_pruebas_rls.sql 2>&1 | grep -E "ok|FALLA"
