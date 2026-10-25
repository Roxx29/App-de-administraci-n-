const test = require('node:test');
const assert = require('node:assert');
const L = require('./logica.js');

const prod = (o) => ({ id: 'p1', sku: 'SKU-1', nombre: 'Lámpara', categoria: '', costo: 1850, precio: 4625, stock: 5, minimo: 2, ...o });

test('aCentimos acepta coma y punto, rechaza basura', () => {
  assert.strictEqual(L.aCentimos('46,25'), 4625);
  assert.strictEqual(L.aCentimos('46.2'), 4620);
  assert.strictEqual(L.aCentimos('0.1'), 10);
  assert.ok(Number.isNaN(L.aCentimos('abc')));
  assert.ok(Number.isNaN(L.aCentimos('-3')));
  assert.ok(Number.isNaN(L.aCentimos('1.234')));
});

test('totales desglosan IVA incluido y cuadran', () => {
  const t = L.totalesTicket([{ precio: 4625, cantidad: 1 }, { precio: 620, cantidad: 2 }], 21);
  assert.strictEqual(t.total, 5865);
  assert.strictEqual(t.base + t.cuota, t.total);
  assert.strictEqual(t.base, 4847);
});

test('registrarVenta descuenta stock y numera la factura', () => {
  const datos = { ...L.datosIniciales(), productos: [prod()] };
  const { datos: d2, venta } = L.registrarVenta(datos, [{ productoId: 'p1', sku: 'SKU-1', nombre: 'Lámpara', precio: 4625, cantidad: 2 }], { metodo: 'Efectivo', fecha: new Date('2026-10-25T10:00:00Z') });
  assert.strictEqual(d2.productos[0].stock, 3);
  assert.strictEqual(datos.productos[0].stock, 5, 'no muta los datos originales');
  assert.strictEqual(venta.numero, 'FAC-2026-0001');
  assert.strictEqual(venta.total, 9250);
});

test('registrarVenta rechaza stock insuficiente y ticket vacío', () => {
  const datos = { ...L.datosIniciales(), productos: [prod({ stock: 1 })] };
  assert.throws(() => L.registrarVenta(datos, [{ productoId: 'p1', nombre: 'Lámpara', precio: 1, cantidad: 2 }], { metodo: 'Efectivo' }), /Stock insuficiente/);
  assert.throws(() => L.registrarVenta(datos, [], { metodo: 'Efectivo' }), /vacío/);
});

test('validarProducto detecta SKU duplicado y estado de stock', () => {
  assert.match(L.validarProducto(prod({ id: 'p2' }), [prod()]), /SKU/);
  assert.strictEqual(L.validarProducto(prod(), [prod()]), null);
  assert.strictEqual(L.estadoStock(prod({ stock: 0 })), 'agotado');
  assert.strictEqual(L.estadoStock(prod({ stock: 2 })), 'bajo');
});
