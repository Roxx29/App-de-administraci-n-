const test = require('node:test');
const assert = require('node:assert');
const S = require('./sincronizacion.js');
const { datosIniciales } = require('./src/logica.js');

const prod = (id, o = {}) => ({ id, sku: id.toUpperCase(), nombre: id, categoria: '', costo: 100, precio: 200, stock: 5, minimo: 1, ...o });
const base = () => ({ ...datosIniciales(), productos: [prod('a'), prod('b')] });

test('diferencias detecta altas, cambios y bajas', () => {
  const antes = base();
  const despues = { ...antes, productos: [prod('a', { stock: 2 }), prod('c')] };
  const c = S.diferencias(antes, despues);
  assert.deepStrictEqual(c.map((x) => `${x.id}:${x.datos ? 'dato' : 'borrado'}`).sort(), ['a:dato', 'b:borrado', 'c:dato']);
});

test('fusionar acepta lo remoto más nuevo e ignora lo viejo', () => {
  let estado = S.anotarPendientes(S.estadoInicial(), [{ tipo: 'producto', id: 'a', datos: prod('a', { stock: 9 }) }], '2026-10-25T10:00:00Z');
  const filas = [
    { tipo: 'producto', id: 'a', datos: prod('a', { stock: 1 }), borrado: false, actualizado: '2026-10-25T09:00:00Z', recibido: '2026-10-25T11:00:00Z' },
    { tipo: 'producto', id: 'b', datos: null, borrado: true, actualizado: '2026-10-25T09:30:00Z', recibido: '2026-10-25T11:00:01Z' },
    { tipo: 'venta', id: 'v9', datos: { id: 'v9', numero: 'FAC-2026-0042', fecha: '2026-10-25T09:00:00Z', lineas: [] }, borrado: false, actualizado: '2026-10-25T09:00:00Z', recibido: '2026-10-25T11:00:02Z' },
  ];
  const r = S.fusionarRemotos(base(), estado, filas);
  assert.strictEqual(r.datos.productos.find((p) => p.id === 'a').stock, 5, 'el cambio local más nuevo se conserva');
  assert.ok(!r.datos.productos.some((p) => p.id === 'b'), 'el borrado remoto se aplica');
  assert.strictEqual(r.datos.ventas.length, 1);
  assert.strictEqual(r.datos.secuencia, 42, 'la numeración sigue a la factura más alta');
  assert.strictEqual(r.estado.cursor, '2026-10-25T11:00:02Z');
  assert.ok(r.estado.pendientes['producto:a'], 'el pendiente local sigue para subirse');
  // Reaplicar las mismas filas no cambia nada.
  assert.strictEqual(S.fusionarRemotos(r.datos, r.estado, filas).hubo, false);
});

test('quitarSubidos no borra un pendiente que cambió mientras se subía', () => {
  let e = S.anotarPendientes(S.estadoInicial(), [{ tipo: 'gasto', id: 'g', datos: { id: 'g' } }], 't1');
  const subidos = Object.values(e.pendientes);
  e = S.anotarPendientes(e, [{ tipo: 'gasto', id: 'g', datos: { id: 'g', x: 1 } }], 't2');
  assert.ok(S.quitarSubidos(e, subidos).pendientes['gasto:g']);
  assert.deepStrictEqual(S.quitarSubidos(S.anotarPendientes(S.estadoInicial(), [{ tipo: 'gasto', id: 'g', datos: {} }], 't1'), subidos).pendientes, {});
});
