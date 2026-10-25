// Copia la interfaz de escritorio (../src) a www/ para Capacitor, con las librerías en versión navegador.
// Es todo el "build": no hay bundler.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const www = path.join(__dirname, 'www');
const mods = path.join(raiz, 'node_modules');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'fuentes'), { recursive: true });

for (const f of fs.readdirSync(path.join(raiz, 'src'))) {
  if (!f.endsWith('.test.js')) fs.copyFileSync(path.join(raiz, 'src', f), path.join(www, f));
}
const copiar = (desde, a) => fs.copyFileSync(path.join(raiz, desde), path.join(www, a));
copiar('nucleo.js', 'nucleo.js');
copiar('sincronizacion.js', 'sincronizacion.js');
copiar('build/icon.png', 'icon.png');
copiar('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'supabase.js');
copiar('node_modules/exceljs/dist/exceljs.min.js', 'exceljs.min.js');
fs.copyFileSync(path.join(__dirname, 'plataforma-movil.js'), path.join(www, 'plataforma-movil.js'));

// Fuentes: solo los pesos que usa la app y sus archivos woff2.
for (const [familia, prefijo] of [['hanken-grotesk', 'hanken-grotesk'], ['jetbrains-mono', 'jetbrains-mono']]) {
  for (const peso of ['400', '600']) {
    const css = fs.readFileSync(path.join(mods, '@fontsource', familia, `${peso}.css`), 'utf8');
    fs.writeFileSync(path.join(www, 'fuentes', `${prefijo}-${peso}.css`), css.replace(/url\(\.\/files\//g, 'url(./'));
    for (const archivo of fs.readdirSync(path.join(mods, '@fontsource', familia, 'files'))) {
      if (archivo.includes(`-${peso}-normal`) && archivo.endsWith('.woff2')) {
        fs.copyFileSync(path.join(mods, '@fontsource', familia, 'files', archivo), path.join(www, 'fuentes', archivo));
      }
    }
  }
}

// config.json: el mismo que escritorio. La CSP solo permite conectar con ese proyecto de Supabase.
let config = null;
try {
  config = JSON.parse(fs.readFileSync(path.join(raiz, 'config.json'), 'utf8'));
  fs.writeFileSync(path.join(www, 'config.json'), JSON.stringify(config));
} catch {
  console.warn('Sin config.json: la app móvil funcionará solo en local.');
}
const origen = config ? new URL(config.supabaseUrl) : null;
const conectar = origen ? ` ${origen.origin} ${origen.origin.replace(/^http/, 'ws')}` : '';

let html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
html = html
  .replace(/\.\.\/node_modules\/@fontsource\/([\w-]+)\/(\d+)\.css/g, 'fuentes/$1-$2.css')
  .replace("default-src 'self';", `default-src 'self'; connect-src 'self'${conectar};`)
  .replace('<script src="app.js"></script>', ['sincronizacion.js', 'nucleo.js', 'supabase.js', 'exceljs.min.js', 'plataforma-movil.js', 'app.js'].map((s) => `<script src="${s}"></script>`).join('\n  '));
if (!html.includes('plataforma-movil.js')) throw new Error('No se pudo insertar plataforma-movil.js en index.html');
fs.writeFileSync(path.join(www, 'index.html'), html);
console.log('www/ listo');
