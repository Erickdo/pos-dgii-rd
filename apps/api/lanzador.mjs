#!/usr/bin/env node
/**
 * Lanzador del POS (Node puro, sin dependencias: debe funcionar aunque node_modules esté a medio actualizar).
 *
 *  - Arranca el servidor y lo reinicia si se cae.
 *  - Si el servidor sale con código 75, hay una actualización preparada en .datos/actualizacion/pendiente:
 *      1. Respalda la base de datos (pg_dump) y el código actual en .respaldos/
 *      2. Copia la versión nueva encima (sin tocar .datos, node_modules ni respaldos)
 *      3. Reinstala dependencias si cambiaron y recompila la pantalla
 *      4. Arranca la versión nueva y verifica que responda
 *      5. Si no responde en 90 s, restaura el código anterior y vuelve a arrancar
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(API, '..', '..');
const WEB = join(RAIZ, 'apps', 'web');
const DATOS = join(API, '.datos');
const DIR_ACT = join(DATOS, 'actualizacion');
const PENDIENTE = join(DIR_ACT, 'pendiente');
const RESULTADO = join(DIR_ACT, 'resultado.json');
const RESPALDOS = join(RAIZ, '.respaldos');
const PUERTO = Number(process.env.PORT ?? 3000);
const WIN = process.platform === 'win32';
const CODIGO_ACTUALIZAR = 75;
const EXCLUIR = new Set(['node_modules', 'dist', '.datos', '.respaldos', '.git']);

const log = (...m) => console.log(`[${new Date().toLocaleTimeString('es-DO')}] [lanzador]`, ...m);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const leerJSON = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const versionDe = (dir) => leerJSON(join(dir, 'version.json'), { version: '0.0.0' }).version;
const hashArchivo = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : '');

function npm(args, cwd) {
  log(`npm ${args.join(' ')}  (${cwd})`);
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', args, { cwd, stdio: 'inherit', shell: WIN });
  if (r.status !== 0) throw new Error(`npm ${args[0]} falló en ${cwd}`);
}

/** Copia recursiva omitiendo carpetas que nunca se tocan. */
function copiar(origen, destino) {
  for (const nombre of readdirSync(origen)) {
    if (EXCLUIR.has(nombre)) continue;
    const o = join(origen, nombre), d = join(destino, nombre);
    if (statSync(o).isDirectory()) { mkdirSync(d, { recursive: true }); copiar(o, d); }
    else cpSync(o, d, { force: true });
  }
}

function respaldarBD(destino) {
  const pgBin = process.env.PG_BIN ?? (WIN ? 'C:\\Program Files\\PostgreSQL\\17\\bin' : '');
  const pgDump = pgBin ? join(pgBin, WIN ? 'pg_dump.exe' : 'pg_dump') : 'pg_dump';
  const url = process.env.DATABASE_URL;
  if (!url) return log('Sin DATABASE_URL: se omite el respaldo de la base');
  const r = spawnSync(pgDump, ['--dbname', url, '-F', 'c', '-f', destino], { stdio: 'inherit', shell: false });
  if (r.status !== 0) throw new Error('No se pudo respaldar la base de datos (pg_dump). Actualización cancelada.');
  log(`Base de datos respaldada en ${destino}`);
}

/** Reinstala solo lo que cambió. Devuelve qué se reinstaló (para revertir igual de rápido). */
function instalarDependencias(lockAntes) {
  const hecho = { api: false, web: false };
  if (hashArchivo(join(API, 'package-lock.json')) !== lockAntes.api || !existsSync(join(API, 'node_modules'))) { npm(['install', '--no-audit', '--no-fund'], API); hecho.api = true; }
  if (hashArchivo(join(WEB, 'package-lock.json')) !== lockAntes.web || !existsSync(join(WEB, 'node_modules'))) { npm(['install', '--no-audit', '--no-fund'], WEB); hecho.web = true; }
  npm(['run', 'build'], WEB);
  return hecho;
}

