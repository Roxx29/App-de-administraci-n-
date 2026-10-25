\set ON_ERROR_STOP 1
create or replace function pg_temp.como(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$ begin if not cond then raise exception 'FALLA: %', msg; end if; raise notice 'ok: %', msg; end $$;
create or replace function pg_temp.falla(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok (rechazado): % -> %', msg, sqlerrm; return; end;
  raise exception 'FALLA: debió rechazarse: %', msg;
end $$;
set role authenticated;

-- Dueño (admin migrado)
select pg_temp.como('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select rol from entrar_empresa()) = 'admin', 'dueño entra como admin de su empresa');
select pg_temp.ok((select count(*) from registros) = 3, 'dueño ve sus 3 registros (incl. gasto)');
select invitar('Trabajador@X.com', 'trabajador');
select invitar('sinconfirmar@x.com', 'trabajador');

-- Trabajador acepta invitación
select pg_temp.como('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select rol||'/'||serie from entrar_empresa()) = 'trabajador/E2', 'trabajador entra con su serie');
select pg_temp.ok((select count(*) from registros) = 2, 'trabajador no ve gastos');
select pg_temp.ok((select count(*) from invitaciones) = 0, 'trabajador no ve invitaciones');
select pg_temp.ok((select count(*) from miembros) = 2, 'trabajador ve el equipo');
-- venta con total falso: el servidor lo recalcula
insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','venta','v1',
  '{"id":"v1","iva":21,"total":1,"lineas":[{"productoId":"p1","precio":4625,"cantidad":2}]}', now());
select pg_temp.ok((select (datos->>'total')::int from registros where id='v1') = 9250, 'total de la venta recalculado (9250)');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','producto','p9','{}', now())$$, 'trabajador crea producto');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','producto','p1','{"precio":1}', now()+interval '1 day') on conflict (owner_id,tipo,id) do update set datos=excluded.datos, actualizado=excluded.actualizado$$, 'trabajador pisa producto vía upsert');
update registros set datos='{"precio":1}' where id='p1';
select pg_temp.ok((select (datos->>'precio')::int from registros where id='p1') = 4625, 'update de producto por trabajador no tiene efecto');
select pg_temp.falla($$select invitar('x@x.com','admin')$$, 'trabajador invita');
select pg_temp.falla($$select cambiar_miembro('22222222-2222-2222-2222-222222222222','admin')$$, 'trabajador se hace admin');
insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','venta','v1','{"id":"v1","lineas":[]}', now()) on conflict do nothing;
select pg_temp.ok((select (datos->>'total')::int from registros where id='v1') = 9250, 'venta reenviada no cambia');

-- Sin correo confirmado: no acepta la invitación, queda en su propia empresa
select pg_temp.como('33333333-3333-3333-3333-333333333333');
select pg_temp.ok((select rol from entrar_empresa()) = 'admin', 'sin confirmar: empresa propia');
select pg_temp.ok((select count(*) from registros) = 0, 'sin confirmar no ve datos ajenos');

-- Otra empresa: aislada
select pg_temp.como('44444444-4444-4444-4444-444444444444');
select pg_temp.ok((select empresa_id from entrar_empresa()) <> '11111111-1111-1111-1111-111111111111', 'otra cuenta tiene otra empresa');
select pg_temp.ok((select count(*) from registros) = 0 and (select count(*) from miembros) = 1, 'otra empresa no ve nada ajeno');
select pg_temp.falla($$insert into registros (owner_id,tipo,id,datos,actualizado) values ('11111111-1111-1111-1111-111111111111','venta','x','{}', now())$$, 'escribir en empresa ajena');

-- Admin: fecha futura, último cambio, roles
select pg_temp.como('11111111-1111-1111-1111-111111111111');
update registros set datos = datos || '{"precio":5000}', actualizado = '9999-01-01' where id='p1';
select pg_temp.ok((select actualizado < now() + interval '1 hour' from registros where id='p1'), 'fecha futura se corrige');
update registros set datos = datos || '{"precio":1}', actualizado = now() - interval '1 day' where id='p1';
select pg_temp.ok((select (datos->>'precio')::int from registros where id='p1') = 5000, 'cambio viejo no pisa el nuevo');
select pg_temp.falla($$select cambiar_miembro('11111111-1111-1111-1111-111111111111','trabajador')$$, 'quitar el último admin');
select cambiar_miembro('22222222-2222-2222-2222-222222222222','admin');
select cambiar_miembro('11111111-1111-1111-1111-111111111111','trabajador');
select pg_temp.como('22222222-2222-2222-2222-222222222222');
select cambiar_miembro('11111111-1111-1111-1111-111111111111', null);
select pg_temp.como('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select count(*) from registros where owner_id='11111111-1111-1111-1111-111111111111') = 0, 'miembro quitado ya no ve la empresa');
