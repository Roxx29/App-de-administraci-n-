/* global descuadres, anularVenta, ventasValidas, conStock, sinStock, t, fijarIdioma, htmlFactura, fijarTraductor, normalizar, facturaInicial, CATEGORIAS_GASTO, diaLocal, validarGasto, informe, serieMensual, totalesTicket, aCentimos, formatoDinero, validarProducto, estadoStock, registrarVenta, resumen */
let datos;
let ticket = []; // líneas del ticket en curso
let metodoPago = 'Efectivo';
let periodo = 'mes'; // periodo elegido en Informes
let rev = 0; // versión de los datos que tiene esta pantalla (ver main.js)
let cuentaEmail = null;
let miRol = 'admin'; // 'admin' o 'trabajador' (sin cuenta en la nube, siempre admin)
let miSerie = '';
let misPermisos = [];
const esAdmin = () => miRol === 'admin';
// El admin puede todo; el resto, lo que el admin le haya activado (la seguridad real la aplica el servidor).
const puedo = (permiso) => esAdmin() || misPermisos.includes(permiso);
const puedoTocarProductos = () => ['editar_productos', 'editar_precios', 'ajustar_stock'].some(puedo);
const PERMISO_VISTA = { gastos: 'gastos', informes: 'ver_informes' };
const vistaPermitida = (v) => (PERMISO_VISTA[v] ? puedo(PERMISO_VISTA[v]) : true);
const PERMISOS = [
  ['crear_productos', 'Crear productos'], ['editar_productos', 'Editar productos (nombre, SKU, categoría, foto)'], ['editar_precios', 'Cambiar precios y costos'],
  ['ajustar_stock', 'Ajustar stock (recuentos)'], ['anular_ventas', 'Anular ventas'], ['gastos', 'Ver y registrar gastos'],
  ['ver_informes', 'Ver informes'], ['exportar', 'Exportar a Excel'], ['vender_sin_conexion', 'Vender sin conexión'],
];
const titulo = (largo, corto) => `<span class="solo-d">${t(largo)}</span><span class="solo-m">${t(corto)}</span>`;
const botonExportar = (id, activo = true) => (puedo('exportar') ? `<button id="${id}" ${activo ? '' : 'disabled'}>${t('Exportar a Excel')}</button>` : '');
// Sin sincronizar hace más de 2 minutos, el stock puede no reflejar lo vendido en otros equipos.
const sinSincronizar = () => !!cuentaEmail && (ultimoSync.estado !== 'ok' || Date.now() - new Date(ultimoSync.hora) > 120000);
let ultimoSync = { estado: 'local' };

const $ = (s) => document.querySelector(s);
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const locale = () => (preferencias().idioma === 'en' ? 'en-US' : 'es-ES');
const dinero = (c) => formatoDinero(c, datos.ajustes.moneda, locale());
const decimal = (c) => (c / 100).toFixed(2);
const fecha = (iso) => new Date(iso).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
const fechaDia = (dia) => new Date(dia + 'T00:00').toLocaleDateString(locale());
const ESTADOS = { ok: 'Óptimo', bajo: 'Stock bajo', agotado: 'Agotado' };
const conImagenes = () => datos.ajustes.imagenes;
const miniatura = (p, clase) => (p.imagen ? `<img class="${clase}" src="${p.imagen}" alt="">` : `<span class="${clase} sin-imagen" aria-hidden="true">▣</span>`);
const opciones = (lista, actual) => lista.map((v) => `<option value="${esc(v)}" ${v === actual ? 'selected' : ''}>${esc(t(v))}</option>`).join('');

function avisar(texto, mal = false) {
  const a = $('#aviso');
  a.textContent = texto;
  a.className = 'visible' + (mal ? ' mal' : '');
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (a.className = ''), 2800);
}

async function guardar(nuevos) {
  try {
    recibir(await window.api.guardarDatos({ rev, datos: sinStock(nuevos) }));
    return true;
  } catch (e) {
    avisar(t('No se pudo guardar: {e}', { e: e.message }), true);
    return false;
  }
}

// Redimensiona la imagen elegida y la devuelve como data URL para guardarla en los datos.
// shortcut: las imágenes van dentro de datos.json; con miles de productos conviene guardarlas como archivos aparte.
function leerImagen(archivo, max, tipo) {
  return new Promise((ok, mal) => {
    if (!archivo.type.startsWith('image/')) return mal(new Error(t('El archivo no es una imagen.')));
    if (archivo.size > 10 * 1024 * 1024) return mal(new Error(t('La imagen pesa más de 10 MB.')));
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      // JPEG no tiene transparencia: sin fondo blanco, las zonas transparentes salen negras.
      if (tipo === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL(tipo, 0.85));
    };
    img.onerror = () => mal(new Error(t('No se pudo leer la imagen.')));
    img.src = URL.createObjectURL(archivo);
  });
}

