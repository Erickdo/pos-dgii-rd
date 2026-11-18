import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db.js';
import { usuarioDe } from '../../auth.js';

export function cxcRouter() {
  const r = Router();

  // Clientes con saldo (o historial de crédito)
  r.get('/cxc', async (_req, res, next) => {
    try {
      res.json((await pool.query(
        `SELECT cliente_id, nombre, identificacion, limite_credito, total_credito, total_abonado, saldo,
                to_char(ultima_venta, 'DD-MM-YYYY') AS ultima_venta, to_char(ultimo_abono, 'DD-MM-YYYY') AS ultimo_abono,
                (current_date - (ultima_venta AT TIME ZONE 'America/Santo_Domingo')::date) AS dias_ultima_venta
           FROM v_saldos_clientes ORDER BY saldo DESC, nombre`)).rows);
    } catch (e) { next(e); }
  });

  // Estado de cuenta: cargos (ventas a crédito) y abonos en orden cronológico
  r.get('/cxc/:clienteId', async (req, res, next) => {
    try {
      const cliente = (await pool.query(
        `SELECT c.id, c.nombre, c.identificacion, c.limite_credito, COALESCE(s.saldo, 0) AS saldo
           FROM clientes c LEFT JOIN v_saldos_clientes s ON s.cliente_id = c.id WHERE c.id = $1`, [req.params.clienteId])).rows[0];
      if (!cliente) return res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'Cliente no encontrado' });
      const movimientos = (await pool.query(
        `SELECT * FROM (
           SELECT v.creado_en AS fecha_orden, to_char(v.creado_en, 'DD-MM-YYYY') AS fecha, 'cargo' AS tipo,
                  f.encf AS documento, p.monto, v.estado
             FROM pagos_venta p JOIN ventas v ON v.id = p.venta_id JOIN facturas_electronicas f ON f.venta_id = v.id
            WHERE v.cliente_id = $1 AND p.metodo = 'credito'
           UNION ALL
           SELECT a.creado_en, to_char(a.creado_en, 'DD-MM-YYYY'), 'abono', initcap(a.metodo::text) || COALESCE(' · ' || a.referencia, ''), a.monto, 'completada'
             FROM abonos a WHERE a.cliente_id = $1
         ) m ORDER BY fecha_orden`, [req.params.clienteId])).rows;
      let saldo = 0;
      const conSaldo = movimientos.map((m) => {
        if (m.estado === 'completada') saldo += (m.tipo === 'cargo' ? 1 : -1) * Number(m.monto);
        return { ...m, saldo: saldo.toFixed(2) };
      });
      res.json({ cliente, movimientos: conSaldo.reverse() });
    } catch (e) { next(e); }
  });

  // Abono: si es efectivo y quien lo recibe tiene caja abierta, entra a esa caja
  r.post('/cxc/:clienteId/abonos', async (req, res, next) => {
    const p = z.object({
      monto: z.coerce.number().positive(),
      metodo: z.enum(['efectivo', 'tarjeta', 'transferencia', 'cheque']),
      referencia: z.string().max(100).optional().or(z.literal('')),
      notas: z.string().max(200).optional(),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Monto o método inválido' });
    const d = p.data;
    const u = usuarioDe(req);
    if (d.metodo !== 'efectivo' && !d.referencia) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Indica la referencia del pago' });
    try {
      const out = await withTransaction(async (tx) => {
        const saldo = Number((await tx.query(`SELECT saldo FROM v_saldos_clientes WHERE cliente_id = $1`, [req.params.clienteId])).rows[0]?.saldo ?? 0);
        if (d.monto > saldo + 0.001) return { status: 409, body: { error: 'EXCEDE', mensaje: `El abono supera el saldo (RD$${saldo.toFixed(2)})` } };
        const caja = (await tx.query(`SELECT id FROM cajas WHERE usuario_id = $1 AND estado = 'abierta'`, [u.id])).rows[0];
        const cli = (await tx.query(`SELECT nombre FROM clientes WHERE id = $1`, [req.params.clienteId])).rows[0];
        const cajaId = d.metodo === 'efectivo' ? caja?.id ?? null : null;
        await tx.query(
          `INSERT INTO abonos (cliente_id, monto, metodo, referencia, caja_id, usuario_id, notas) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.params.clienteId, d.monto.toFixed(2), d.metodo, d.referencia || null, cajaId, u.id, d.notas ?? null]);
        if (cajaId) {
          await tx.query(
            `INSERT INTO movimientos_caja (caja_id, tipo, monto, motivo, usuario_id) VALUES ($1,'entrada',$2,$3,$4)`,
            [cajaId, d.monto.toFixed(2), `Abono de ${cli.nombre}`.slice(0, 200), u.id]);
        }
        return { status: 201, body: { ok: true, nuevoSaldo: (saldo - d.monto).toFixed(2), enCaja: !!cajaId } };
      });
      res.status(out.status).json(out.body);
    } catch (e) { next(e); }
  });

  return r;
}
