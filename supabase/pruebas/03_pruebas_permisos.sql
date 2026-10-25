\set ON_ERROR_STOP 1
create or replace function pg_temp.como(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if not cond then raise exception 'FALLA: %', msg; end if; raise notice 'ok: %', msg; end $$;
create or replace function pg_temp.falla(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok (rechazado): % -> %', msg, sqlerrm; return; end;
  raise exception 'FALLA: debió rechazarse: %', msg;
end $$;
set role authenticated;

-- Escenario: después de 02, el admin es 2222 y 1111 fue quitado. 2222 invita a otra@x.com (4444 ya tiene empresa vacía).
select pg_temp.como('22222222-2222-2222-2222-222222222222');
select entrar_empresa();
select invitar('otra@x.com', 'trabajador');
select pg_temp.como('44444444-4444-4444-4444-444444444444');
select pg_temp.ok((select rol||'/'||array_to_string(permisos, ',') from entrar_empresa()) = 'trabajador/vender_sin_conexion', 'trabajador nuevo con permisos básicos');
select pg_temp.falla($$select cambiar_permisos('44444444-4444-4444-4444-444444444444', array['editar_precios'])$$, 'trabajador se da permisos');
update registros set datos = datos || '{"precio":1}', actualizado = now() where tipo='producto' and id='p1';
select pg_temp.ok((select (datos->>'precio')::int from registros where tipo='producto' and id='p1') = 5000, 'precio intacto');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','producto','nuevo','{}', now())$$, 'crear producto sin permiso');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','venta','vmala','{"lineas":[{"precio":100,"cantidad":-2}]}', now())$$, 'venta con cantidad negativa');

-- El admin le da solo editar_precios
select pg_temp.como('22222222-2222-2222-2222-222222222222');
select cambiar_permisos('44444444-4444-4444-4444-444444444444', array['editar_precios', 'vender_sin_conexion']);
select pg_temp.como('44444444-4444-4444-4444-444444444444');
insert into registros (owner_id,tipo,id,datos,actualizado) select owner_id,'producto','p1', datos || '{"precio":6000}', now() from registros where tipo='producto' and id='p1'
  on conflict (owner_id,tipo,id) do update set datos=excluded.datos, actualizado=excluded.actualizado;
select pg_temp.ok((select (datos->>'precio')::int from registros where tipo='producto' and id='p1') = 6000, 'con editar_precios cambia el precio (vía upsert)');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) select owner_id,'producto','p1', datos || '{"nombre":"Otro"}', now() from registros where tipo='producto' and id='p1' on conflict (owner_id,tipo,id) do update set datos=excluded.datos, actualizado=excluded.actualizado$$, 'editar_precios no permite cambiar el nombre');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) select owner_id,'producto','p1', datos || '{"stockBase":99}', now() from registros where tipo='producto' and id='p1' on conflict (owner_id,tipo,id) do update set datos=excluded.datos, actualizado=excluded.actualizado$$, 'editar_precios no permite ajustar stock');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','producto','p2','{}', now())$$, 'editar_precios no permite crear productos');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','anulacion','v1','{"motivo":"x"}', now())$$, 'anular sin permiso');
select pg_temp.ok((select count(*) from registros where tipo='gasto') = 0, 'sin permiso de gastos no los ve');

-- Anulaciones
select pg_temp.como('22222222-2222-2222-2222-222222222222');
select cambiar_permisos('44444444-4444-4444-4444-444444444444', array['anular_ventas', 'gastos']);
select pg_temp.como('44444444-4444-4444-4444-444444444444');
select pg_temp.ok((select count(*) from registros where tipo='gasto') = 1, 'con permiso de gastos los ve');
insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','anulacion','v1','{"motivo":"sobreventa"}', now());
insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','anulacion','v1','{"motivo":"otra"}', now()) on conflict do nothing;
select pg_temp.ok((select datos->>'motivo' from registros where tipo='anulacion' and id='v1') = 'sobreventa', 'no se anula dos veces ni se reescribe');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','anulacion','noexiste','{}', now())$$, 'anular una venta que no existe');
select pg_temp.como('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select empresa_id from entrar_empresa()) <> '11111111-1111-1111-1111-111111111111', 'el miembro quitado tiene otra empresa');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','anulacion','v1','{}', now())$$, 'anular en empresa ajena');
