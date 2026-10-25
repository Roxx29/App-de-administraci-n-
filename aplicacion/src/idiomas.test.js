const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { TRADUCCIONES, t, fijarIdioma } = require('./idiomas.js');
const { CATEGORIAS_GASTO } = require('./logica.js');

test('todo texto traducible de la app tiene traducción al inglés', () => {
  const codigo = ['app.js', 'factura.js', 'logica.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  const literales = [...codigo.matchAll(/\btr?\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  const dinamicos = [...CATEGORIAS_GASTO, 'Óptimo', 'Stock bajo', 'Agotado', 'Mes anterior', 'Este año', 'Todo', 'Efectivo', 'Tarjeta', 'Transferencia', 'Domiciliación',
    'Oscuro', 'Claro', 'Clásica', 'Moderna', 'Minimalista', 'Izquierda', 'Centro', 'Derecha', 'Usar imágenes en los productos', 'Mostrar logo', 'Mostrar SKU', 'Mostrar método de pago',
    'Crear productos', 'Editar productos (nombre, SKU, categoría, foto)', 'Cambiar precios y costos', 'Ajustar stock (recuentos)', 'Anular ventas',
    'Ver y registrar gastos', 'Ver informes', 'Exportar a Excel', 'Vender sin conexión', 'Vender', 'Inventario', 'Resumen', 'Ventas'];
  const faltan = [...new Set([...literales, ...dinamicos])].filter((k) => !(k in TRADUCCIONES.en));
  assert.deepStrictEqual(faltan, []);
});

test('t traduce con parámetros y cae al español', () => {
  fijarIdioma('en');
  assert.strictEqual(t('Venta registrada: {n}', { n: 'FAC-1' }), 'Sale recorded: FAC-1');
  assert.strictEqual(t('Texto sin traducir'), 'Texto sin traducir');
  fijarIdioma('es');
  assert.strictEqual(t('Venta registrada: {n}', { n: 'FAC-1' }), 'Venta registrada: FAC-1');
});
