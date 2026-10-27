-- Guarmo (antes ApexLedger): datos de cada empresa (una cuenta = una empresa).
-- Ejecutar una vez en Supabase → SQL Editor.

create table if not exists public.registros (
  owner_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  tipo        text        not null check (tipo in ('producto', 'venta', 'gasto', 'ajustes')),
  id          text        not null,
  datos       jsonb,
  borrado     boolean     not null default false,
  actualizado timestamptz not null,               -- cuándo se hizo el cambio en el equipo
  recibido    timestamptz not null default now(), -- cuándo llegó al servidor (para bajar cambios)
  primary key (owner_id, tipo, id)
);

create index if not exists registros_owner_recibido on public.registros (owner_id, recibido);

-- Gana el cambio más reciente: un equipo que sube algo viejo no pisa lo nuevo.
create or replace function public.registros_ultima_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.actualizado < old.actualizado then
    return null;
  end if;
  new.recibido := now();
  return new;
end $$;

drop trigger if exists registros_ultima_version on public.registros;
create trigger registros_ultima_version before insert or update on public.registros
  for each row execute function public.registros_ultima_version();

-- Seguridad: cada usuario solo ve y modifica sus propios registros.
alter table public.registros enable row level security;

drop policy if exists "leer propios" on public.registros;
drop policy if exists "crear propios" on public.registros;
drop policy if exists "editar propios" on public.registros;
create policy "leer propios" on public.registros for select to authenticated using (owner_id = (select auth.uid()));
create policy "crear propios" on public.registros for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "editar propios" on public.registros for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- Sin política de borrado: los borrados se marcan con "borrado = true" para que lleguen a los demás equipos.
