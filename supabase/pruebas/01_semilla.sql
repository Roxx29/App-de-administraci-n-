insert into auth.users values
 ('11111111-1111-1111-1111-111111111111','dueno@x.com', now()),
 ('22222222-2222-2222-2222-222222222222','trabajador@x.com', now()),
 ('33333333-3333-3333-3333-333333333333','sinconfirmar@x.com', null),
 ('44444444-4444-4444-4444-444444444444','otra@x.com', now());
-- Datos del dueño creados con la versión 001
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
insert into registros (tipo,id,datos,actualizado) values
 ('producto','p1','{"id":"p1","nombre":"Lámpara","precio":4625,"stockBase":10}', now()),
 ('gasto','g1','{"id":"g1","importe":5000}', now()),
 ('ajustes','ajustes','{"negocio":"Tienda"}', now());
reset role;