// ---------------------------------------------------------------- servidor
let hijo = null;
function arrancar() {
  const tsx = join(API, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  hijo = spawn(process.execPath, [tsx, 'src/server.ts'], { cwd: API, stdio: 'inherit', env: { ...process.env, POS_LANZADOR: '1' } });
  return new Promise((res) => hijo.on('exit', (code) => res(code)));
}

async function responde(timeoutMs) {
  const fin = Date.now() + timeoutMs;
  while (Date.now() < fin) {
    try { const r = await fetch(`http://localhost:${PUERTO}/api/version`); if (r.ok) return true; } catch { /* aún no */ }
    await espera(1500);
  }
  return false;
}

// ---------------------------------------------------------------- actualización
async function aplicarActualizacion() {
  const desde = versionDe(RAIZ);
  const hacia = versionDe(PENDIENTE);
  const marca = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dirRespaldo = join(RESPALDOS, `${desde}_${marca}`);
  const lockAntes = { api: hashArchivo(join(API, 'package-lock.json')), web: hashArchivo(join(WEB, 'package-lock.json')) };
  const resultado = { desde, hacia, inicio: new Date().toISOString(), ok: false, revertido: false, mensaje: '', respaldo: dirRespaldo };
  log(`Actualizando ${desde} → ${hacia}`);

  let reinstalado = { api: false, web: false };
  try {
    mkdirSync(join(dirRespaldo, 'codigo'), { recursive: true });
    respaldarBD(join(dirRespaldo, 'base-de-datos.dump'));
    copiar(RAIZ, join(dirRespaldo, 'codigo'));
    log('Código actual respaldado');

    copiar(PENDIENTE, RAIZ);
    log('Archivos nuevos copiados');
    reinstalado = instalarDependencias(lockAntes);

    const proceso = arrancar();
    // Falla rápido: si el proceso nuevo se cae antes de responder, no esperamos los 90 s
    const ok = await Promise.race([responde(90_000), proceso.then(() => false)]);
    if (!ok) throw new Error('La versión nueva no respondió');
    resultado.ok = true;
    resultado.mensaje = `Actualizado a la versión ${hacia}`;
    log(resultado.mensaje);
    rmSync(PENDIENTE, { recursive: true, force: true });
    writeFileSync(RESULTADO, JSON.stringify({ ...resultado, fin: new Date().toISOString() }, null, 2));
    return proceso; // seguimos vigilando el proceso nuevo
  } catch (e) {
    resultado.mensaje = e.message;
    log(`ERROR: ${e.message}`);
    try { hijo?.kill(); } catch { /* */ }
    await espera(1500);
    if (existsSync(join(dirRespaldo, 'codigo', 'version.json'))) {
      log('Revirtiendo a la versión anterior…');
      copiar(join(dirRespaldo, 'codigo'), RAIZ);
      try {
        if (reinstalado.api) npm(['install', '--no-audit', '--no-fund'], API);
        if (reinstalado.web) npm(['install', '--no-audit', '--no-fund'], WEB);
        npm(['run', 'build'], WEB);
      } catch (e2) { log(`Al revertir: ${e2.message}`); }
      resultado.revertido = true;
    }
    rmSync(PENDIENTE, { recursive: true, force: true });
    writeFileSync(RESULTADO, JSON.stringify({ ...resultado, fin: new Date().toISOString() }, null, 2));
    return arrancar();
  }
}

// ---------------------------------------------------------------- bucle principal
async function principal() {
  log(`POS versión ${versionDe(RAIZ)} · puerto ${PUERTO}`);
  let salida = arrancar();
  let fallosSeguidos = 0;
  for (;;) {
    const inicio = Date.now();
    const codigo = await salida;
    if (codigo === CODIGO_ACTUALIZAR && existsSync(join(PENDIENTE, 'version.json'))) {
      salida = await aplicarActualizacion();
      fallosSeguidos = 0;
      continue;
    }
    fallosSeguidos = Date.now() - inicio < 15_000 ? fallosSeguidos + 1 : 0;
    const pausa = Math.min(30_000, 2_000 * 2 ** fallosSeguidos);
    log(`El servidor terminó (código ${codigo}). Reiniciando en ${pausa / 1000} s…`);
    await espera(pausa);
    salida = arrancar();
  }
}

process.on('SIGINT', () => { hijo?.kill(); process.exit(0); });
process.on('SIGTERM', () => { hijo?.kill(); process.exit(0); });
principal();
