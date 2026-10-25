# 003 · Varias personas por empresa (admin / trabajador)

Revisado por los agentes `capitan` y `seguridad`: hacerlo, con los cambios de abajo.

**Modelo:** `empresas`, `miembros` (una persona = una empresa, con rol y serie de facturas) e `invitaciones`. `registros.owner_id` pasa a ser el id de la empresa; los dueños actuales conservan su id, así las versiones anteriores siguen funcionando para ellos.

**Roles fijos (v1):** el admin hace todo. El trabajador vende y ve inventario, ventas y facturas. No ve gastos ni informes, ni cambia productos, ajustes o el equipo. Si hicieran falta permisos configurables, sería una versión posterior.

**Seguridad (en el servidor, no en la app):**
- RLS por empresa y rol. Los cambios de equipo solo pasan por funciones `security definer` que exigen ser admin. La empresa nunca se queda sin admin.
- Las invitaciones solo se aceptan con el correo confirmado, se usan una vez y caducan a los 14 días. Hay que tener **Confirm email** activado en Supabase.
- Las ventas solo se insertan y nunca se reescriben. Su total lo recalcula el servidor a partir de las líneas.
- Una fecha `actualizado` en el futuro se corrige a la hora del servidor.

**Cambios de datos que trae:**
- El stock ya no se guarda descontado. Se calcula como `stockBase` (el recuento que pone el admin) menos las ventas posteriores a `stockFecha`. Las ventas de varios equipos sin conexión se suman.
- Cada persona factura con su propia serie (`FAC-E2-2026-0001`). El dueño mantiene `FAC-2026-0001`.
- El tema y el idioma son preferencias de cada equipo.

**Límites:**
- El precio de cada línea de una venta lo pone el equipo del trabajador. El servidor solo garantiza que el total cuadra con las líneas.
- Una misma persona usando dos equipos sin conexión a la vez puede repetir un número dentro de su serie.
- Lo que alguien ya bajó a su equipo no se puede borrar a distancia si se le quita del equipo. La app borra sus datos locales al detectarlo, pero solo cuando se conecta.

**Pruebas:** `supabase/pruebas/` contiene 22 comprobaciones de RLS y roles sobre Postgres.