// ---------- Vistas ----------
const vistas = {
  resumen() {
    const r = resumen(datos);
    const ultimas = ventasValidas(datos).slice(-5).reverse();
    const faltas = descuadres(datos);
    return `
      <h1>${titulo('Resumen Diario', 'Hoy')}</h1><p class="sub">${new Date().toLocaleDateString(locale(), { dateStyle: 'full' })}</p>
      ${faltas.length ? `<section class="panel alerta-descuadre"><h2>${t('Descuadre de stock')}</h2>
        <p class="sub">${t('Se vendió más de lo que había, normalmente por ventas hechas sin conexión en varios equipos. Recuenta el stock o anula la venta que no se pudo entregar.')}</p>
        ${faltas.map((d) => `<div class="descuadre">
          <div class="cabecera"><b>${esc(d.producto.nombre)} <small class="chip agotado">${t('Faltan {n}', { n: d.faltan })}</small></b>
            ${puedo('ajustar_stock') ? `<button data-recontar="${d.producto.id}">${t('Recontar stock')}</button>` : ''}</div>
          <table>${d.ventas.map(({ venta: v, cantidad }) => `<tr><td class="mono">${v.numero}</td><td>${fecha(v.fecha)}</td><td>${esc(v.vendedor || '—')}${v.sinConexion ? ` <small class="chip bajo">${t('sin conexión')}</small>` : ''}</td>
            <td class="num">${t('{n} uds', { n: cantidad })}</td><td class="num">${puedo('anular_ventas') ? `<button data-anular="${v.id}">${t('Anular')}</button>` : ''}</td></tr>`).join('')}</table>
        </div>`).join('')}
      </section>` : ''}
      <div class="tarjetas">
        <div class="tarjeta"><small>${t('Ventas de hoy')}</small><div class="valor">${dinero(r.ventasHoy)}</div><small>${t('{n} tickets', { n: r.ticketsHoy })}</small></div>
        <div class="tarjeta"><small>${t('Ventas totales')}</small><div class="valor">${dinero(r.ventasTotal)}</div><small>${t('{n} facturas', { n: datos.ventas.length })}</small></div>
        <div class="tarjeta"><small>${t('Valor inventario (costo)')}</small><div class="valor">${dinero(r.valorInventario)}</div><small>${t('{n} productos', { n: datos.productos.length })}</small></div>
        <div class="tarjeta"><small>${t('Alertas de stock')}</small><div class="valor ${r.alertas.length ? 'bajo' : 'ok'}">${r.alertas.length}</div><small>${t('bajo mínimo o agotados')}</small></div>
      </div>
      <div class="tarjetas">
        <div class="panel"><h2>${t('Productos por reponer')}</h2>${r.alertas.length ? `<table>${r.alertas.map((p) => `<tr><td>${esc(p.nombre)}</td><td class="num"><span class="chip ${estadoStock(p)}">${t('{n} uds', { n: p.stock })}</span></td></tr>`).join('')}</table>` : `<p class="vacio">${t('Todo en orden.')}</p>`}</div>
        <div class="panel"><h2>${t('Últimas ventas')}</h2>${ultimas.length ? `<table>${ultimas.map((v) => `<tr><td class="mono">${v.numero}</td><td>${fecha(v.fecha)}</td><td class="num">${dinero(v.total)}</td></tr>`).join('')}</table>` : `<p class="vacio">${t('Aún no hay ventas.')}</p>`}</div>
      </div>`;
  },

  inventario() {
    return `
      <div class="cabecera"><div><h1>${titulo('Inventario & Catálogo', 'Inventario')}</h1><p class="sub">${t('{n} productos', { n: datos.productos.length })}</p></div>
        <div class="acciones">${botonExportar('exportar-productos')}${puedo('crear_productos') ? `<button class="primario" id="nuevo-producto">${t('+ Nuevo producto')}</button>` : ''}</div></div>
      <input class="buscador" id="buscar" placeholder="${t('Buscar por nombre, SKU o categoría…')}" aria-label="${t('Buscar productos')}">
      <div class="panel"><table class="tabla-inventario">
        <thead><tr>${conImagenes() ? '<th></th>' : ''}<th>SKU</th><th>${t('Producto')}</th><th>${t('Categoría')}</th><th class="num">${t('Existencias')}</th><th class="num">${t('Costo')}</th><th class="num">${t('Precio (IVA incl.)')}</th><th class="num">${t('Margen')}</th><th></th></tr></thead>
        <tbody id="filas"></tbody></table></div>`;
  },

  venta() {
    return `
      <h1>${titulo('Punto de Venta', 'Vender')}</h1><p class="sub solo-d">${window.api.movil ? t('Toca un producto para añadirlo al ticket.') : t('Haz clic en un producto para añadirlo al ticket.')}</p>
      <div id="aviso-sync"></div>
      <div class="pos">
        <div><input class="buscador" id="buscar" placeholder="${t('Buscar producto o SKU…')}" aria-label="${t('Buscar productos')}"><div class="rejilla" id="rejilla"></div></div>
        <div class="panel" id="ticket"></div>
      </div>`;
  },

  ventas() {
    const lista = datos.ventas.slice().reverse();
    const anuladas = new Map(datos.anulaciones.map((a) => [a.id, a]));
    return `
      <div class="cabecera"><div><h1>${titulo('Ventas & Facturas', 'Ventas')}</h1><p class="sub">${t('{n} facturas emitidas', { n: datos.ventas.length })}</p></div>
        <div class="acciones">${botonExportar('exportar-ventas', lista.length)}</div></div>
      <div class="panel">${lista.length ? `<table class="tabla-ventas">
        <thead><tr><th>${t('Factura')}</th><th>${t('Fecha')}</th><th>${t('Cliente')}</th><th>${t('Método')}</th><th class="num">${t('Artículos')}</th><th class="num">${t('Total')}</th><th></th></tr></thead>
        <tbody>${lista.map((v) => `<tr class="${anuladas.has(v.id) ? 'anulada' : ''}"><td class="mono c-num">${v.numero}${anuladas.has(v.id) ? ` <small class="chip agotado" title="${esc(anuladas.get(v.id).motivo)}">${t('Anulada')}</small>` : ''}</td><td class="c-fecha">${fecha(v.fecha)}</td><td class="c-cliente">${esc(v.cliente)}</td><td class="c-metodo">${esc(t(v.metodo))}</td>
          <td class="num c-art">${v.lineas.reduce((s, l) => s + l.cantidad, 0)}</td><td class="num c-total">${dinero(v.total)}</td>
          <td class="num c-accion"><div class="acciones fin">${puedo('anular_ventas') && !anuladas.has(v.id) ? `<button class="boton-anular" data-anular="${v.id}">${t('Anular')}</button>` : ''}<button data-pdf="${v.id}" aria-label="${t('Factura PDF')} ${v.numero}">${t('Factura PDF')}</button></div></td></tr>`).join('')}</tbody></table>` : `<p class="vacio">${t('Aún no hay ventas. Registra la primera en el Punto de Venta.')}</p>`}</div>`;
  },

  gastos() {
    const lista = datos.gastos.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
    const mes = diaLocal(new Date()).slice(0, 7);
    const delMes = datos.gastos.filter((g) => g.fecha.startsWith(mes)).reduce((s, g) => s + g.importe, 0);
    return `
      <div class="cabecera"><div><h1>${titulo('Gastos Operativos', 'Gastos')}</h1><p class="sub">${t('Este mes')}: <b class="mono">${dinero(delMes)}</b> · ${t('{n} gastos registrados', { n: datos.gastos.length })}</p></div>
        <div class="acciones">${botonExportar('exportar-gastos', lista.length)}<button class="primario" id="nuevo-gasto">${t('+ Nuevo gasto')}</button></div></div>
      <div class="panel">${lista.length ? `<table class="tabla-gastos">
        <thead><tr><th>${t('Fecha')}</th><th>${t('Concepto')}</th><th>${t('Categoría')}</th><th>${t('Método')}</th><th class="num">${t('Importe')}</th><th></th></tr></thead>
        <tbody>${lista.map((g) => `<tr><td class="mono c-fecha">${fechaDia(g.fecha)}</td><td class="c-concepto">${esc(g.concepto)}</td><td class="c-cat">${esc(t(g.categoria))}</td><td class="c-metodo">${esc(t(g.metodo))}</td>
          <td class="num c-importe">${dinero(g.importe)}</td><td class="num c-accion"><button data-editar="${g.id}" aria-label="${t('Editar')} ${esc(g.concepto)}">${t('Editar')}</button></td></tr>`).join('')}</tbody></table>`
        : `<p class="vacio">${t('Aún no hay gastos. Registra alquiler, proveedores, luz… para ver la rentabilidad real en Informes.')}</p>`}</div>`;
  },

  informes() {
    const [desde, hasta] = rangoPeriodo();
    const r = informe(datos, desde, hasta);
    const serie = serieMensual(datos, 6, new Date(), locale());
    const maxSerie = Math.max(1, ...serie.flatMap((m) => [m.ingresos, m.costes]));
    const maxCat = Math.max(1, ...r.porCategoria.map((c) => c[1]));
    const periodos = { mes: 'Este mes', anterior: 'Mes anterior', anio: 'Este año', todo: 'Todo' };
    const rango = periodo === 'todo' ? t('Todo el historial') : t('Del {d} al {h}', { d: fechaDia(desde), h: fechaDia(hasta) });
    return `
      <div class="cabecera"><div><h1>${titulo('Informes & Rentabilidad', 'Informes')}</h1><p class="sub">${rango} · ${t('importes sin IVA')}</p></div>
        <div class="acciones">${Object.entries(periodos).map(([k, v]) => `<button data-periodo="${k}" class="${k === periodo ? 'activo-periodo' : ''}">${t(v)}</button>`).join('')}
        ${puedo('exportar') ? `<button class="primario" id="exportar-informe">${t('Exportar a Excel')}</button>` : ''}</div></div>
      <div class="tarjetas">
        <div class="tarjeta"><small>${t('Beneficio neto')}</small><div class="valor ${r.beneficio < 0 ? 'agotado' : 'ok'}">${dinero(r.beneficio)}</div><small>${t('Margen neto {m}%', { m: r.margen })}</small></div>
        <div class="tarjeta"><small>${t('Ingresos (sin IVA)')}</small><div class="valor">${dinero(r.ingresos)}</div><small>${t('{n} tickets', { n: r.tickets })} · ${t('facturado')} ${dinero(r.facturado)}</small></div>
        <div class="tarjeta"><small>${t('Costo mercancía vendida')}</small><div class="valor">${dinero(r.cogs)}</div><small>${t('según costo de compra')}</small></div>
        <div class="tarjeta"><small>${t('Gastos operativos')}</small><div class="valor">${dinero(r.gastos)}</div><small>${t('{n} categorías', { n: r.porCategoria.length })}</small></div>
        <div class="tarjeta"><small>${t('IVA repercutido')}</small><div class="valor">${dinero(r.iva)}</div><small>${t('a declarar')}</small></div>
      </div>
      <div class="dos-paneles">
        <div class="panel"><div class="cabecera"><h2>${t('Ingresos vs. costes · últimos 6 meses')}</h2>
          <div class="leyenda"><span><i style="background:var(--serie-1)"></i>${t('Ingresos')}</span><span><i style="background:var(--serie-2)"></i>${t('Costes (mercancía + gastos)')}</span></div></div>
          <div class="grafico" role="img" aria-label="${t('Ingresos y costes por mes')}">
            ${serie.map((m) => `<div class="mes"><div class="barras">
              <div class="barra" style="height:${(m.ingresos / maxSerie) * 100}%;background:var(--serie-1)" title="${m.mes} · ${t('Ingresos')} ${dinero(m.ingresos)}"></div>
              <div class="barra" style="height:${(m.costes / maxSerie) * 100}%;background:var(--serie-2)" title="${m.mes} · ${t('Costes')} ${dinero(m.costes)}"></div>
            </div><small>${m.mes}</small><small class="${m.beneficio < 0 ? 'agotado' : 'ok'}">${dinero(m.beneficio)}</small></div>`).join('')}
          </div></div>
        <div class="panel"><h2>${t('Gastos por categoría')}</h2>${r.porCategoria.length ? r.porCategoria.map(([c, v]) => `
          <div class="categoria"><div class="cabecera"><span>${esc(t(c))}</span><span class="mono">${dinero(v)}</span></div>
          <div class="pista"><div style="width:${(v / maxCat) * 100}%"></div></div></div>`).join('') : `<p class="vacio">${t('Sin gastos en este periodo.')}</p>`}</div>
      </div>
      <div class="panel" style="margin-top:12px"><h2>${t('Rentabilidad por producto')}</h2>${r.topProductos.length ? `<table>
        <thead><tr><th>${t('Producto')}</th><th class="num">${t('Unidades')}</th><th class="num">${t('Ingresos')}</th><th class="num">${t('Costo')}</th><th class="num">${t('Beneficio bruto')}</th><th class="num">${t('Margen')}</th></tr></thead>
        <tbody>${r.topProductos.map((p) => `<tr><td>${esc(p.nombre)} <small class="chip">${esc(p.sku)}</small></td><td class="num">${p.unidades}</td><td class="num">${dinero(p.ingresos)}</td>
          <td class="num">${dinero(p.costo)}</td><td class="num">${dinero(p.ingresos - p.costo)}</td><td class="num">${p.ingresos ? Math.round(((p.ingresos - p.costo) / p.ingresos) * 100) : 0}%</td></tr>`).join('')}</tbody></table>`
        : `<p class="vacio">${t('Sin ventas en este periodo.')}</p>`}</div>`;
  },

  ajustes() {
    const a = datos.ajustes;
    const f = a.factura;
    const pref = preferencias();
    const casilla = (nombre, valor, texto) => `<label class="casilla"><input type="checkbox" name="${nombre}" ${valor ? 'checked' : ''}> ${t(texto)}</label>`;
    return `
      <div class="cabecera"><div><h1>${t('Ajustes')}</h1><p class="sub">${esAdmin() ? t('Datos del negocio, apariencia y diseño de las facturas.') : t('Apariencia de la app en este equipo y tu cuenta.')}</p></div>
        <div class="acciones"><button class="primario" form="form-ajustes">${t('Guardar ajustes')}</button></div></div>
      <form id="form-ajustes" class="ajustes ${esAdmin() ? '' : 'solo-preferencias'}">
        <div class="columna">
          ${esAdmin() ? `<section class="panel"><h2>${t('Negocio')}</h2>
            <label>${t('Nombre del negocio')}<input name="negocio" required value="${esc(a.negocio)}"></label>
            <label>${t('NIF / CIF / RUC')}<input name="nif" value="${esc(a.nif)}"></label>
            <label>${t('Dirección')}<input name="direccion" value="${esc(a.direccion)}"></label>
            <div class="dos">
              <label>${t('Símbolo de moneda')}<input name="moneda" required maxlength="4" value="${esc(a.moneda)}"></label>
              <label>${t('IVA (%)')}<input name="iva" required type="number" min="0" max="100" step="1" value="${a.iva}"></label>
            </div>
            <div class="etiqueta-campo">${t('Logo de la empresa')}</div>
            <div class="logo-campo">
              <div class="logo-vista" id="logo-vista">${a.logo ? `<img src="${a.logo}" alt="${t('Logo')}">` : `<small>${t('Sin logo')}</small>`}</div>
              <div class="acciones"><button type="button" id="elegir-logo">${t('Subir logo')}</button><button type="button" class="peligro" id="quitar-logo" ${a.logo ? '' : 'hidden'}>${t('Quitar')}</button></div>
              <input type="file" id="archivo-logo" accept="image/*" hidden>
            </div>
          </section>` : ''}
          <section class="panel"><h2>${t('Apariencia')}</h2>
            <div class="dos">
              <label>${t('Tema')}<select name="tema">${['oscuro', 'claro'].map((v) => `<option value="${v}" ${v === pref.tema ? 'selected' : ''}>${t(v === 'oscuro' ? 'Oscuro' : 'Claro')}</option>`).join('')}</select></label>
              <label>${t('Idioma')}<select name="idioma"><option value="es" ${pref.idioma === 'es' ? 'selected' : ''}>Español</option><option value="en" ${pref.idioma === 'en' ? 'selected' : ''}>English</option></select></label>
            </div>
          </section>
          ${cuentaEmail ? `<section class="panel"><h2>${t('Cuenta')}</h2>
            <p class="cuenta-linea"><span>${esc(cuentaEmail)} · <b>${t(esAdmin() ? 'Administrador' : 'Trabajador')}</b></span><small id="sync-detalle">${esc(textoSync())}</small></p>
            <div class="acciones"><button type="button" id="sincronizar-ya">${t('Sincronizar ahora')}</button><button type="button" class="peligro" id="cerrar-sesion">${t('Cerrar sesión')}</button></div>
          </section>` : ''}
          ${esAdmin() ? `<section class="panel"><h2>${t('Productos')}</h2>
            ${casilla('imagenes', a.imagenes, 'Usar imágenes en los productos')}
            <small class="ayuda">${t('Muestra una foto en el inventario y en el punto de venta. Al desactivarlo, las fotos no se borran.')}</small>
          </section>` : ''}
        </div>
        ${esAdmin() ? `<section class="panel columna"><h2>${t('Diseño de factura')}</h2>
          <div class="dos">
            <label>${t('Plantilla')}<select name="plantilla">${['clasica', 'moderna', 'minimal'].map((v) => `<option value="${v}" ${v === f.plantilla ? 'selected' : ''}>${t({ clasica: 'Clásica', moderna: 'Moderna', minimal: 'Minimalista' }[v])}</option>`).join('')}</select></label>
            <label>${t('Color principal')}<input name="color" type="color" value="${esc(f.color)}"></label>
            <label>${t('Título del documento')}<input name="titulo" value="${esc(f.titulo)}"></label>
            <label>${t('Posición del logo')}<select name="logoPos">${['izquierda', 'centro', 'derecha'].map((v) => `<option value="${v}" ${v === f.logoPos ? 'selected' : ''}>${t({ izquierda: 'Izquierda', centro: 'Centro', derecha: 'Derecha' }[v])}</option>`).join('')}</select></label>
          </div>
          <label>${t('Texto bajo el encabezado')}<input name="cabecera" value="${esc(f.cabecera)}" placeholder="${t('Ej.: Tel. 600 000 000 · tienda@correo.com')}"></label>
          <label>${t('Mensaje final')}<input name="pie" value="${esc(f.pie)}"></label>
          <label>${t('Notas / condiciones')}<textarea name="notas" rows="2" placeholder="${t('Ej.: Cambios y devoluciones en 15 días con este ticket.')}">${esc(f.notas)}</textarea></label>
          <div class="casillas">${casilla('mostrarLogo', f.mostrarLogo, 'Mostrar logo')}${casilla('mostrarSku', f.mostrarSku, 'Mostrar SKU')}${casilla('mostrarMetodo', f.mostrarMetodo, 'Mostrar método de pago')}</div>
          <div class="cabecera"><div class="etiqueta-campo">${t('Vista previa')}</div><button type="button" id="restablecer-factura">${t('Restablecer diseño')}</button></div>
          <div class="marco-factura"><iframe id="vista-factura" title="${t('Vista previa de la factura')}" sandbox></iframe></div>
        </section>` : ''}
        ${cuentaEmail && esAdmin() ? `<section class="panel ancho-completo" id="equipo"><h2>${t('Equipo')}</h2><p class="vacio">${t('Cargando…')}</p></section>` : ''}
      </form>`;
  },
};

