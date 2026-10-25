# 002 · Supabase con trabajo sin conexión

**Decisión:** la app sigue guardando en `datos.json` y sincroniza con una tabla `registros` en Supabase (un registro por producto, venta, gasto y los ajustes). Cada cuenta = una empresa; RLS limita cada fila a su `owner_id`.

**Cómo:** los cambios locales quedan como pendientes y se suben al guardar, cada 30 s y al volver a la ventana. Se bajan los registros con `recibido` posterior al último visto. Gana el cambio más reciente (`actualizado`), también en el servidor (trigger).

**Límites conocidos:**
- Si dos equipos venden el mismo producto **sin conexión** a la vez, el stock final es el del último que sincroniza (no se suman ambas ventas). Con conexión se sincroniza al momento. Mejora futura: guardar movimientos de stock en vez del stock total.
- Dos equipos sin conexión pueden generar el mismo número de factura. Mejora futura: serie por equipo.
- Imágenes y logo van dentro del JSON; con muchos productos conviene moverlos a Supabase Storage.
