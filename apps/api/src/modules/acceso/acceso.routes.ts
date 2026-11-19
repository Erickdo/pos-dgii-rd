import { Router, type Request } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db.js';
import { firmarToken, hashSecreto, requiereRol, usuarioDe, verificarSecreto } from '../../auth.js';

/**
 * Acceso: login por usuario/correo + contraseña o PIN, marca pública, solicitudes de nuevos integrantes.
 *  - Bloqueo temporal tras 5 intentos fallidos (por usuario e IP): un PIN de 4 dígitos no resiste fuerza bruta sin esto.
 *  - Mensajes genéricos: no se revela si el usuario existe.
 */

const intentos = new Map<string, { n: number; hasta: number }>();
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60_000;
const ipDe = (req: Request) => (req.ip ?? '').replace('::ffff:', '');

const solicitudesPorIp = new Map<string, number[]>();

/** PIN = 4 a 6 dígitos; contraseña = 6+ caracteres con al menos una letra */
export const secretoValido = (s: string) => /^\d{4,6}$/.test(s) || (s.length >= 6 && /[a-zA-Z]/.test(s));

export function accesoRouter() {
  const r = Router();

  // ------------------------------------------------------------ marca (pública)
  r.get('/marca', async (_req, res, next) => {
    try {
      const e = (await pool.query(`SELECT rnc, razon_social, nombre_comercial, direccion, telefono, correo FROM emisor LIMIT 1`)).rows[0];
      const m = (await pool.query(`SELECT valor FROM configuracion WHERE clave = 'marca'`)).rows[0]?.valor ?? {};
      // Datos públicos del negocio (los mismos que salen en cada factura), para las páginas legales del login
      res.json({
        nombre: e?.nombre_comercial || e?.razon_social || 'Punto de Venta', logo: m.logo ?? null,
        razonSocial: e?.razon_social ?? null, rnc: e?.rnc ?? null, direccion: e?.direccion ?? null,
        telefono: e?.telefono ?? null, correo: e?.correo ?? null,
      });
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------ login
  r.post('/auth/entrar', async (req, res, next) => {
    const p = z.object({
      usuario: z.string().trim().min(1).max(120),
      secreto: z.string().min(1).max(200),
      modo: z.enum(['caja', 'administrador']),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Escribe tu usuario y tu contraseña o PIN' });
    const { usuario, secreto, modo } = p.data;
    const clave = `${usuario.toLowerCase()}|${ipDe(req)}`;
    const bloqueo = intentos.get(clave);
    if (bloqueo && bloqueo.hasta > Date.now()) {
      const min = Math.ceil((bloqueo.hasta - Date.now()) / 60_000);
      return res.status(429).json({ error: 'BLOQUEADO', mensaje: `Demasiados intentos. Espera ${min} minuto${min > 1 ? 's' : ''} o pide ayuda al administrador.` });
    }
    try {
      const u = (await pool.query(
        `SELECT id, nombre, rol, pin_hash, password_hash, activo FROM usuarios
          WHERE lower(usuario) = lower($1) OR lower(correo) = lower($1) LIMIT 1`, [usuario])).rows[0];
      const ok = u && u.activo && (verificarSecreto(secreto, u.pin_hash) || verificarSecreto(secreto, u.password_hash));
      if (!ok) {
        const vencido = bloqueo && bloqueo.hasta > 0 && bloqueo.hasta <= Date.now();  // terminó un bloqueo anterior
        const n = (vencido ? 0 : bloqueo?.n ?? 0) + 1;
        intentos.set(clave, { n, hasta: n >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0 });
        const quedan = MAX_INTENTOS - n;
        return res.status(401).json({
          error: 'CREDENCIALES',
          mensaje: quedan > 0 ? `Usuario o contraseña incorrectos${quedan <= 2 ? ` (te quedan ${quedan} intento${quedan > 1 ? 's' : ''})` : ''}` : 'Demasiados intentos. Espera 5 minutos.',
        });
      }
      // Pestaña "Administrador": administradores y contadores. Pestaña "Caja": cajeros y administradores.
      const permitido = modo === 'administrador' ? ['administrador', 'contador'].includes(u.rol) : ['cajero', 'administrador'].includes(u.rol);
      if (!permitido) {
        return res.status(403).json({
          error: 'MODO',
          mensaje: modo === 'administrador' ? 'Tu usuario es de caja: entra por la pestaña "Caja".' : 'Tu usuario es de contabilidad: entra por la pestaña "Administrador".',
        });
      }
      intentos.delete(clave);
      await pool.query(`UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1`, [u.id]);
      res.json({ token: firmarToken({ id: u.id, nombre: u.nombre, rol: u.rol }), usuario: { id: u.id, nombre: u.nombre, rol: u.rol }, modo });
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------ solicitar acceso (público)
  r.post('/auth/solicitudes', async (req, res, next) => {
    const p = z.object({
      nombre: z.string().trim().min(3, 'Escribe tu nombre completo').max(100),
      contacto: z.string().trim().min(7, 'Escribe un correo o teléfono válido').max(120)
        .refine((c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) || /^[\d\s()+-]{7,20}$/.test(c), 'Escribe un correo o teléfono válido'),
      rol: z.enum(['cajero', 'administrador']),
      nota: z.string().trim().max(300).optional(),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: p.error.issues[0].message });

    // Antispam: 3 solicitudes por hora por equipo
    const ip = ipDe(req);
    const recientes = (solicitudesPorIp.get(ip) ?? []).filter((t) => t > Date.now() - 3_600_000);
    if (recientes.length >= 3) return res.status(429).json({ error: 'LIMITE', mensaje: 'Ya enviaste varias solicitudes. Espera a que el administrador las revise.' });
    try {
      const pendientes = Number((await pool.query(`SELECT count(*) FROM solicitudes_acceso WHERE estado = 'pendiente'`)).rows[0].count);
      if (pendientes >= 50) return res.status(429).json({ error: 'LIMITE', mensaje: 'Hay demasiadas solicitudes pendientes. Habla con el administrador.' });
      await pool.query(
        `INSERT INTO solicitudes_acceso (nombre, contacto, rol_solicitado, nota, ip) VALUES ($1,$2,$3,$4,$5)`,
        [p.data.nombre, p.data.contacto, p.data.rol, p.data.nota || null, ip || null]);
      solicitudesPorIp.set(ip, [...recientes, Date.now()]);
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  return r;
}

/** Rutas del administrador para revisar solicitudes (montar detrás de requiereSesion). */
export function solicitudesAdminRouter() {
  const r = Router();
  r.use('/admin/solicitudes', requiereRol('administrador'));

  r.get('/admin/solicitudes', async (req, res, next) => {
    const estado = ['pendiente', 'aprobada', 'rechazada'].includes(String(req.query.estado)) ? String(req.query.estado) : null;
    try {
      res.json((await pool.query(
        `SELECT s.id, s.nombre, s.contacto, s.rol_solicitado, s.nota, s.estado, s.motivo_rechazo,
                to_char(s.creado_en, 'DD-MM-YYYY HH24:MI') AS fecha, to_char(s.resuelta_en, 'DD-MM-YYYY HH24:MI') AS resuelta,
                u.usuario AS usuario_creado, r.nombre AS resuelta_por,
                extract(epoch FROM now() - s.creado_en) / 60 AS minutos
           FROM solicitudes_acceso s
           LEFT JOIN usuarios u ON u.id = s.usuario_id
           LEFT JOIN usuarios r ON r.id = s.resuelta_por
          WHERE ($1::text IS NULL OR s.estado::text = $1)
          ORDER BY (s.estado = 'pendiente') DESC, s.creado_en DESC LIMIT 100`, [estado])).rows);
    } catch (e) { next(e); }
  });

  r.get('/admin/solicitudes/conteo', async (_req, res, next) => {
    try { res.json({ pendientes: Number((await pool.query(`SELECT count(*) FROM solicitudes_acceso WHERE estado = 'pendiente'`)).rows[0].count) }); }
    catch (e) { next(e); }
  });

  r.post('/admin/solicitudes/:id/aprobar', async (req, res, next) => {
    const p = z.object({
      nombre: z.string().trim().min(2).max(100),
      usuario: z.string().trim().min(3).max(50).regex(/^[a-z0-9._-]+$/i, 'el usuario solo admite letras, números, punto o guion'),
      rol: z.enum(['cajero', 'administrador', 'contador']),
      secreto: z.string().refine(secretoValido, 'usa un PIN de 4 a 6 dígitos o una contraseña de 6+ caracteres con letras'),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: p.error.issues[0].message });
    const yo = usuarioDe(req);
    try {
      const out = await withTransaction(async (tx) => {
        const s = (await tx.query(`SELECT * FROM solicitudes_acceso WHERE id = $1 FOR UPDATE`, [req.params.id])).rows[0];
        if (!s) return { status: 404, body: { error: 'NO_ENCONTRADA', mensaje: 'Solicitud no encontrada' } };
        if (s.estado !== 'pendiente') return { status: 409, body: { error: 'RESUELTA', mensaje: 'Esta solicitud ya fue resuelta' } };
        const h = hashSecreto(p.data.secreto);
        const esCorreo = /@/.test(s.contacto);
        const u = (await tx.query(
          `INSERT INTO usuarios (nombre, usuario, password_hash, pin_hash, rol, correo, telefono)
           VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id`,
          [p.data.nombre, p.data.usuario.toLowerCase(), h, p.data.rol, esCorreo ? s.contacto.toLowerCase() : null, esCorreo ? null : s.contacto])).rows[0];
        await tx.query(
          `UPDATE solicitudes_acceso SET estado = 'aprobada', usuario_id = $2, resuelta_por = $3, resuelta_en = now() WHERE id = $1`,
          [req.params.id, u.id, yo.id]);
        await tx.query(
          `INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, despues) VALUES ($1,'solicitud.aprobar','usuario',$2,$3)`,
          [yo.id, u.id, JSON.stringify({ usuario: p.data.usuario, rol: p.data.rol, solicitud: req.params.id })]);
        return { status: 200, body: { ok: true, usuario: p.data.usuario.toLowerCase() } };
      });
      res.status(out.status).json(out.body);
    } catch (e: any) {
      if (e.constraint === 'usuarios_usuario_key') return res.status(409).json({ error: 'DUPLICADO', mensaje: 'Ese nombre de usuario ya existe, elige otro' });
      if (e.constraint === 'ux_usuarios_correo') return res.status(409).json({ error: 'DUPLICADO', mensaje: 'Ya existe un usuario con ese correo' });
      next(e);
    }
  });

  r.post('/admin/solicitudes/:id/rechazar', async (req, res, next) => {
    const motivo = z.string().max(200).optional().safeParse(req.body?.motivo);
    try {
      const { rowCount } = await pool.query(
        `UPDATE solicitudes_acceso SET estado = 'rechazada', resuelta_por = $2, resuelta_en = now(), motivo_rechazo = $3
          WHERE id = $1 AND estado = 'pendiente'`, [req.params.id, usuarioDe(req).id, motivo.success ? motivo.data ?? null : null]);
      if (!rowCount) return res.status(409).json({ error: 'RESUELTA', mensaje: 'Esta solicitud ya fue resuelta' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------ logo de la empresa
  r.put('/admin/marca', requiereRol('administrador'), async (req, res, next) => {
    const p = z.object({
      // PNG/JPG/WebP como data URL, máx. ~500 KB. SVG no se acepta (podría llevar scripts).
      logo: z.string().max(700_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'formato no admitido').nullable(),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Usa una imagen PNG, JPG o WebP de máximo 500 KB' });
    try {
      await pool.query(
        `INSERT INTO configuracion (clave, valor) VALUES ('marca', $1)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [JSON.stringify({ logo: p.data.logo })]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return r;
}