// ---------- Comportamiento de cada vista ----------
const alMontar = {
  inventario() {
    const pintar = () => {
      const q = $('#buscar').value.toLowerCase();
      const lista = datos.productos.filter((p) => `${p.nombre} ${p.sku} ${p.categoria}`.toLowerCase().includes(q));
      const neto = (c) => c / (1 + datos.ajustes.iva / 100);
      $('#filas').innerHTML = lista.length ? lista.map((p) => {
        const est = estadoStock(p);
        const margen = p.precio ? Math.round(((neto(p.precio) - p.costo) / neto(p.precio)) * 100) : 0;
        return `<tr>${conImagenes() ? `<td class="c-img">${miniatura(p, 'mini')}</td>` : ''}<td class="mono c-sku">${esc(p.sku)}</td><td class="c-nombre">${esc(p.nombre)}</td><td class="c-cat">${esc(p.categoria)}</td>
          <td class="num c-stock"><span class="chip ${est}">${t('{n} uds', { n: p.stock })}<span class="solo-d"> · ${t(ESTADOS[est])}</span></span></td>
          <td class="num c-costo">${dinero(p.costo)}</td><td class="num c-precio">${dinero(p.precio)}</td><td class="num c-margen">${margen}%</td>
          <td class="num c-accion">${puedoTocarProductos() ? `<button data-editar="${p.id}" aria-label="${t('Editar')} ${esc(p.nombre)}">${t('Editar')}</button>` : ''}</td></tr>`;
      }).join('') : `<tr><td colspan="9" class="vacio">${datos.productos.length ? t('Sin resultados.') : t('Aún no hay productos. Crea el primero con “+ Nuevo producto”.')}</td></tr>`;
    };
    $('#buscar').oninput = pintar;
    if (puedo('crear_productos')) $('#nuevo-producto').onclick = () => formularioProducto();
    $('#filas').onclick = (e) => e.target.dataset.editar && formularioProducto(datos.productos.find((p) => p.id === e.target.dataset.editar));
    if (puedo('exportar')) $('#exportar-productos').onclick = () => exportar(t('Productos'), ['SKU', t('Producto'), t('Categoría'), 'Stock', t('Mínimo'), t('Costo'), t('Precio')],
      datos.productos.map((p) => [p.sku, p.nombre, p.categoria, p.stock, p.minimo, p.costo / 100, p.precio / 100]));
    pintar();
  },

  venta() {
    const pintarRejilla = () => {
      const q = $('#buscar').value.toLowerCase();
      const lista = datos.productos.filter((p) => `${p.nombre} ${p.sku}`.toLowerCase().includes(q)).sort((a, b) => (a.stock <= 0) - (b.stock <= 0));
      $('#rejilla').innerHTML = lista.length ? lista.map((p) => {
        const est = estadoStock(p);
        const enTicket = ticket.find((l) => l.productoId === p.id)?.cantidad;
        return `<button class="producto" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''} ${enTicket ? `data-en-ticket="×${enTicket}"` : ''}>
          ${conImagenes() ? miniatura(p, 'foto') : ''}
          <span class="chip ${est}"><span class="solo-d">${esc(p.sku)} · </span>${t('{n} uds', { n: p.stock })}</span><b>${esc(p.nombre)}</b><span class="precio">${dinero(p.precio)}</span></button>`;
      }).join('') : `<p class="vacio">${datos.productos.length ? t('Sin resultados.') : t('Primero crea productos en Inventario.')}</p>`;
    };
    const pintarTicket = () => {
      const { total, base, cuota } = totalesTicket(ticket, datos.ajustes.iva);
      $('#ticket').classList.toggle('con-lineas', ticket.length > 0);
      if (!ticket.length) $('#ticket').classList.remove('abierta');
      $('#ticket').innerHTML = `
        <button type="button" class="ticket-cabecera" id="ticket-cabecera" aria-expanded="${$('#ticket').classList.contains('abierta')}">
          <h2>${t('Ticket en curso')}</h2><span class="resumen-ticket">${t('{n} artículos', { n: ticket.reduce((s, l) => s + l.cantidad, 0) })} · <b>${dinero(total)}</b></span></button>
        <details class="cliente-det" ${!window.api.movil || pintarTicket.cliente ? 'open' : ''}><summary>${t('+ Cliente')}</summary>
          <label>${t('Cliente')}<input id="cliente" placeholder="${t('Cliente mostrador')}" value="${esc(pintarTicket.cliente || '')}"></label></details>
        ${ticket.length ? ticket.map((l, i) => `<div class="linea"><div>${esc(l.nombre)}<br><small class="mono">${dinero(l.precio)} / ${t('ud')}</small></div>
          <div class="cantidad"><button data-menos="${i}" aria-label="${t('Quitar uno')}">−</button><span class="mono">${l.cantidad}</span><button data-mas="${i}" aria-label="${t('Añadir uno')}">+</button></div>
          <b class="mono">${dinero(l.precio * l.cantidad)}</b></div>`).join('') : `<p class="vacio">${t('Ticket vacío')}</p>`}
        <div class="totales"><div><span>${t('Base imponible')}</span><span>${dinero(base)}</span></div><div><span>${t('IVA')} (${datos.ajustes.iva}%)</span><span>${dinero(cuota)}</span></div></div>
        <div class="total-cobrar"><small>${t('TOTAL A COBRAR')}</small><b>${dinero(total)}</b></div>
        <div class="metodos">${['Efectivo', 'Tarjeta', 'Transferencia'].map((m) => `<button data-metodo="${m}" class="${m === metodoPago ? 'activo' : ''}">${t(m)}</button>`).join('')}</div>
        <button class="primario" id="cobrar" style="width:100%" ${ticket.length && !bloqueadoSinConexion() ? '' : 'disabled'}><span class="solo-d">${t('Cobrar y generar factura')}</span><span class="solo-m">${t('Cobrar {t}', { t: dinero(total) })}</span></button>
        <button id="vaciar" ${ticket.length ? '' : 'disabled'}>${t('Vaciar ticket')}</button>`;
      pintarRejilla(); // muestra en cada producto cuántos lleva el ticket
    };
    $('#buscar').oninput = pintarRejilla;
    $('#rejilla').onclick = (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const p = datos.productos.find((x) => x.id === b.dataset.id);
      const l = ticket.find((x) => x.productoId === p.id);
      if ((l ? l.cantidad : 0) >= p.stock) return avisar(t('No hay más stock de {n}.', { n: p.nombre }), true);
      if (l) l.cantidad++;
      else ticket.push({ productoId: p.id, sku: p.sku, nombre: p.nombre, precio: p.precio, cantidad: 1 });
      pintarTicket();
    };
    $('#ticket').oninput = (e) => e.target.id === 'cliente' && (pintarTicket.cliente = e.target.value);
    $('#ticket').onclick = async (e) => {
      // El toque puede caer en un texto dentro del botón: se actúa sobre el botón.
      const el = e.target.closest('button') || e.target;
      const d = el.dataset;
      if (d.mas) {
        const l = ticket[d.mas];
        const p = datos.productos.find((x) => x.id === l.productoId);
        if (l.cantidad >= p.stock) return avisar(t('No hay más stock de {n}.', { n: p.nombre }), true);
        l.cantidad++;
      } else if (d.menos) {
        if (--ticket[d.menos].cantidad === 0) ticket.splice(d.menos, 1);
      } else if (d.metodo) metodoPago = d.metodo;
      else if (el.id === 'vaciar') ticket = [];
      else if (e.target.closest('#ticket-cabecera')) {
        $('#ticket').classList.toggle('abierta');
      }
      else if (el.id === 'cobrar') {
        try {
          if (bloqueadoSinConexion()) return avisar(t('No tienes permiso para vender sin conexión.'), true);
          const r = registrarVenta(datos, ticket, { metodo: metodoPago, cliente: pintarTicket.cliente, serie: miSerie, vendedor: cuentaEmail || '', sinConexion: sinSincronizar() });
          if (!(await guardar(r.datos))) return;
          ticket = [];
          pintarTicket.cliente = '';
          avisar(t('Venta registrada: {n}', { n: r.venta.numero }));
          pintarRejilla();
          actualizarContador();
        } catch (err) {
          return avisar(err.message, true);
        }
      } else return;
      pintarTicket();
    };
    pintarRejilla();
    pintarTicket();
    pintarAvisoSync();
  },

  resumen() {
    $('#vista').onclick = (e) => {
      const d = e.target.dataset;
      if (d.recontar) recontar(datos.productos.find((p) => p.id === d.recontar));
      if (d.anular) pedirAnulacion(datos.ventas.find((v) => v.id === d.anular));
    };
  },

  ventas() {
    $('#vista').onclick = (e) => {
      if (e.target.dataset.anular) return pedirAnulacion(datos.ventas.find((x) => x.id === e.target.dataset.anular));
      const v = datos.ventas.find((x) => x.id === e.target.dataset.pdf);
      if (v) window.api.facturaPdf({ nombre: v.numero, html: factura(v, datos.ajustes) }).then((r) => r && avisar(t('Factura guardada')));
    };
    if (puedo('exportar')) $('#exportar-ventas').onclick = () => exportar(t('Ventas'), [t('Factura'), t('Fecha'), t('Cliente'), t('Método'), t('Base'), t('IVA'), t('Total')],
      datos.ventas.map((v) => [v.numero, fecha(v.fecha), v.cliente, t(v.metodo), v.base / 100, v.cuota / 100, v.total / 100]));
  },

  gastos() {
    $('#nuevo-gasto').onclick = () => formularioGasto();
    $('#vista').onclick = (e) => e.target.dataset.editar && formularioGasto(datos.gastos.find((g) => g.id === e.target.dataset.editar));
    if (puedo('exportar')) $('#exportar-gastos').onclick = () => exportar(t('Gastos'), [t('Fecha'), t('Concepto'), t('Categoría'), t('Método'), t('Importe')],
      datos.gastos.map((g) => [g.fecha, g.concepto, t(g.categoria), t(g.metodo), g.importe / 100]));
  },

  informes() {
    $('#vista').onclick = (e) => {
      if (!e.target.dataset.periodo) return;
      periodo = e.target.dataset.periodo;
      ir();
    };
    if (puedo('exportar')) $('#exportar-informe').onclick = () => {
      const [desde, hasta] = rangoPeriodo();
      const r = informe(datos, desde, hasta);
      exportar(t('Informe'), [t('Concepto'), t('Importe')], [
        [t('Desde'), desde], [t('Hasta'), hasta], [t('Tickets'), r.tickets], [t('Facturado (IVA incl.)'), r.facturado / 100], [t('IVA repercutido'), r.iva / 100],
        [t('Ingresos (sin IVA)'), r.ingresos / 100], [t('Costo mercancía vendida'), r.cogs / 100], [t('Gastos operativos'), r.gastos / 100], [t('Beneficio neto'), r.beneficio / 100], [t('Margen neto %'), r.margen],
      ], [
        { nombre: t('Productos'), columnas: ['SKU', t('Producto'), t('Unidades'), t('Ingresos'), t('Costo'), t('Beneficio')], filas: r.topProductos.map((p) => [p.sku, p.nombre, p.unidades, p.ingresos / 100, p.costo / 100, (p.ingresos - p.costo) / 100]) },
        { nombre: t('Gastos por categoría'), columnas: [t('Categoría'), t('Importe')], filas: r.porCategoria.map(([c, v]) => [t(c), v / 100]) },
      ]);
    };
  },

  ajustes() {
    const form = $('#form-ajustes');
    let logo = datos.ajustes.logo;
    if (cuentaEmail && esAdmin()) pintarEquipo();
    const leerForm = () => {
      const f = Object.fromEntries(new FormData(form));
      const marcado = (n) => form.elements[n].checked;
      return {
        negocio: f.negocio.trim(), nif: f.nif.trim(), direccion: f.direccion.trim(), moneda: f.moneda.trim(), iva: Number(f.iva),
        imagenes: marcado('imagenes'), logo,
        factura: {
          titulo: f.titulo.trim(), color: f.color, plantilla: f.plantilla, logoPos: f.logoPos,
          mostrarLogo: marcado('mostrarLogo'), mostrarSku: marcado('mostrarSku'), mostrarMetodo: marcado('mostrarMetodo'),
          cabecera: f.cabecera.trim(), pie: f.pie.trim(), notas: f.notas.trim(),
        },
      };
    };
    const previa = () => esAdmin() && ($('#vista-factura').srcdoc = factura(ventaEjemplo(), leerForm()));
    // La factura se dibuja como una hoja A4 (794px de ancho) y se reduce al ancho disponible.
    const marco = $('.marco-factura');
    if (marco) new ResizeObserver(() => marco.style.setProperty('--escala', marco.clientWidth / 794)).observe(marco);
    form.oninput = (e) => e.target.closest('#equipo') || previa();
    if (cuentaEmail) {
      $('#sincronizar-ya').onclick = () => window.api.sincronizarAhora();
      $('#cerrar-sesion').onclick = async () => {
        const n = await window.api.cuenta.pendientes();
        if (!confirm(n ? t('Hay {n} cambios sin subir a la nube. Si cierras sesión se subirán cuando vuelvas a entrar. ¿Cerrar sesión?', { n }) : t('¿Cerrar sesión?'))) return;
        await window.api.cuenta.salir();
        cuentaEmail = null;
        mostrarAcceso();
      };
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      guardarPreferencias({ tema: form.elements.tema.value, idioma: form.elements.idioma.value });
      if (esAdmin()) {
        const nuevos = leerForm();
        if (!Number.isInteger(nuevos.iva) || nuevos.iva < 0 || nuevos.iva > 100) return avisar(t('IVA no válido.'), true);
        if (!(await guardar({ ...datos, ajustes: nuevos }))) return;
      }
      aplicarAjustes();
      ir();
      avisar(t('Ajustes guardados'));
    };
    if (!esAdmin()) return;
    $('#elegir-logo').onclick = () => $('#archivo-logo').click();
    $('#archivo-logo').onchange = async (e) => {
      try {
        logo = await leerImagen(e.target.files[0], 400, 'image/png');
        $('#logo-vista').innerHTML = `<img src="${logo}" alt="${t('Logo')}">`;
        $('#quitar-logo').hidden = false;
        previa();
      } catch (err) {
        avisar(err.message, true);
      }
    };
    $('#quitar-logo').onclick = () => {
      logo = '';
      $('#logo-vista').innerHTML = `<small>${t('Sin logo')}</small>`;
      $('#quitar-logo').hidden = true;
      previa();
    };
    $('#restablecer-factura').onclick = () => {
      const ini = facturaInicial();
      for (const [k, v] of Object.entries(ini)) {
        const campo = form.elements[k];
        if (campo.type === 'checkbox') campo.checked = v;
        else campo.value = v;
      }
      previa();
    };
    previa();
  },
};

