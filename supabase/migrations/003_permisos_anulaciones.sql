-- Guarmo (antes ApexLedger) 003: permisos por persona y anulación de ventas. Ejecutar después de 002.
-- El rol es una plantilla: el admin tiene todo; al resto se le activan permisos uno a uno.
-- Comprobados por el servidor: crear_productos, editar_productos, editar_precios, ajustar_stock, anular_ventas, gastos.
-- Solo en la app (el servidor no puede distinguirlos): vender_sin_conexion, ver_informes, exportar.
-- El equipo y los ajustes de la empresa siguen siendo solo del admin.

alter table public.miembros add column if not exists permisos text[] not null default '{}';
alter table public.miembros drop constraint if exists miembros_permisos_validos;
alter table public.miembros add constraint miembros_permisos_validos check (permisos <@ array[
  'crear_productos', 'editar_productos', 'editar_precios', 'ajustar_stock', 'anular_ventas', 'gastos',
  'vender_sin_conexion', 'ver_informes', 'exportar']::text[]);
-- Los trabajadores actuales conservan lo que podían hacer.
update public.miembros set permisos = array['vender_sin_conexion'] where rol = 'trabajador' and permisos = '{}';

alter table public.registros drop constraint if exists registros_tipo_check;
alter table public.registros add constraint registros_tipo_check check (tipo in ('producto', 'venta', 'gasto', 'ajustes', 'anulacion'));

create or replace function private.puede(e uuid, permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.miembros m where m.empresa_id = e and m.user_id = auth.uid()
                 and (m.rol = 'admin' or permiso = any (m.permisos)))
$$;
revoke all on function private.puede(uuid, text) from public, anon;
grant execute on function private.puede(uuid, text) to authenticated;

-- ---------- Permisos campo a campo y validaciones (corre antes que registros_ultima_version) ----------
create or replace function public.registros_a_permisos() returns trigger
language plpgsql set search_path = '' as $$
declare
  existe boolean;
  l jsonb;
begin
  if tg_op = 'UPDATE' and (new.tipo <> old.tipo or new.id <> old.id or new.owner_id <> old.owner_id) then
    raise exception 'No se puede cambiar el tipo, id o empresa de un registro.' using errcode = '42501';
  end if;

  if new.tipo = 'producto' then
    if tg_op = 'INSERT' then
      -- En un upsert, el INSERT de un producto que ya existe acaba en UPDATE: allí se revisan los campos.
      select exists (select 1 from public.registros r where r.owner_id = new.owner_id and r.tipo = 'producto' and r.id = new.id) into existe;
      if not existe and not private.puede(new.owner_id, 'crear_productos') then
        raise exception 'No tienes permiso para crear productos.' using errcode = '42501';
      end if;
    elsif new.actualizado >= old.actualizado then -- un cambio viejo se ignora más adelante; no hace falta revisarlo
      if (old.datos -> 'precio') is distinct from (new.datos -> 'precio') or (old.datos -> 'costo') is distinct from (new.datos -> 'costo') then
        if not private.puede(new.owner_id, 'editar_precios') then raise exception 'No tienes permiso para cambiar precios.' using errcode = '42501'; end if;
      end if;
      if (old.datos -> 'stockBase') is distinct from (new.datos -> 'stockBase') or (old.datos -> 'stockFecha') is distinct from (new.datos -> 'stockFecha') then
        if not private.puede(new.owner_id, 'ajustar_stock') then raise exception 'No tienes permiso para ajustar el stock.' using errcode = '42501'; end if;
      end if;
      -- Cualquier otro campo (incluidos los nuevos) y el borrado exigen editar_productos.
      if (coalesce(old.datos, '{}') - array['precio', 'costo', 'stockBase', 'stockFecha']) is distinct from (coalesce(new.datos, '{}') - array['precio', 'costo', 'stockBase', 'stockFecha'])
         or new.borrado is distinct from old.borrado then
        if not private.puede(new.owner_id, 'editar_productos') then raise exception 'No tienes permiso para editar productos.' using errcode = '42501'; end if;
      end if;
    end if;
  end if;

  if new.tipo = 'venta' and tg_op = 'INSERT' then
    if jsonb_array_length(coalesce(new.datos -> 'lineas', '[]')) = 0 then raise exception 'Venta sin líneas.' using errcode = '22023'; end if;
    for l in select * from jsonb_array_elements(new.datos -> 'lineas') loop
      if (l ->> 'cantidad')::numeric <= 0 or (l ->> 'precio')::numeric < 0 then
        raise exception 'Venta con cantidades o precios no válidos.' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Una anulación usa el mismo id que la venta: la clave primaria impide anular dos veces.
  if new.tipo = 'anulacion' and tg_op = 'INSERT' then
    if not exists (select 1 from public.registros r where r.owner_id = new.owner_id and r.tipo = 'venta' and r.id = new.id and not r.borrado) then
      raise exception 'La venta a anular no existe.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists registros_a_permisos on public.registros;
