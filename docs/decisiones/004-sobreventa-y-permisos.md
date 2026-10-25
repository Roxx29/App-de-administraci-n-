# 004 · Sobreventa sin conexión y permisos por persona

Revisado por los agentes `capitan` y `seguridad`.

## Sobreventa sin conexión
Una venta hecha nunca se rechaza: la mercancía ya salió y el dinero ya entró. Si al sincronizar se vendió más de lo que había, el stock queda en negativo.
- **Alerta "Descuadre de stock"** en el Resumen. No se guarda en ningún sitio: se calcula a partir del stock negativo. Muestra las ventas desde el último recuento, con quién las hizo, cuándo y si se hicieron sin conexión.
- **Acciones:** recontar el stock (nueva base desde ese momento) o anular una venta. La anulación es un registro aparte con el mismo id que la venta. Devuelve el stock, deja de contar en informes y resúmenes y nunca borra la venta. El servidor impide anular dos veces y anular ventas que no existen.
- **Prevención:** si lleva más de 2 minutos sin sincronizar, el punto de venta avisa de que el stock puede no estar al día. Sin el permiso "vender sin conexión", el cobro se bloquea mientras no haya conexión.
- Pendiente legal: en España, anular una factura emitida puede requerir una **factura rectificativa**. Lo debe validar un asesor antes de usarlo como documento fiscal.

## Permisos por persona
El rol es una plantilla: el admin tiene todo y al trabajador se le activan permisos uno a uno en Ajustes → Equipo.
- **Los comprueba el servidor** (RLS y trigger campo a campo; todo campo sin grupo exige `editar_productos`): crear productos, editar productos (nombre, SKU, categoría, foto, mínimo, borrar), cambiar precios y costos, ajustar stock, anular ventas, gastos (ver y registrar).
- **Solo en la app** (el servidor no puede distinguirlos): vender sin conexión, ver informes (salen de las ventas, que todos leen) y exportar a Excel.
- **Solo admins:** el equipo y los ajustes de la empresa. Un permiso de "gestionar equipo" equivaldría a ser admin, porque permitiría darse todo.
- Cualquier miembro puede subir ventas, aunque pierda permisos, para que una venta hecha nunca quede atascada. El servidor valida que las cantidades sean positivas y los precios no negativos.

**Límites:**
- El precio de cada línea de una venta sigue viniendo del equipo que vende.
- Ocultar el costo no es seguridad, porque viaja dentro de los datos del producto.

**Pruebas:** `supabase/pruebas/03_pruebas_permisos.sql` contiene 16 comprobaciones más.