// ---------- Utilidades de pantalla ----------
function factura(venta, ajustes) {
  return htmlFactura(venta, ajustes, { t, esc, dinero: (c) => formatoDinero(c, ajustes.moneda, locale()), fecha });
}

function ventaEjemplo() {
  const lineas = [{ sku: 'SKU-0001', nombre: t('Producto de ejemplo'), precio: 4625, cantidad: 2 }, { sku: 'SKU-0002', nombre: t('Otro producto'), precio: 1240, cantidad: 1 }];
  return { numero: `FAC-${new Date().getFullYear()}-0001`, fecha: new Date().toISOString(), cliente: t('Cliente mostrador'), metodo: 'Efectivo', iva: datos.ajustes.iva, lineas, ...totalesTicket(lineas, datos.ajustes.iva) };
}

function rangoPeriodo() {
  const h = new Date();
  if (periodo === 'anterior') return [diaLocal(new Date(h.getFullYear(), h.getMonth() - 1, 1)), diaLocal(new Date(h.getFullYear(), h.getMonth(), 0))];
  if (periodo === 'anio') return [`${h.getFullYear()}-01-01`, `${h.getFullYear()}-12-31`];
  if (periodo === 'todo') return ['0000-01-01', '9999-12-31'];
  return [diaLocal(new Date(h.getFullYear(), h.getMonth(), 1)), diaLocal(new Date(h.getFullYear(), h.getMonth() + 1, 0))];
}

