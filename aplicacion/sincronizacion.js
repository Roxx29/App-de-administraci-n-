// Sincronización local ⇄ Supabase. Funciones puras: no tocan disco ni red.
// Cada producto, venta, gasto y los ajustes son un "registro"; gana la última modificación.

const CLAVE_AJUSTES = 'ajustes:ajustes';

function registrosDe(datos) {
  const m = new Map();
  for (const p of datos.productos) m.set(`producto:${p.id}`, { tipo: 'producto', id: p.id, datos: p });
  for (const v of datos.ventas) m.set(`venta:${v.id}`, { tipo: 'venta', id: v.id, datos: v });
  for (const g of datos.gastos || []) m.set(`gasto:${g.id}`, { tipo: 'gasto', id: g.id, datos: g });
  for (const a of datos.anulaciones || []) m.set(`anulacion:${a.id}`, { tipo: 'anulacion', id: a.id, datos: a });
  m.set(CLAVE_AJUSTES, { tipo: 'ajustes', id: 'ajustes', datos: datos.ajustes });
  return m;
}

// Cambios hechos entre dos versiones de los datos (datos null = borrado).
function diferencias(antes, despues) {
  const a = registrosDe(antes);
  const d = registrosDe(despues);
  const cambios = [];
  for (const [k, r] of d) if (!a.has(k) || JSON.stringify(a.get(k).datos) !== JSON.stringify(r.datos)) cambios.push(r);
  for (const [k, r] of a) if (!d.has(k)) cambios.push({ tipo: r.tipo, id: r.id, datos: null });
  return cambios;
}

function aplicar(datos, cambios) {
  const listas = { producto: [...datos.productos], venta: [...datos.ventas], gasto: [...(datos.gastos || [])], anulacion: [...(datos.anulaciones || [])] };
  let ajustes = datos.ajustes;
  for (const c of cambios) {
    if (c.tipo === 'ajustes') {
      if (c.datos) ajustes = c.datos;
      continue;
    }
    const lista = listas[c.tipo];
    if (!lista) continue;
    const i = lista.findIndex((x) => x.id === c.id);
    if (c.datos === null) i >= 0 && lista.splice(i, 1);
    else if (i >= 0) lista[i] = c.datos;
    else lista.push(c.datos);
  }
  listas.venta.sort((x, y) => x.fecha.localeCompare(y.fecha));
  return { ...datos, ajustes, productos: listas.producto, ventas: listas.venta, gastos: listas.gasto, anulaciones: listas.anulacion };
}

const estadoInicial = () => ({ usuario: null, cursor: null, pendientes: {}, versiones: {} });

// Anota cambios locales para subirlos, con la hora en que se hicieron.
function anotarPendientes(estado, cambios, ahora = new Date().toISOString()) {
  const pendientes = { ...estado.pendientes };
  const versiones = { ...estado.versiones };
  for (const c of cambios) {
    const k = `${c.tipo}:${c.id}`;
    pendientes[k] = { tipo: c.tipo, id: c.id, datos: c.datos, borrado: c.datos === null, actualizado: ahora };
    versiones[k] = ahora;
  }
  return { ...estado, pendientes, versiones };
}

// Tras subir, se quitan solo los pendientes que no volvieron a cambiar mientras tanto.
function quitarSubidos(estado, subidos) {
  const pendientes = { ...estado.pendientes };
  for (const s of subidos) {
    const k = `${s.tipo}:${s.id}`;
    if (pendientes[k]?.actualizado === s.actualizado) delete pendientes[k];
  }
  return { ...estado, pendientes };
}

// Mezcla filas bajadas de Supabase; solo entran las más nuevas que lo que hay en local.
function fusionarRemotos(datos, estado, filas) {
  const versiones = { ...estado.versiones };
  const pendientes = { ...estado.pendientes };
  const cambios = [];
  let cursor = estado.cursor;
  for (const f of filas) {
    if (!cursor || f.recibido > cursor) cursor = f.recibido;
    const k = `${f.tipo}:${f.id}`;
    if (versiones[k] && versiones[k] >= f.actualizado) continue;
    versiones[k] = f.actualizado;
    delete pendientes[k];
    cambios.push({ tipo: f.tipo, id: f.id, datos: f.borrado ? null : f.datos });
  }
  return { datos: cambios.length ? aplicar(datos, cambios) : datos, estado: { ...estado, versiones, pendientes, cursor }, hubo: cambios.length > 0 };
}

if (typeof module !== 'undefined') module.exports = { registrosDe, diferencias, aplicar, estadoInicial, anotarPendientes, quitarSubidos, fusionarRemotos };
