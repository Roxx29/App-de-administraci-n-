const test = require('node:test');
const assert = require('node:assert');
const S = require('./sincronizacion.js');
const { normalizar } = require('./src/logica.js');
const { crearNucleo } = require('./nucleo.js');

const almacenEnMemoria = () => {
  const archivos = {};
  return { archivos, leer: async (n) => (archivos[n] ? JSON.parse(archivos[n]) : null), escribir: async (n, v) => { archivos[n] = JSON.stringify(v); } };
};

test('sin nube: guarda en el almacén y aplica cambios sobre la versión que tenía la pantalla', async () => {
  const almacen = almacenEnMemoria();
  const n = crearNucleo({ S, normalizar, almacen, config: null, avisar: () => {} });
  await n.iniciar();
  const v1 = await n.leer();
  const prod = { id: 'p1', sku: 'A', nombre: 'Mesa', costo: 1, precio: 2, stockBase: 5, stockFecha: '2026-01-01', minimo: 0 };
  const v2 = await n.guardar({ rev: v1.rev, datos: { ...v1.datos, productos: [prod] } });
  // Otra pantalla con la versión vieja añade un gasto: no debe borrar el producto.
  const v3 = await n.guardar({ rev: v1.rev, datos: { ...v1.datos, gastos: [{ id: 'g1' }] } });
  assert.strictEqual(v3.datos.productos.length, 1);
  assert.strictEqual(v3.datos.gastos.length, 1);
  assert.ok(v3.rev > v2.rev);
  assert.strictEqual(JSON.parse(almacen.archivos['datos.json']).productos[0].nombre, 'Mesa');
  assert.deepStrictEqual(n.cuenta.estado(), { configurado: false, email: null, rol: 'admin', serie: '', permisos: [] });
});