const ICONO_IMAGEN = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/></svg>';
const ICONO_CERRAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function formularioProducto(p) {
  const dlg = $('#dialogo');
  let imagen = p?.imagen || '';
  const m = esc(datos.ajustes.moneda);
  const categorias = [...new Set(datos.productos.map((x) => x.categoria).filter(Boolean))];
  dlg.className = 'hoja';
  dlg.innerHTML = `
    <form method="dialog" id="form-producto" novalidate>
      <header class="hoja-cabecera">
        <div><h2>${p ? t('Editar producto') : t('Nuevo producto')}</h2><small>${p ? esc(p.sku) : t('Completa los datos y guarda')}</small></div>
        <button type="button" class="icono" id="cancelar" aria-label="${t('Cerrar')}">${ICONO_CERRAR}</button>
      </header>
      <div class="hoja-cuerpo">
        <div class="foto-zona" id="foto-zona" tabindex="0" role="button" aria-label="${t('Elegir imagen')}"></div>
        <input type="file" id="archivo-foto" accept="image/*" hidden>

        <fieldset><legend>${t('Información')}</legend>
          <label>${t('Nombre del producto')} *<input name="nombre" required value="${esc(p?.nombre)}" placeholder="${t('Ej.: Lámpara de mesa')}" autocomplete="off"></label>
          <div class="dos">
            <label>${t('SKU / Código')} *<span class="con-boton"><input name="sku" required value="${esc(p?.sku)}" placeholder="SKU-0001" autocomplete="off"><button type="button" id="generar-sku">${t('Generar')}</button></span></label>
            <label>${t('Categoría')}<input name="categoria" list="lista-categorias" value="${esc(p?.categoria)}" placeholder="${t('Ej.: Accesorios')}" autocomplete="off">
              <datalist id="lista-categorias">${categorias.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
          </div>
        </fieldset>

        <fieldset><legend>${t('Precio')}</legend>
          <div class="dos">
            <label>${t('Costo de compra')} *<span class="con-prefijo"><i>${m}</i><input name="costo" inputmode="decimal" required value="${p ? decimal(p.costo) : ''}" placeholder="0,00"></span></label>
            <label>${t('Precio de venta (IVA incl.)')} *<span class="con-prefijo"><i>${m}</i><input name="precio" inputmode="decimal" required value="${p ? decimal(p.precio) : ''}" placeholder="0,00"></span></label>
          </div>
          <div class="calculo" id="calculo" aria-live="polite"></div>
        </fieldset>

        <fieldset><legend>${t('Inventario')}</legend>
          <div class="dos">
            <label>${t('Stock actual')}<input name="stock" type="number" min="0" step="1" required value="${p?.stock ?? 0}"></label>
            <label>${t('Avisar cuando queden')}<input name="minimo" type="number" min="0" step="1" required value="${p?.minimo ?? 0}"></label>
          </div>
          <small class="ayuda">${t('Cuando el stock llegue a ese número verás una alerta en el Resumen.')}</small>
        </fieldset>
        <p class="error" id="error-producto" role="alert"></p>
      </div>
      <footer class="hoja-pie">
        ${p ? `<button type="button" class="peligro" id="borrar">${t('Eliminar')}</button>` : '<span></span>'}
        <div class="acciones"><button type="button" id="cancelar-pie" class="solo-d">${t('Cancelar')}</button><button class="primario">${p ? t('Guardar cambios') : t('Crear producto')}</button></div>
      </footer>
    </form>`;
  const form = $('#form-producto');
  dlg.showModal();
  // Al editar, cada grupo de campos depende de su permiso (crear un producto permite rellenarlo todo).
  const editar = !p || puedo('editar_productos');
  const precios = !p || puedo('editar_precios');
  const stock = !p || puedo('ajustar_stock');
  for (const [campo, permitido] of [['nombre', editar], ['sku', editar], ['categoria', editar], ['minimo', editar], ['costo', precios], ['precio', precios], ['stock', stock]]) {
    form.elements[campo].readOnly = !permitido;
    if (!permitido) form.elements[campo].title = t('No tienes permiso para cambiar este campo.');
  }
  if (!editar) {
    $('#generar-sku').hidden = true;
    $('#foto-zona').classList.add('bloqueada');
    if (p) $('#borrar').hidden = true;
  }
  form.querySelector('input:not([readonly])')?.focus();
  dlg.onclose = () => (dlg.className = '');
  $('#cancelar').onclick = $('#cancelar-pie').onclick = () => dlg.close();

  const pintarFoto = () => {
    $('#foto-zona').innerHTML = imagen
      ? `<img src="${imagen}" alt=""><div class="foto-acciones"><button type="button" id="cambiar-foto">${t('Cambiar')}</button><button type="button" class="peligro" id="quitar-foto">${t('Quitar')}</button></div>`
      : `${ICONO_IMAGEN}<b>${t('Añadir imagen')}</b><small>${t('Arrastra una foto aquí o haz clic')}</small>`;
    $('#foto-zona').classList.toggle('con-foto', !!imagen);
  };
  const cargarFoto = async (archivo) => {
    if (!archivo) return;
    try {
      imagen = await leerImagen(archivo, 480, 'image/jpeg');
      $('#error-producto').textContent = '';
      pintarFoto();
    } catch (err) {
      $('#error-producto').textContent = err.message;
    }
  };
  const zona = $('#foto-zona');
  zona.onclick = (e) => {
    if (!editar) return;
    if (e.target.id === 'quitar-foto') { imagen = ''; return pintarFoto(); }
    $('#archivo-foto').click();
  };
  zona.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && e.target === zona && (e.preventDefault(), $('#archivo-foto').click());
  zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('arrastrando'); };
  zona.ondragleave = () => zona.classList.remove('arrastrando');
  zona.ondrop = (e) => { e.preventDefault(); if (!editar) return; zona.classList.remove('arrastrando'); cargarFoto(e.dataTransfer.files[0]); };
  $('#archivo-foto').onchange = (e) => cargarFoto(e.target.files[0]);
  pintarFoto();

  // Ganancia y margen en vivo mientras se escriben los precios.
  const calcular = () => {
    const costo = aCentimos(form.elements.costo.value);
    const precio = aCentimos(form.elements.precio.value);
    const caja = $('#calculo');
    if (Number.isNaN(costo) || Number.isNaN(precio) || !precio) {
      caja.className = 'calculo';
      caja.innerHTML = `<span>${t('Escribe costo y precio para ver la ganancia.')}</span>`;
      return;
    }
    const neto = Math.round(precio / (1 + datos.ajustes.iva / 100));
    const ganancia = neto - costo;
    caja.className = 'calculo ' + (ganancia < 0 ? 'agotado' : 'ok');
    caja.innerHTML = `<span>${t('Ganancia por unidad')}<b>${dinero(ganancia)}</b></span><span>${t('Margen')}<b>${Math.round((ganancia / neto) * 100)}%</b></span><span>${t('Precio sin IVA')}<b>${dinero(neto)}</b></span>`;
  };
  form.elements.costo.oninput = form.elements.precio.oninput = calcular;
  calcular();

  $('#generar-sku').onclick = () => {
    const usados = new Set(datos.productos.map((x) => x.sku.toLowerCase()));
    let sku;
    do sku = 'SKU-' + String(Math.floor(1000 + Math.random() * 9000)); while (usados.has(sku.toLowerCase()));
    form.elements.sku.value = sku;
  };

  if (p) $('#borrar').onclick = async () => {
    if (!confirm(t('¿Eliminar "{n}"? Las facturas ya emitidas no cambian.', { n: p.nombre }))) return;
    if (await guardar({ ...datos, productos: datos.productos.filter((x) => x.id !== p.id) })) { dlg.close(); ir(); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const nuevo = {
      id: p?.id || 'p' + Date.now().toString(36),
      nombre: f.nombre.trim(), sku: f.sku.trim(), categoria: f.categoria.trim(),
      costo: aCentimos(f.costo), precio: aCentimos(f.precio), stock: Number(f.stock), minimo: Number(f.minimo),
    };
    if (imagen) nuevo.imagen = imagen;
    // Cambiar el stock a mano es un recuento: pasa a ser la base desde ahora. Si no se toca, se conserva la base
    // (y no se valida: con un descuadre puede ser negativo).
    const recuento = !p || nuevo.stock !== p.stock;
    const error = validarProducto(recuento ? nuevo : { ...nuevo, stock: 0 }, datos.productos);
    if (error) return ($('#error-producto').textContent = error);
    nuevo.stockBase = recuento ? nuevo.stock : p.stockBase;
    nuevo.stockFecha = recuento ? new Date().toISOString() : p.stockFecha;
    const productos = p ? datos.productos.map((x) => (x.id === p.id ? nuevo : x)) : [...datos.productos, nuevo];
    // Si se añade una foto con las imágenes desactivadas, se activan para que se vea.
    const ajustes = imagen && !datos.ajustes.imagenes ? { ...datos.ajustes, imagenes: true } : datos.ajustes;
    if (await guardar({ ...datos, productos, ajustes })) { dlg.close(); avisar(t('Producto guardado')); ir(); }
  };
}

