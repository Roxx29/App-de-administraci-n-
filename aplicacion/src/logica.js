// Lógica de negocio pura: sin pantalla ni almacenamiento, para reutilizarla en móvil.
// El dinero se guarda siempre en céntimos (enteros) para evitar errores de redondeo.

const datosIniciales = () => ({
  ajustes: { negocio: 'Mi Negocio', nif: '', direccion: '', moneda: '€', iva: 21 },
  productos: [],
  ventas: [],
  secuencia: 0,
});

function aCentimos(texto) {
  const limpio = String(texto).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return NaN;
  return Math.round(Number(limpio) * 100);
}

function formatoDinero(centimos, moneda = '€') {
  const n = (centimos / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${moneda}${n}`;
}

function validarProducto(p, productos) {
  if (!p.nombre.trim()) return 'El nombre es obligatorio.';
  if (!p.sku.trim()) return 'El SKU es obligatorio.';
  if (productos.some((o) => o.id !== p.id && o.sku.toLowerCase() === p.sku.trim().toLowerCase())) return 'Ya existe un producto con ese SKU.';
  if (!Number.isInteger(p.precio) || p.precio < 0) return 'Precio de venta no válido.';
  if (!Number.isInteger(p.costo) || p.costo < 0) return 'Costo no válido.';
  if (!Number.isInteger(p.stock) || p.stock < 0) return 'El stock debe ser un número entero, 0 o mayor.';
  if (!Number.isInteger(p.minimo) || p.minimo < 0) return 'El mínimo debe ser un número entero, 0 o mayor.';
  return null;
}

function estadoStock(p) {
  if (p.stock <= 0) return 'agotado';
  if (p.stock <= p.minimo) return 'bajo';
  return 'ok';
}

// Los precios incluyen IVA: se desglosa la base a partir del total.
function totalesTicket(lineas, iva) {
  const total = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const base = Math.round(total / (1 + iva / 100));
  return { total, base, cuota: total - base };
}

function numeroFactura(anio, n) {
  return `FAC-${anio}-${String(n).padStart(4, '0')}`;
}

// Devuelve datos nuevos con la venta registrada y el stock descontado; lanza error si no hay stock.
function registrarVenta(datos, lineas, { metodo, cliente, fecha = new Date() }) {
  if (!lineas.length) throw new Error('El ticket está vacío.');
  const productos = datos.productos.map((p) => ({ ...p }));
  for (const l of lineas) {
    const p = productos.find((x) => x.id === l.productoId);
    if (!p) throw new Error(`El producto ${l.nombre} ya no existe.`);
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) throw new Error(`Cantidad no válida para ${p.nombre}.`);
    if (p.stock < l.cantidad) throw new Error(`Stock insuficiente de ${p.nombre} (quedan ${p.stock}).`);
    p.stock -= l.cantidad;
  }
  const secuencia = datos.secuencia + 1;
  const { total, base, cuota } = totalesTicket(lineas, datos.ajustes.iva);
  const venta = {
    id: `v${secuencia}`,
    numero: numeroFactura(fecha.getFullYear(), secuencia),
    fecha: fecha.toISOString(),
    cliente: cliente || 'Cliente mostrador',
    metodo,
    iva: datos.ajustes.iva,
    lineas: lineas.map(({ productoId, sku, nombre, precio, cantidad }) => ({ productoId, sku, nombre, precio, cantidad })),
    total,
    base,
    cuota,
  };
  return { datos: { ...datos, productos, ventas: [...datos.ventas, venta], secuencia }, venta };
}

function resumen(datos, hoy = new Date()) {
  const dia = hoy.toISOString().slice(0, 10);
  const deHoy = datos.ventas.filter((v) => v.fecha.slice(0, 10) === dia);
  return {
    ventasHoy: deHoy.reduce((s, v) => s + v.total, 0),
    ticketsHoy: deHoy.length,
    ventasTotal: datos.ventas.reduce((s, v) => s + v.total, 0),
    valorInventario: datos.productos.reduce((s, p) => s + p.costo * p.stock, 0),
    alertas: datos.productos.filter((p) => estadoStock(p) !== 'ok'),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { datosIniciales, aCentimos, formatoDinero, validarProducto, estadoStock, totalesTicket, numeroFactura, registrarVenta, resumen };
}
