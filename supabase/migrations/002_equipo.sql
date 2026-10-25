-- ApexLedger 002: varias personas por empresa (roles admin / trabajador).
-- Ejecutar en Supabase → SQL Editor después de 001. Requiere "Confirm email" activado en Authentication.
-- registros.owner_id pasa a ser el id de la EMPRESA (para los dueños actuales vale lo mismo que su id de usuario).

create schema if not exists private;

create table if not exists public.empresas (
  id     uuid primary key default gen_random_uuid(),
  creada timestamptz not null default now(),
  series int not null default 1 -- última serie de facturas repartida (nunca se reutiliza)
);

create table if not exists public.miembros (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  user_id    uuid not null unique references auth.users (id) on delete cascade, -- una persona, una empresa
  email      text not null,
  rol        text not null check (rol in ('admin', 'trabajador')),
  serie      text not null default '', -- serie de facturas propia: evita números repetidos entre personas
  primary key (empresa_id, user_id)
);

create table if not exists public.invitaciones (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  email      text not null check (email = lower(email)),
  rol        text not null check (rol in ('admin', 'trabajador')),
  expira     timestamptz not null default now() + interval '14 days',
  primary key (empresa_id, email)
);

alter table public.empresas enable row level security;
alter table public.miembros enable row level security;
alter table public.invitaciones enable row level security;

-- Dueños actuales: su empresa usa su mismo id y quedan como admin.
insert into public.empresas (id) select distinct owner_id from public.registros on conflict do nothing;
insert into public.miembros (empresa_id, user_id, email, rol)
  select distinct r.owner_id, u.id, lower(u.email), 'admin' from public.registros r join auth.users u on u.id = r.owner_id
  on conflict do nothing;

alter table public.registros drop constraint if exists registros_owner_id_fkey;
alter table public.registros alter column owner_id drop default;
alter table public.registros drop constraint if exists registros_empresa_fk;
alter table public.registros add constraint registros_empresa_fk foreign key (owner_id) references public.empresas (id) on delete cascade;
alter table public.registros add column if not exists autor uuid default auth.uid();
comment on column public.registros.owner_id is 'Empresa dueña del registro';

-- ---------- Ayudas para las políticas (esquema no expuesto por la API) ----------
create or replace function private.es_miembro(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.miembros where empresa_id = e and user_id = auth.uid())
$$;

create or replace function private.es_admin(e uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.miembros where empresa_id = e and user_id = auth.uid() and rol = 'admin')
$$;