function formularioGasto(g) {
  const dlg = $('#dialogo');
  dlg.innerHTML = `
    <form method="dialog" id="form-gasto">
      <h2>${g ? t('Editar gasto') : t('Nuevo gasto')}</h2>
      <label>${t('Concepto')}<input name="concepto" required value="${esc(g?.concepto)}" placeholder="${t('Ej.: Alquiler octubre')}"></label>
      <div class="dos">
        <label>${t('Fecha')}<input name="fecha" type="date" required value="${g?.fecha || diaLocal(new Date())}"></label>
        <label>${t('Importe (IVA incl.)')}<input name="importe" inputmode="decimal" required value="${g ? decimal(g.importe) : ''}" placeholder="0,00"></label>
        <label>${t('Categoría')}<select name="categoria">${opciones(CATEGORIAS_GASTO, g?.categoria)}</select></label>
        <label>${t('Método de pago')}<select name="metodo">${opciones(['Transferencia', 'Tarjeta', 'Efectivo', 'Domiciliación'], g?.metodo)}</select></label>
      </div>
      <p class="error" id="error-gasto"></p>
      <div class="acciones" style="justify-content:space-between">
        ${g ? `<button type="button" class="peligro" id="borrar">${t('Eliminar')}</button>` : '<span></span>'}
        <div class="acciones"><button type="button" id="cancelar">${t('Cancelar')}</button><button class="primario">${t('Guardar')}</button></div>
      </div>
    </form>`;
  dlg.showModal();
  $('#cancelar').onclick = () => dlg.close();
  if (g) $('#borrar').onclick = async () => {
    if (!confirm(t('¿Eliminar el gasto "{n}"?', { n: g.concepto }))) return;
    if (await guardar({ ...datos, gastos: datos.gastos.filter((x) => x.id !== g.id) })) { dlg.close(); ir(); }
  };
  $('#form-gasto').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const nuevo = { id: g?.id || 'g' + Date.now().toString(36), concepto: f.concepto.trim(), fecha: f.fecha, categoria: f.categoria, metodo: f.metodo, importe: aCentimos(f.importe) };
    const error = validarGasto(nuevo);
    if (error) return ($('#error-gasto').textContent = error);
    const gastos = g ? datos.gastos.map((x) => (x.id === g.id ? nuevo : x)) : [...datos.gastos, nuevo];
    if (await guardar({ ...datos, gastos })) { dlg.close(); avisar(t('Gasto guardado')); ir(); }
  };
}

async function exportar(nombre, columnas, filas, otrasHojas = []) {
  try {
    const r = await window.api.exportarExcel({ nombre, hojas: [{ nombre, columnas, filas }, ...otrasHojas] });
    if (r) avisar(t('Excel guardado'));
  } catch (e) {
    avisar(t('No se pudo exportar: {e}', { e: e.message }), true);
  }
}

function actualizarContador() {
  $('#contador-productos').textContent = datos.productos.length;
  const alertas = conStock(datos).productos.filter((p) => estadoStock(p) !== 'ok').length;
  $('#contador-alertas').textContent = alertas;
  $('#contador-alertas').hidden = !alertas;
}

// Tema, idioma, logo y menú lateral según los ajustes guardados.
function aplicarAjustes() {
  const a = datos.ajustes;
  const pref = preferencias();
  document.documentElement.dataset.tema = pref.tema;
  window.api.estiloBarras?.(pref.tema);
  document.documentElement.lang = pref.idioma;
  fijarIdioma(pref.idioma);
  $('#nombre-negocio').textContent = a.negocio.toUpperCase();
  $('#logo').innerHTML = `<img src="${a.logo || 'marca.png'}" alt="">`;
  pintarSync();
  const menu = [['resumen', 'Resumen Diario'], ['inventario', 'Inventario & Catálogo'], ['venta', 'Punto de Venta'], ['ventas', 'Ventas & Facturas'], ['gastos', 'Gastos Operativos'], ['informes', 'Informes & Rentabilidad'], ['ajustes', 'Ajustes']];
  // En el teléfono la barra inferior muestra 4 destinos y "Más" para el resto.
  $('nav').innerHTML = menu.filter(([v]) => vistaPermitida(v)).map(([v, texto]) => `<a href="#${v}" data-vista="${v}" ${MOVIL_PRINCIPAL[v] ? 'data-movil' : ''}>${ICONOS[v] || ''}<span class="largo">${esc(t(texto))}</span><span class="corto">${esc(t(MOVIL_PRINCIPAL[v] || texto))}</span>${v === 'inventario' ? ' <span class="chip" id="contador-productos">0</span><span class="chip agotado" id="contador-alertas" hidden></span>' : ''}</a>`).join('')
    + `<a href="#" class="solo-movil" id="mas" data-movil>${ICONOS.mas}<span class="corto">${t('Más')}</span></a>`;
  $('#mas').onclick = (e) => {
    e.preventDefault();
    abrirMas(menu.filter(([v]) => vistaPermitida(v) && !MOVIL_PRINCIPAL[v]));
  };
}

