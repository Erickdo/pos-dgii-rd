import express from 'express';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { firmarToken, requiereRol, requiereSesion, verificarSecreto } from './auth.js';
import { GestorCertificado } from './modules/fiscal/certificado.js';
import { ClienteDGII } from './modules/fiscal/dgii.client.js';
import { estadoWorker, procesarLote } from './modules/fiscal/transmision.worker.js';
import { ventasRouter } from './modules/ventas/ventas.routes.js';
import { cajasRouter } from './modules/cajas/cajas.routes.js';
import { catalogoRouter } from './modules/catalogo/catalogo.routes.js';
import { fiscalRouter } from './modules/fiscal/fiscal.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { configRouter } from './modules/admin/config.routes.js';
import { inventarioRouter } from './modules/inventario/inventario.routes.js';
import { cxcRouter } from './modules/cxc/cxc.routes.js';
import { reportesRouter } from './modules/reportes/reportes.routes.js';
import { actualizacionesRouter } from './modules/admin/actualizaciones.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR_DATOS = join(AQUI, '..', '.datos');
const DIR_WEB = join(AQUI, '..', '..', 'web', 'dist');
const DIR_MIGRACIONES = join(AQUI, '..', '..', '..', 'database', 'migraciones');
const RAIZ = join(AQUI, '..', '..', '..');
const VERSION = JSON.parse(readFileSync(join(RAIZ, 'version.json'), 'utf8')).version as string;

/** Aplica las migraciones (idempotentes) en orden: actualizar el POS nunca exige tocar la base a mano. */
async function migrar() {
  if (!existsSync(DIR_MIGRACIONES)) return;
  for (const f of readdirSync(DIR_MIGRACIONES).filter((x) => x.endsWith('.sql')).sort()) {
    await pool.query(`SET client_min_messages = warning; ${readFileSync(join(DIR_MIGRACIONES, f), 'utf8')}`);
  }
}

// ---------------------------------------------------------------- certificado + worker fiscal
const certificado = new GestorCertificado(DIR_DATOS);
const dgii = new ClienteDGII(() => certificado.obtener());
certificado.alCambiar(() => dgii.reiniciar());

let trabajando: Promise<number> | null = null;
function cicloWorker(): Promise<number> {
  if (!trabajando) {
    trabajando = procesarLote(dgii)
      .catch((e) => { console.error('[fiscal]', (e as Error).message); return 0; })
      .finally(() => { trabajando = null; });
  }
  return trabajando;
}
setInterval(cicloWorker, config.worker.intervaloMs);
const despertarWorker = () => { setTimeout(cicloWorker, 500); };

// ---------------------------------------------------------------- app
const app = express();
app.use(express.json({ limit: '3mb' }));

app.get('/api/auth/usuarios', async (_req, res, next) => {
  try {
    res.json((await pool.query(`SELECT id, nombre, rol FROM usuarios WHERE activo ORDER BY rol, nombre`)).rows);
  } catch (e) { next(e); }
});

app.post('/api/auth/login', async (req, res, next) => {
  const p = z.object({ usuarioId: z.string().uuid(), pin: z.string().min(4).max(8) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'PIN inválido' });
  try {
    const u = (await pool.query(`SELECT id, nombre, rol, pin_hash FROM usuarios WHERE id = $1 AND activo`, [p.data.usuarioId])).rows[0];
    if (!u || !verificarSecreto(p.data.pin, u.pin_hash)) return res.status(401).json({ error: 'PIN', mensaje: 'PIN incorrecto' });
    await pool.query(`UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1`, [u.id]);
    res.json({ token: firmarToken({ id: u.id, nombre: u.nombre, rol: u.rol }), usuario: { id: u.id, nombre: u.nombre, rol: u.rol } });
  } catch (e) { next(e); }
});

// Actualizaciones: /api/version es pública; el resto exige administrador dentro del router
const actualizaciones = actualizacionesRouter({ raiz: RAIZ, dirDatos: DIR_DATOS, supervisado: process.env.POS_LANZADOR === '1' });
app.get('/api/version', (_req, res) => res.json({ version: VERSION }));

// Todo lo demás requiere sesión; algunas secciones, además, rol
app.use('/api', requiereSesion);
app.use('/api', actualizaciones);
app.use('/api/admin', requiereRol('administrador'));
app.use('/api/inventario', requiereRol('administrador'));
app.use('/api/reportes', requiereRol('administrador', 'contador'));
app.use('/api/cxc', requiereRol('administrador', 'contador'));

app.use('/api', catalogoRouter());
app.use('/api', cajasRouter());
app.use('/api', ventasRouter(() => certificado.obtener(), despertarWorker));
app.use('/api', fiscalRouter({
  infoCertificado: () => certificado.info(),
  estadoWorker: () => ({ ...estadoWorker }),
  sincronizar: cicloWorker,
}));
app.use('/api', configRouter(certificado, despertarWorker));
app.use('/api', adminRouter());
app.use('/api', inventarioRouter());
app.use('/api', cxcRouter());
app.use('/api', reportesRouter());
app.use('/api', (_req, res) => res.status(404).json({ error: 'RUTA', mensaje: 'Ruta no encontrada' }));

if (existsSync(DIR_WEB)) {
  app.use(express.static(DIR_WEB));
  app.get('*', (_req, res) => res.sendFile(join(DIR_WEB, 'index.html')));
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNO', mensaje: 'Error inesperado en el servidor' });
});

const PUERTO = Number(process.env.PORT ?? 3000);
await migrar();
app.listen(PUERTO, () => {
  const c = certificado.info();
  console.log(`\n  POS DGII v${VERSION} listo en  http://localhost:${PUERTO}`);
  console.log(`  Ambiente DGII:     ${config.ambiente}`);
  console.log(`  Certificado:       ${c.esPrueba ? 'DE PRUEBA (la DGII no lo aceptará)' : `${c.titular} · vence ${c.vence}`}\n`);
  cicloWorker();
});
