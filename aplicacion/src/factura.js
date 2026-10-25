// Genera el HTML de una factura con el diseño elegido en Ajustes (plantilla, colores, logo y textos).
function htmlFactura(v, ajustes, { t, esc, dinero, fecha }) {
  const f = ajustes.factura;
  const logo = f.mostrarLogo && ajustes.logo ? `<img class="logo" src="${ajustes.logo}" alt="">` : '';
  const negocio = `<div class="negocio">${logo}<div><div class="nombre">${esc(ajustes.negocio)}</div>
    ${ajustes.nif ? `<div>${esc(ajustes.nif)}</div>` : ''}${ajustes.direccion ? `<div>${esc(ajustes.direccion)}</div>` : ''}${f.cabecera ? `<div>${esc(f.cabecera)}</div>` : ''}</div></div>`;
  const doc = `<div class="doc"><div class="titulo">${esc(f.titulo || t('FACTURA'))}</div><div><b>${v.numero}</b></div><div>${fecha(v.fecha)}</div></div>`;
  const filas = v.lineas.map((l) => `<tr><td>${esc(l.nombre)}${f.mostrarSku ? ` <small>(${esc(l.sku)})</small>` : ''}</td>
    <td class="n">${l.cantidad}</td><td class="n">${dinero(l.precio)}</td><td class="n">${dinero(l.precio * l.cantidad)}</td></tr>`).join('');
  const c = /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#b45309';
  const estilos = {
    clasica: `.cab{border-bottom:3px solid ${c};padding-bottom:16px} .nombre,.titulo{color:${c}} th{border-bottom:2px solid ${c}}`,
    moderna: `.cab{background:${c};color:#fff;margin:-40px -40px 0;padding:32px 40px} .cab small{color:#fff} th{background:${c}22;color:${c}} tbody tr:nth-child(even){background:#f6f6f6} .total td{background:${c};color:#fff}`,
    minimal: `body{font-family:Georgia,serif} .cab{border-bottom:1px solid #ccc;padding-bottom:16px} .titulo{letter-spacing:4px;font-weight:normal} th{font-weight:normal;color:#888;text-transform:uppercase;font-size:11px;letter-spacing:1px} .total td{border-top:2px solid #111} .nombre{color:${c}}`,
  }[f.plantilla] || '';
  const orden = { izquierda: 'row', derecha: 'row-reverse', centro: 'column' }[f.logoPos] || 'row';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:13px Arial,sans-serif;color:#111;margin:40px} table{width:100%;border-collapse:collapse;margin-top:24px}
    th,td{padding:8px;text-align:left;border-bottom:1px solid #e5e5e5} .n{text-align:right} .tot td{border:0}
    .total td{font-size:17px;font-weight:bold} .cab{display:flex;flex-direction:${orden};justify-content:space-between;align-items:${orden === 'column' ? 'center' : 'flex-start'};gap:20px;text-align:${orden === 'column' ? 'center' : 'left'}}
    .negocio{display:flex;flex-direction:${orden === 'column' ? 'column' : 'row'};gap:14px;align-items:center} .logo{max-width:140px;max-height:80px;object-fit:contain}
    .nombre{font-size:20px;font-weight:bold} .titulo{font-size:18px;font-weight:bold} .doc{text-align:${orden === 'row' ? 'right' : orden === 'column' ? 'center' : 'left'}}
    .info{margin-top:18px} .notas{margin-top:28px;font-size:12px;color:#555;white-space:pre-wrap} .pie{margin-top:28px;text-align:center;color:#666}
    ${estilos}</style></head><body>
    <div class="cab">${negocio}${doc}</div>
    <p class="info">${t('Cliente')}: <b>${esc(v.cliente)}</b>${f.mostrarMetodo ? ` · ${t('Pago')}: ${esc(t(v.metodo))}` : ''}</p>
    <table><thead><tr><th>${t('Producto')}</th><th class="n">${t('Cant.')}</th><th class="n">${t('Precio')}</th><th class="n">${t('Importe')}</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr class="tot"><td colspan="3" class="n">${t('Base imponible')}</td><td class="n">${dinero(v.base)}</td></tr>
    <tr class="tot"><td colspan="3" class="n">${t('IVA')} ${v.iva}%</td><td class="n">${dinero(v.cuota)}</td></tr>
    <tr class="tot total"><td colspan="3" class="n">${t('TOTAL')}</td><td class="n">${dinero(v.total)}</td></tr></tfoot></table>
    ${f.notas ? `<div class="notas">${esc(f.notas)}</div>` : ''}${f.pie ? `<div class="pie">${esc(f.pie)}</div>` : ''}
    </body></html>`;
}

if (typeof module !== 'undefined') module.exports = { htmlFactura };