// Iconos de la barra inferior (trazo de 1.8, mismo estilo que el resto de la app).
const icono = (d) => `<svg class="icono-nav" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONOS = {
  venta: icono('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>'),
  inventario: icono('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  resumen: icono('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  ventas: icono('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>'),
  mas: icono('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  gastos: icono('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>'),
  informes: icono('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
  ajustes: icono('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  exportar: icono('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
};
const MOVIL_PRINCIPAL = { venta: 'Vender', inventario: 'Inventario', resumen: 'Resumen', ventas: 'Ventas' };

function abrirMas(destinos) {
  const dlg = $('#dialogo');
  dlg.className = 'hoja-inferior';
  const actual = location.hash.slice(1);
  const exportar = $('#vista button[id^="exportar-"]');
  dlg.innerHTML = `<nav class="menu-mas" aria-label="${t('Más')}">
      ${destinos.map(([v, texto]) => `<a href="#${v}" class="${v === actual ? 'activo' : ''}">${ICONOS[v] || ''}${esc(t(texto))}</a>`).join('')}
      ${exportar && !exportar.disabled ? `<button type="button" class="enlace-menu" id="mas-exportar">${ICONOS.exportar}${t('Exportar esta vista a Excel')}</button>` : ''}
      <p class="estado-mas">● ${esc(textoSync())}</p>
      <button type="button" id="cerrar-mas">${t('Cerrar')}</button></nav>`;
  dlg.showModal();
  dlg.onclick = (e) => {
    if (e.target.closest('#mas-exportar')) exportar.click();
    if (e.target === dlg || e.target.id === 'cerrar-mas' || e.target.closest('a, #mas-exportar')) dlg.close();
  };
  dlg.addEventListener('close', () => (dlg.className = '', dlg.onclick = null), { once: true });
}

// En pantallas estrechas las tablas se ven como tarjetas: cada celda lleva el nombre de su columna.
function etiquetarTablas(raiz) {
  raiz.querySelectorAll('table').forEach((tabla) => {
    const titulos = [...tabla.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!titulos.length) return;
    tabla.classList.add('tarjetizable');
    tabla.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => titulos[i] && (td.dataset.et = titulos[i])));
  });
}
new MutationObserver(() => etiquetarTablas($('#vista'))).observe($('#vista'), { childList: true, subtree: true });

function ir() {
  const pedida = location.hash.slice(1);
  const vista = vistas[pedida] && vistaPermitida(pedida) ? pedida : 'resumen';
  $('#vista').onclick = null;
  $('#vista').innerHTML = vistas[vista]();
  alMontar[vista]?.();
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('activo', a.dataset.vista === vista));
  actualizarContador();
}

// ---------- Descuadres, anulaciones y avisos de sincronización ----------
const bloqueadoSinConexion = () => sinSincronizar() && ultimoSync.estado !== 'ok' && !puedo('vender_sin_conexion');

function pintarAvisoSync() {
  const caja = $('#aviso-sync');
  if (!caja) return;
  if (!sinSincronizar()) return (caja.innerHTML = '');
  const desde = ultimoSync.hora ? new Date(ultimoSync.hora).toLocaleTimeString(locale(), { timeStyle: 'short' }) : '—';
  caja.innerHTML = `<p class="aviso-sync ${bloqueadoSinConexion() ? 'agotado' : 'bajo'}">${bloqueadoSinConexion()
    ? t('Sin conexión: no tienes permiso para vender hasta que vuelva la conexión.')
    : t('Sin sincronizar desde las {h}: el stock puede no estar al día si se vende en otros equipos.', { h: desde })}</p>`;
}

// Pequeño formulario en el diálogo (Electron no tiene prompt()).
function preguntar({ titulo, texto, campo, tipo = 'text', valor = '', boton }) {
  return new Promise((ok) => {
    const dlg = $('#dialogo');
    dlg.className = '';
    dlg.innerHTML = `<form method="dialog" id="form-pregunta"><h2>${titulo}</h2><p class="sub">${texto}</p>
      <label>${campo}<input name="valor" type="${tipo}" ${tipo === 'number' ? 'min="0" step="1"' : ''} required value="${esc(valor)}"></label>
      <div class="acciones" style="justify-content:flex-end"><button type="button" id="pregunta-cancelar">${t('Cancelar')}</button><button class="primario">${boton}</button></div></form>`;
    dlg.showModal();
    dlg.querySelector('input').select();
    $('#pregunta-cancelar').onclick = () => { dlg.close(); ok(null); };
    $('#form-pregunta').onsubmit = (e) => { e.preventDefault(); dlg.close(); ok(e.target.elements.valor.value); };
  });
}

async function recontar(p) {
  const v = await preguntar({ titulo: t('Recontar stock'), texto: t('Cuenta las unidades de "{n}" que hay físicamente. Ese número pasa a ser el stock desde ahora.', { n: p.nombre }), campo: t('Unidades contadas'), tipo: 'number', valor: Math.max(0, p.stock), boton: t('Guardar recuento') });
  if (v === null) return;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return avisar(t('El stock debe ser un número entero, 0 o mayor.'), true);
  const productos = datos.productos.map((x) => (x.id === p.id ? { ...x, stockBase: n, stockFecha: new Date().toISOString() } : x));
  if (await guardar({ ...datos, productos })) { avisar(t('Stock actualizado')); ir(); }
}

async function pedirAnulacion(v) {
  const motivo = await preguntar({ titulo: t('Anular venta {n}', { n: v.numero }), texto: t('La venta no se borra: queda marcada como anulada, devuelve el stock y deja de contar en los informes.'), campo: t('Motivo'), valor: t('Sin stock al sincronizar'), boton: t('Anular venta') });
  if (motivo === null) return;
  try {
    if (await guardar(anularVenta(datos, v, { motivo, por: cuentaEmail || '' }))) { avisar(t('Venta anulada')); ir(); }
  } catch (e) {
    avisar(e.message, true);
  }
}

// ---------- Equipo (solo admin; necesita conexión) ----------
async function pintarEquipo() {
  const caja = $('#equipo');
  const r = await window.api.equipo.listar();
  if (!caja.isConnected) return;
  if (r.error) {
    caja.innerHTML = `<h2>${t('Equipo')}</h2><p class="error">${t('No se pudo cargar el equipo. Revisa la conexión.')}</p><small class="ayuda">${esc(r.error)}</small>`;
    return;
  }
  const roles = (actual) => ['admin', 'trabajador'].map((v) => `<option value="${v}" ${v === actual ? 'selected' : ''}>${t(v === 'admin' ? 'Administrador' : 'Trabajador')}</option>`).join('');
  caja.innerHTML = `
    <h2>${t('Equipo')}</h2>
    <small class="ayuda">${t('Un trabajador vende y ve inventario y ventas. Con "Permisos" le das más acciones; el equipo y los ajustes de la empresa son solo de los administradores.')}</small>
    <table class="tabla-equipo"><tbody>
      ${r.miembros.map((m) => `<tr><td>${esc(m.email)}${m.user_id === r.yo ? ` <small class="chip">${t('Tú')}</small>` : ''}${m.serie ? ` <small class="chip">${t('Serie')} ${esc(m.serie)}</small>` : ''}</td>
        <td><select data-rol="${m.user_id}" aria-label="${t('Rol de {n}', { n: m.email })}">${roles(m.rol)}</select></td>
        <td class="num"><div class="acciones fin">${m.rol !== 'admin' ? `<button type="button" data-ver-permisos="${m.user_id}" aria-expanded="false">${t('Permisos')}</button>` : ''}<button type="button" class="peligro" data-quitar="${m.user_id}" data-email="${esc(m.email)}">${t('Quitar')}</button></div></td></tr>
        ${m.rol !== 'admin' ? `<tr class="fila-permisos" id="permisos-${m.user_id}" hidden><td colspan="3"><div class="permisos">${PERMISOS.map(([k, texto]) => `<label class="casilla"><input type="checkbox" data-permiso="${k}" data-usuario="${m.user_id}" ${(m.permisos || []).includes(k) ? 'checked' : ''}> ${t(texto)}</label>`).join('')}</div></td></tr>` : `<tr><td colspan="3"><small class="ayuda">${t('Los administradores tienen todos los permisos.')}</small></td></tr>`}`).join('')}
      ${r.invitaciones.map((i) => `<tr class="pendiente"><td>${esc(i.email)} <small class="chip bajo">${t('Invitación pendiente')}</small></td><td>${t(i.rol === 'admin' ? 'Administrador' : 'Trabajador')}</td>
        <td class="num"><button type="button" data-cancelar="${esc(i.email)}">${t('Cancelar')}</button></td></tr>`).join('')}
    </tbody></table>
    <div class="invitar">
      <input type="email" id="invitar-email" placeholder="${t('correo@empresa.com')}" aria-label="${t('Correo de la persona')}">
      <select id="invitar-rol" aria-label="${t('Rol')}">${roles('trabajador')}</select>
      <button type="button" class="primario" id="invitar">${t('Invitar')}</button>
    </div>
    <small class="ayuda">${t('La persona debe crear su cuenta con ese mismo correo y confirmarlo. Al entrar se une al equipo.')}</small>
    <p class="error" id="error-equipo" role="alert"></p>`;
  const resultado = async (promesa, ok, abierto) => {
    const res = await promesa;
    if (res.error) return ($('#error-equipo').textContent = t(res.error));
    avisar(ok);
    await pintarEquipo();
    if (abierto) $(`#permisos-${abierto}`).hidden = false; // mantener abierta la lista que se estaba editando
  };
  caja.onchange = (e) => {
    const d = e.target.dataset;
    if (d.rol) resultado(window.api.equipo.cambiar({ userId: d.rol, rol: e.target.value }), t('Rol actualizado'));
    if (d.permiso) {
      const permisos = [...caja.querySelectorAll(`[data-usuario="${d.usuario}"]:checked`)].map((c) => c.dataset.permiso);
      resultado(window.api.equipo.permisos({ userId: d.usuario, permisos }), t('Permisos actualizados'), d.usuario);
    }
  };
  caja.onclick = (e) => {
    const d = e.target.dataset;
    if (d.quitar && confirm(t('¿Quitar a {n} del equipo? Dejará de ver los datos de la empresa.', { n: d.email }))) resultado(window.api.equipo.cambiar({ userId: d.quitar, rol: null }), t('Persona quitada'));
    if (d.cancelar) resultado(window.api.equipo.cancelar(d.cancelar), t('Invitación cancelada'));
    if (d.verPermisos) {
      const fila = $(`#permisos-${d.verPermisos}`);
      fila.hidden = !fila.hidden;
      e.target.setAttribute('aria-expanded', String(!fila.hidden));
    }
    if (e.target.id === 'invitar') {
      const email = $('#invitar-email').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ($('#error-equipo').textContent = t('Correo no válido.'));
      resultado(window.api.equipo.invitar({ email, rol: $('#invitar-rol').value }), t('Invitación creada'));
    }
  };
}

// ---------- Cuenta y sincronización ----------
function usarCuenta(c) {
  cuentaEmail = c.email;
  miRol = c.rol || 'admin';
  miSerie = c.serie || '';
  misPermisos = c.permisos || [];
}

function textoSync() {
  const s = ultimoSync;
  const pend = s.pendientes ? ' · ' + t('{n} sin subir', { n: s.pendientes }) : '';
  if (!cuentaEmail) return t('Guardado local');
  if (s.estado === 'sincronizando') return t('Sincronizando…');
  if (s.estado === 'ok') return t('Sincronizado {h}', { h: new Date(s.hora).toLocaleTimeString(locale(), { timeStyle: 'short' }) }) + pend;
  if (s.estado === 'sin-conexion') return t('Sin conexión') + pend;
  if (s.estado === 'error') return t('Error al sincronizar') + pend;
  return t('Conectado');
}

