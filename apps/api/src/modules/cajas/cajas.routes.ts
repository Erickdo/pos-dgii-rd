import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db.js';
import { pinSupervisor, usuarioDe } from '../../auth.js';

const monto = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Monto inválido');

export function cajasRouter() {
  const r = Router();

  r.get('/terminales', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT t.id, t.codigo, t.descripcion, s.nombre AS sucursal,
                EXISTS (SELECT 1 FROM cajas c WHERE c.terminal_id = t.id AND c.estado = 'abierta') AS ocupada
           FROM terminales t JOIN sucursales s ON s.id = t.sucursal_id
          WHERE t.activa ORDER BY s.nombre, t.codigo`);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // Turnos anteriores (administrador y contador ven todos; cajero los suyos)
  r.get('/cajas/historial', async (req, res, next) => {
    const u = usuarioDe(req);
    try {
      const { rows } = await pool.query(
        `SELECT c.id, t.codigo AS terminal, us.nombre AS cajero, us.rol AS cajero_rol, c.estado,
                cp.nombre AS cerrada_por, cp.rol AS cerrada_por_rol,
                to_char(c.abierta_en, 'DD-MM-YYYY HH24:MI') AS abierta, to_char(c.cerrada_en, 'DD-MM-YYYY HH24:MI') AS cerrada,
                c.monto_inicial, c.efectivo_esperado, c.efectivo_contado, c.diferencia,
                (c.detalle_arqueo ->> 'tarjeta_lote')::numeric AS tarjeta_lote, r.total_ventas, r.num_ventas, r.por_metodo
           FROM cajas c JOIN terminales t ON t.id = c.terminal_id JOIN usuarios us ON us.id = c.usuario_id
           LEFT JOIN usuarios cp ON cp.id = c.cerrada_por
           JOIN v_resumen_caja r ON r.caja_id = c.id
          WHERE ($1::uuid IS NULL OR c.usuario_id = $1)
          ORDER BY c.abierta_en DESC LIMIT 60`, [u.rol === 'cajero' ? u.id : null]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // Caja abierta del usuario en sesión (si tiene)
  r.get('/cajas/actual', async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT c.id, c.monto_inicial, to_char(c.abierta_en, 'DD-MM-YYYY HH24:MI') AS abierta_en,
                t.codigo AS terminal, s.nombre AS sucursal
           FROM cajas c JOIN terminales t ON t.id = c.terminal_id JOIN sucursales s ON s.id = t.sucursal_id
          WHERE c.usuario_id = $1 AND c.estado = 'abierta'`, [usuarioDe(req).id]);
      res.json(rows[0] ?? null);
    } catch (e) { next(e); }
  });

  r.post('/cajas/abrir', async (req, res, next) => {
    const p = z.object({ terminalId: z.string().uuid(), montoInicial: monto }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Datos de apertura inválidos' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO cajas (terminal_id, usuario_id, monto_inicial) VALUES ($1, $2, $3) RETURNING id`,
        [p.data.terminalId, usuarioDe(req).id, p.data.montoInicial]);
      res.status(201).json({ id: rows[0].id });
    } catch (e: any) {
      if (e.constraint === 'ux_caja_abierta_terminal') return res.status(409).json({ error: 'TERMINAL_OCUPADA', mensaje: 'Esa terminal ya tiene una caja abierta' });
      if (e.constraint === 'ux_caja_abierta_usuario') return res.status(409).json({ error: 'YA_TIENE_CAJA', mensaje: 'Ya tienes una caja abierta' });
      next(e);
    }
  });

  r.get('/cajas/:id/resumen', async (req, res, next) => {
    try {
      const resumen = (await pool.query(`SELECT * FROM v_resumen_caja WHERE caja_id = $1`, [req.params.id])).rows[0];
      const movimientos = (await pool.query(
        `SELECT m.tipo, m.monto, m.motivo, to_char(m.creado_en, 'HH24:MI') AS hora, u.nombre AS usuario, u.rol AS usuario_rol,
                au.nombre AS autorizado_por
           FROM movimientos_caja m JOIN usuarios u ON u.id = m.usuario_id
           LEFT JOIN usuarios au ON au.id = m.autorizado_por
          WHERE m.caja_id = $1 ORDER BY m.creado_en DESC`, [req.params.id])).rows;
      res.json({ resumen, movimientos });
    } catch (e) { next(e); }
  });

  // Entradas / salidas manuales de efectivo. Las salidas requieren PIN de administrador.
  r.post('/cajas/:id/movimientos', async (req, res, next) => {
    const p = z.object({
      tipo: z.enum(['entrada', 'salida']),
      monto,
      motivo: z.string().trim().min(3).max(200),
      pinSupervisor: z.string().optional(),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Indica monto y motivo (mínimo 3 letras)' });
    const u = usuarioDe(req);
    try {
      let autorizadoPor: string | null = null;
      if (p.data.tipo === 'salida') {
        autorizadoPor = u.rol === 'administrador' ? u.id : await pinSupervisor(p.data.pinSupervisor ?? '');
        if (!autorizadoPor) return res.status(403).json({ error: 'PIN_SUPERVISOR', mensaje: 'PIN de administrador incorrecto' });
      }
      const caja = await pool.query(`SELECT 1 FROM cajas WHERE id = $1 AND estado = 'abierta'`, [req.params.id]);
      if (!caja.rowCount) return res.status(409).json({ error: 'CAJA_CERRADA', mensaje: 'La caja no está abierta' });
      await pool.query(
        `INSERT INTO movimientos_caja (caja_id, tipo, monto, motivo, usuario_id, autorizado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.params.id, p.data.tipo, p.data.monto, p.data.motivo, u.id, autorizadoPor]);
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  // Arqueo y cierre
  r.post('/cajas/:id/cerrar', async (req, res, next) => {
    const p = z.object({
      efectivoContado: monto,
      detalleArqueo: z.record(z.string(), z.number().int().min(0)).optional(),
      tarjetaLote: monto.optional(),   // total del cierre de lote del datáfono
      observaciones: z.string().max(500).optional(),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Conteo inválido' });
    const u = usuarioDe(req);
    try {
      const out = await withTransaction(async (tx) => {
        const c = await tx.query(`SELECT usuario_id FROM cajas WHERE id = $1 AND estado = 'abierta' FOR UPDATE`, [req.params.id]);
        if (!c.rowCount) return { status: 409, body: { error: 'CAJA_CERRADA', mensaje: 'La caja ya está cerrada' } };
        if (c.rows[0].usuario_id !== u.id && u.rol !== 'administrador') {
          return { status: 403, body: { error: 'PERMISO', mensaje: 'Solo el cajero o un administrador puede cerrarla' } };
        }
        const resumen = (await tx.query(`SELECT * FROM v_resumen_caja WHERE caja_id = $1`, [req.params.id])).rows[0];
        await tx.query(
          `UPDATE cajas SET estado = 'cerrada', cerrada_en = now(), cerrada_por = $2, efectivo_esperado = $3,
                  efectivo_contado = $4, detalle_arqueo = $5, observaciones = $6 WHERE id = $1`,
          [req.params.id, u.id, resumen.efectivo_esperado, p.data.efectivoContado,
           JSON.stringify({ ...(p.data.detalleArqueo ?? {}), ...(p.data.tarjetaLote ? { tarjeta_lote: Number(p.data.tarjetaLote) } : {}) }),
           p.data.observaciones ?? null]);
        const cierre = (await tx.query(`SELECT efectivo_esperado, efectivo_contado, diferencia FROM cajas WHERE id = $1`, [req.params.id])).rows[0];
        const tarjetaSistema = Number(resumen.por_metodo?.tarjeta ?? 0);
        const tarjeta = p.data.tarjetaLote !== undefined
          ? { sistema: tarjetaSistema.toFixed(2), lote: Number(p.data.tarjetaLote).toFixed(2), diferencia: (Number(p.data.tarjetaLote) - tarjetaSistema).toFixed(2) }
          : null;
        return { status: 200, body: { resumen, cierre, tarjeta } };
      });
      res.status(out.status).json(out.body);
    } catch (e) { next(e); }
  });

  return r;
}