create trigger registros_a_permisos before insert or update on public.registros
  for each row execute function public.registros_a_permisos();

-- Ventas y anulaciones no se modifican una vez subidas.
create or replace function public.registros_ultima_version() returns trigger
language plpgsql set search_path = '' as $$
declare
  total bigint;
  iva numeric;
begin
  if new.actualizado > now() + interval '5 minutes' then
    new.actualizado := now();
  end if;
  if tg_op = 'UPDATE' then
    if new.tipo in ('venta', 'anulacion') then return null; end if;
    if new.actualizado < old.actualizado then return null; end if;
  end if;
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
drop policy if exists "leer empresa" on public.registros;
drop policy if exists "crear empresa" on public.registros;
drop policy if exists "editar admin" on public.registros;
drop policy if exists "leer" on public.registros;
drop policy if exists "crear" on public.registros;
drop policy if exists "editar" on public.registros;

create policy "leer" on public.registros for select to authenticated
  using (private.es_miembro(owner_id) and (tipo <> 'gasto' or private.puede(owner_id, 'gastos')));

-- Las ventas solo exigen ser del equipo: una venta hecha nunca debe quedar sin poder subirse.
create policy "crear" on public.registros for insert to authenticated with check (
  case tipo
    when 'venta' then not borrado and private.es_miembro(owner_id)
    when 'anulacion' then not borrado and private.puede(owner_id, 'anular_ventas')
    when 'gasto' then private.puede(owner_id, 'gastos')
    when 'ajustes' then private.es_admin(owner_id)
    when 'producto' then private.puede(owner_id, 'crear_productos') or private.puede(owner_id, 'editar_productos')
                         or private.puede(owner_id, 'editar_precios') or private.puede(owner_id, 'ajustar_stock')
    else false
  end);

create policy "editar" on public.registros for update to authenticated
  using (case tipo
    when 'gasto' then private.puede(owner_id, 'gastos')
    when 'ajustes' then private.es_admin(owner_id)
    when 'producto' then private.puede(owner_id, 'editar_productos') or private.puede(owner_id, 'editar_precios') or private.puede(owner_id, 'ajustar_stock')
    else false end)
  with check (case tipo
    when 'gasto' then private.puede(owner_id, 'gastos')
    when 'ajustes' then private.es_admin(owner_id)
    when 'producto' then private.puede(owner_id, 'editar_productos') or private.puede(owner_id, 'editar_precios') or private.puede(owner_id, 'ajustar_stock')
    else false end);

-- ---------- Funciones ----------
create or replace function public.cambiar_permisos(p_user uuid, p_permisos text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare e uuid := private.mi_empresa_admin(); -- solo admins
begin
  perform 1 from public.miembros m where m.empresa_id = e and m.user_id = p_user for update;
  if not found then raise exception 'Esa persona no es parte del equipo.'; end if;
  update public.miembros m set permisos = coalesce(p_permisos, '{}') where m.empresa_id = e and m.user_id = p_user;
end $$;
revoke all on function public.cambiar_permisos(uuid, text[]) from public, anon;
grant execute on function public.cambiar_permisos(uuid, text[]) to authenticated;

-- entrar_empresa devuelve también los permisos (hay que borrarla para cambiar lo que devuelve).
drop function if exists public.entrar_empresa();
create function public.entrar_empresa()
returns table (empresa_id uuid, rol text, serie text, permisos text[])
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
      if actual is not null
         and not exists (select 1 from public.registros r where r.owner_id = actual and r.tipo <> 'ajustes')
         and not exists (select 1 from public.miembros m where m.empresa_id = actual and m.user_id <> auth.uid()) then
        delete from public.empresas e where e.id = actual;
        actual := null;
      end if;
      if actual is null then
        update public.empresas e set series = e.series + 1 where e.id = inv.empresa_id returning 'E' || e.series into nueva_serie;
        insert into public.miembros (empresa_id, user_id, email, rol, serie, permisos)
          values (inv.empresa_id, auth.uid(), correo, inv.rol, nueva_serie, case when inv.rol = 'trabajador' then array['vender_sin_conexion'] else '{}' end);
        delete from public.invitaciones i where i.empresa_id = inv.empresa_id and i.email = correo;
      end if;
    end if;
  end if;
  if not exists (select 1 from public.miembros m where m.user_id = auth.uid()) then
    insert into public.empresas default values returning id into nueva;
    insert into public.miembros (empresa_id, user_id, email, rol) values (nueva, auth.uid(), coalesce(correo, ''), 'admin');
  end if;
  return query select m.empresa_id, m.rol, m.serie, m.permisos from public.miembros m where m.user_id = auth.uid();
end $$;
revoke all on function public.entrar_empresa() from public, anon;
grant execute on function public.entrar_empresa() to authenticated;