revoke all on function private.es_miembro(uuid), private.es_admin(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.es_miembro(uuid), private.es_admin(uuid) to authenticated;

-- ---------- Reglas al escribir registros ----------
create or replace function public.registros_ultima_version() returns trigger
language plpgsql set search_path = '' as $$
declare
  total bigint;
  iva numeric;
begin
  -- Una fecha en el futuro no puede bloquear los cambios de los demás.
  if new.actualizado > now() + interval '5 minutes' then
    new.actualizado := now();
  end if;
  if tg_op = 'UPDATE' then
    if new.tipo = 'venta' then return null; end if; -- las ventas no se modifican una vez subidas
    if new.actualizado < old.actualizado then return null; end if; -- gana el cambio más reciente
  end if;
  -- El total de una venta lo calcula el servidor a partir de sus líneas.
  if new.tipo = 'venta' and new.datos is not null then
    select coalesce(sum((l ->> 'precio')::bigint * (l ->> 'cantidad')::bigint), 0) into total
      from jsonb_array_elements(coalesce(new.datos -> 'lineas', '[]'::jsonb)) l;
    iva := coalesce((new.datos ->> 'iva')::numeric, 0);
    new.datos := new.datos || jsonb_build_object('total', total, 'base', round(total / (1 + iva / 100)), 'cuota', total - round(total / (1 + iva / 100)));
  end if;
  new.autor := auth.uid();
  new.recibido := now();
  return new;
end $$;

-- ---------- Políticas ----------
drop policy if exists "leer propios" on public.registros;
drop policy if exists "crear propios" on public.registros;
drop policy if exists "editar propios" on public.registros;
drop policy if exists "leer empresa" on public.registros;
drop policy if exists "crear empresa" on public.registros;
drop policy if exists "editar admin" on public.registros;

-- Los gastos solo los ven los admin.
create policy "leer empresa" on public.registros for select to authenticated
  using (private.es_miembro(owner_id) and (tipo <> 'gasto' or private.es_admin(owner_id)));
-- El admin crea cualquier cosa; el trabajador solo ventas.
create policy "crear empresa" on public.registros for insert to authenticated
  with check (private.es_admin(owner_id) or (tipo = 'venta' and not borrado and private.es_miembro(owner_id)));
-- Solo el admin modifica (productos, gastos, ajustes). Nadie borra filas: se marca borrado.
create policy "editar admin" on public.registros for update to authenticated
  using (private.es_admin(owner_id)) with check (private.es_admin(owner_id));

drop policy if exists "ver mi empresa" on public.miembros;
create policy "ver mi empresa" on public.miembros for select to authenticated using (private.es_miembro(empresa_id));
drop policy if exists "admin ve invitaciones" on public.invitaciones;
create policy "admin ve invitaciones" on public.invitaciones for select to authenticated using (private.es_admin(empresa_id));
-- Sin políticas de escritura en miembros/invitaciones: todo cambio pasa por las funciones de abajo.

-- ---------- Funciones del equipo ----------
create or replace function private.mi_empresa_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare e uuid;
begin
  select empresa_id into e from public.miembros where user_id = auth.uid() and rol = 'admin';
  if e is null then raise exception 'Solo un administrador puede hacer esto.' using errcode = '42501'; end if;
  return e;
end $$;

-- Al entrar: acepta una invitación (solo con correo confirmado) o crea la empresa del usuario.
create or replace function public.entrar_empresa()
returns table (empresa_id uuid, rol text, serie text)
language plpgsql security definer set search_path = '' as $$
declare
  correo text;
  inv public.invitaciones;
  actual uuid;
  nueva uuid;
  nueva_serie text;
begin
  if auth.uid() is null then raise exception 'Sin sesión' using errcode = '42501'; end if;
  select lower(u.email) into correo from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  select m.empresa_id into actual from public.miembros m where m.user_id = auth.uid();
  if correo is not null then
    select * into inv from public.invitaciones i where i.email = correo and i.expira > now() order by i.expira desc limit 1;
    if found and actual is distinct from inv.empresa_id then
      -- Si ya tenía una empresa propia vacía (entró antes de ser invitado), se descarta; si tiene datos, se queda donde está.
      if actual is not null
         and not exists (select 1 from public.registros r where r.owner_id = actual and r.tipo <> 'ajustes')
         and not exists (select 1 from public.miembros m where m.empresa_id = actual and m.user_id <> auth.uid()) then
        delete from public.empresas e where e.id = actual;
        actual := null;
      end if;
      if actual is null then
        update public.empresas e set series = e.series + 1 where e.id = inv.empresa_id returning 'E' || e.series into nueva_serie;
        insert into public.miembros (empresa_id, user_id, email, rol, serie) values (inv.empresa_id, auth.uid(), correo, inv.rol, nueva_serie);
        delete from public.invitaciones i where i.empresa_id = inv.empresa_id and i.email = correo;
      end if;
    end if;
  end if;
  if not exists (select 1 from public.miembros m where m.user_id = auth.uid()) then
    insert into public.empresas default values returning id into nueva;
    insert into public.miembros (empresa_id, user_id, email, rol) values (nueva, auth.uid(), coalesce(correo, ''), 'admin');
  end if;
  return query select m.empresa_id, m.rol, m.serie from public.miembros m where m.user_id = auth.uid();
end $$;

create or replace function public.invitar(p_email text, p_rol text) returns void
language plpgsql security definer set search_path = '' as $$
declare e uuid := private.mi_empresa_admin();
begin
  if p_rol not in ('admin', 'trabajador') then raise exception 'Rol no válido.'; end if;
  if exists (select 1 from public.miembros m where m.empresa_id = e and m.email = lower(trim(p_email))) then
    raise exception 'Esa persona ya es parte del equipo.';
  end if;
  insert into public.invitaciones (empresa_id, email, rol) values (e, lower(trim(p_email)), p_rol)
    on conflict (empresa_id, email) do update set rol = excluded.rol, expira = now() + interval '14 days';
end $$;

create or replace function public.cancelar_invitacion(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.invitaciones i where i.empresa_id = private.mi_empresa_admin() and i.email = lower(trim(p_email));
end $$;

-- Cambia el rol o quita a alguien (p_rol null = quitar). La empresa nunca se queda sin admin.
create or replace function public.cambiar_miembro(p_user uuid, p_rol text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e uuid := private.mi_empresa_admin();
  admins int;
begin
  if p_rol is not null and p_rol not in ('admin', 'trabajador') then raise exception 'Rol no válido.'; end if;
  perform 1 from public.miembros m where m.empresa_id = e and m.rol = 'admin' for update; -- evita que dos admins se quiten a la vez
  if not exists (select 1 from public.miembros m where m.empresa_id = e and m.user_id = p_user) then
    raise exception 'Esa persona no es parte del equipo.';
  end if;
  select count(*) into admins from public.miembros m where m.empresa_id = e and m.rol = 'admin' and m.user_id <> p_user;
  if admins = 0 and coalesce(p_rol, '') <> 'admin' then raise exception 'La empresa debe tener al menos un administrador.'; end if;
  if p_rol is null then
    delete from public.miembros m where m.empresa_id = e and m.user_id = p_user;
  else
    update public.miembros m set rol = p_rol where m.empresa_id = e and m.user_id = p_user;
  end if;
end $$;

revoke all on function public.entrar_empresa(), public.invitar(text, text), public.cancelar_invitacion(text),
  public.cambiar_miembro(uuid, text), private.mi_empresa_admin() from public, anon;
grant execute on function public.entrar_empresa(), public.invitar(text, text), public.cancelar_invitacion(text),
  public.cambiar_miembro(uuid, text), private.mi_empresa_admin() to authenticated;