function pintarSync() {
  const el = $('#estado-local');
  el.textContent = '● ' + textoSync();
  el.className = 'estado-local ' + ({ 'sin-conexion': 'bajo', error: 'agotado' }[ultimoSync.estado] || '');
  el.title = ultimoSync.mensaje || '';
  const detalle = $('#sync-detalle');
  if (detalle) detalle.textContent = textoSync();
  pintarAvisoSync();
  const cobrar = $('#cobrar');
  if (cobrar && ticket.length) cobrar.disabled = bloqueadoSinConexion();
}

function mostrarAcceso(aviso = '') {
  document.body.classList.add('sin-sesion');
  const caja = $('#acceso');
  caja.hidden = false;
  caja.innerHTML = `
    <form class="acceso-caja" id="form-acceso">
      <div class="marca"><span class="logo con-imagen"><img src="marca.png" alt=""></span><div><b>Guarmo</b><small>${t('Tu empresa, en orden.')}</small></div></div>
      <h1 id="acceso-titulo">${t('Iniciar sesión')}</h1>
      <p class="sub">${t('Tus datos se guardan en este equipo y se sincronizan con la nube.')}</p>
      <label>${t('Correo')}<input name="email" type="email" required autocomplete="email"></label>
      <label>${t('Contraseña')}<input name="clave" type="password" required minlength="6" autocomplete="current-password"></label>
      <p class="olvido"><button type="button" class="enlace" id="olvide">${t('¿Olvidaste tu contraseña?')}</button></p>
      <p class="error" id="error-acceso" role="alert">${esc(aviso)}</p>
      <button class="primario" id="boton-acceso">${t('Entrar')}</button>
      <p class="cambiar-modo"><span id="pregunta-modo">${t('¿No tienes cuenta?')}</span> <button type="button" class="enlace" id="cambiar-modo">${t('Crear cuenta')}</button></p>
    </form>`;
  let registrando = false;
  const form = $('#form-acceso');
  form.elements.email.focus();
  $('#olvide').onclick = () => mostrarRestablecer(form.elements.email.value.trim());
  $('#cambiar-modo').onclick = () => {
    registrando = !registrando;
    $('#olvide').hidden = registrando;
    $('#acceso-titulo').textContent = t(registrando ? 'Crear cuenta' : 'Iniciar sesión');
    $('#boton-acceso').textContent = t(registrando ? 'Crear cuenta' : 'Entrar');
    $('#pregunta-modo').textContent = t(registrando ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?');
    $('#cambiar-modo').textContent = t(registrando ? 'Iniciar sesión' : 'Crear cuenta');
    form.elements.clave.autocomplete = registrando ? 'new-password' : 'current-password';
    $('#error-acceso').textContent = '';
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const boton = $('#boton-acceso');
    boton.disabled = true;
    const args = { email: form.elements.email.value.trim(), clave: form.elements.clave.value };
    const r = await (registrando ? window.api.cuenta.registrar(args) : window.api.cuenta.entrar(args));
    boton.disabled = false;
    if (r.error) return ($('#error-acceso').textContent = t(r.error));
    if (r.confirmar) {
      $('#cambiar-modo').click();
      $('#error-acceso').textContent = t('Te enviamos un correo para confirmar la cuenta. Confírmala y luego entra aquí.');
      return;
    }
    usarCuenta(await window.api.cuenta.estado());
    caja.hidden = true;
    document.body.classList.remove('sin-sesion');
    await cargarDatos();
    aplicarAjustes();
    ir();
  };
}

// Los datos llegan sin stock: se calcula aquí (ver conStock).
function recibir(r) {
  rev = r.rev;
  datos = conStock(normalizar(r.datos));
}

// Restablecer contraseña: 1) pedir código por correo; 2) código + contraseña nueva.
function mostrarRestablecer(email = '') {
  const caja = $('#acceso');
  const volver = async (aviso = '') => {
    await window.api.cuenta.cancelarRestablecer();
    mostrarAcceso(aviso);
  };
  caja.innerHTML = `
    <form class="acceso-caja" id="form-pedir" novalidate>
      <h1>${t('Restablecer contraseña')}</h1>
      <p class="sub">${t('Te enviaremos un código a tu correo para crear una contraseña nueva.')}</p>
      <label>${t('Correo')}<input name="email" type="email" required autocomplete="email" value="${esc(email)}"></label>
      <p class="error" id="error-pedir" role="alert"></p>
      <button class="primario" id="boton-pedir">${t('Enviar código')}</button>
      <p class="cambiar-modo"><button type="button" class="enlace" id="volver">${t('Volver a iniciar sesión')}</button></p>
    </form>`;
  const pedir = $('#form-pedir');
  pedir.elements.email.focus();
  $('#volver').onclick = () => volver();
  pedir.onsubmit = async (e) => {
    e.preventDefault();
    const correo = pedir.elements.email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return ($('#error-pedir').textContent = t('Correo no válido.'));
    $('#boton-pedir').disabled = true;
    const r = await window.api.cuenta.pedirCodigo({ email: correo });
    $('#boton-pedir').disabled = false;
    if (r.error) return ($('#error-pedir').textContent = t(r.error));
    pasoCodigo(correo);
  };

  function pasoCodigo(correo) {
    caja.innerHTML = `
      <form class="acceso-caja" id="form-codigo" novalidate>
        <h1>${t('Revisa tu correo')}</h1>
        <p class="sub">${t('Si existe una cuenta con {c}, te enviamos un código. Escríbelo y elige tu contraseña nueva.', { c: esc(correo) })}</p>
        <label>${t('Código (o pega aquí el enlace del correo)')}<input name="codigo" autocomplete="one-time-code" required></label>
        <label>${t('Contraseña nueva')}<input name="clave" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>${t('Repite la contraseña')}<input name="clave2" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="error" id="error-codigo" role="alert"></p>
        <button class="primario" id="boton-codigo">${t('Guardar contraseña y entrar')}</button>
        <p class="cambiar-modo"><button type="button" class="enlace" id="reenviar">${t('Pedir otro código')}</button> · <button type="button" class="enlace" id="volver">${t('Cancelar')}</button></p>
      </form>`;
    const f = $('#form-codigo');
    f.elements.codigo.focus();
    $('#volver').onclick = () => volver();
    $('#reenviar').onclick = async () => {
      await window.api.cuenta.cancelarRestablecer();
      mostrarRestablecer(correo);
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const codigo = f.elements.codigo.value.trim();
      const esEnlace = /^https?:\/\//i.test(codigo);
      const clave = f.elements.clave.value;
      const error = !esEnlace && !/^\d{6,10}$/.test(codigo.replace(/\s/g, '')) && !f.elements.codigo.readOnly ? t('Escribe el código que recibiste por correo.')
        : clave.length < 8 ? t('La contraseña debe tener al menos 8 caracteres.')
        : clave !== f.elements.clave2.value ? t('Las contraseñas no coinciden.') : '';
      if (error) return ($('#error-codigo').textContent = error);
      $('#boton-codigo').disabled = true;
      const r = await window.api.cuenta.restablecer({ email: correo, codigo: esEnlace ? codigo : codigo.replace(/\s/g, ''), clave });
      $('#boton-codigo').disabled = false;
      if (r.error) {
        $('#error-codigo').textContent = t(r.error);
        // El código ya valió: solo hay que elegir otra contraseña.
        if (r.reintentar) f.elements.codigo.readOnly = true;
        return;
      }
      usarCuenta(await window.api.cuenta.estado());
      caja.hidden = true;
      document.body.classList.remove('sin-sesion');
      await cargarDatos();
      aplicarAjustes();
      ir();
      avisar(r.avisoOtros ? t('Contraseña cambiada. No se pudo cerrar la sesión en tus otros equipos.') : t('Contraseña cambiada. Se cerró la sesión en tus otros equipos.'), r.avisoOtros);
    };
  }
}

async function cargarDatos() {
  recibir(await window.api.leerDatos());
}

// Tema e idioma son de cada equipo, no de la empresa.
function preferencias() {
  try {
    return { tema: 'oscuro', idioma: 'es', ...JSON.parse(localStorage.getItem('preferencias') || '{}') };
  } catch {
    return { tema: 'oscuro', idioma: 'es' };
  }
}

function guardarPreferencias(p) {
  try {
    localStorage.setItem('preferencias', JSON.stringify(p));
  } catch {
    /* sin almacenamiento: se usa solo en esta sesión */
  }
}

(async () => {
  fijarTraductor(t);
  await cargarDatos();
  aplicarAjustes();
  window.addEventListener('hashchange', ir);
  window.api.alCambiarSync((s) => {
    ultimoSync = { ...s, hora: s.hora || ultimoSync.hora }; // se conserva la hora de la última sincronización buena
    if (datos) pintarSync();
  });
  // Cambios que llegan de otro equipo: se refresca la pantalla, salvo con un formulario abierto (se hace al cerrarlo).
  window.api.alLlegarDatos((r) => {
    recibir(r);
    aplicarAjustes();
    if ($('#dialogo').open) $('#dialogo').addEventListener('close', ir, { once: true });
    else if (!$('#acceso').hidden) return;
    else ir();
  });
  window.api.alCambiarCuenta((c) => {
    usarCuenta(c);
    aplicarAjustes();
    if (!$('#dialogo').open && $('#acceso').hidden) ir();
  });
  const cuenta = await window.api.cuenta.estado();
  usarCuenta(cuenta);
  aplicarAjustes();
  if (cuenta.configurado && !cuenta.email) return mostrarAcceso();
  ir();
})();
