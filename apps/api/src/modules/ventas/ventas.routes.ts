import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../../db.js';
import { pinSupervisor, usuarioDe } from '../../auth.js';
import { anularVenta } from './devoluciones.service.js';
import { procesarVenta, cotizarVenta, ErrorNegocio } from './ventas.service.js';
import type { Firmante } from '../fiscal/firma.js';

const monto = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Monto inválido');
const cantidad = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/, 'Cantidad inválida');

const ItemsSchema = z.array(z.object({
  productoId: z.string().uuid(),
  cantidad,
  descuentoMonto: monto.optional(),
})).min(1).max(1000);

const VentaSchema = z.object({
  idempotencyKey: z.string().uuid(),
  cajaId: z.string().uuid(),
  clienteId: z.string().uuid().optional(),
  creditoFiscal: z.boolean().optional(),
  tipoComprobante: z.enum(['31', '32', '44', '45']).optional(),
  items: ItemsSchema,
  pagos: z.array(z.object({
    metodo: z.enum(['efectivo', 'tarjeta', 'transferencia', 'cheque', 'credito', 'bono', 'otro']),
    monto,
    referencia: z.string().max(100).optional(),
    ultimos4: z.string().regex(/^\d{4}$/).optional(),
  })).min(1).max(10),
});

function manejarError(e: unknown, res: Response, next: NextFunction) {
  if (e instanceof ErrorNegocio) return res.status(e.status).json({ error: e.codigo, mensaje: e.message });
  if (e instanceof Error && /ítems|cantidad|descuento|Pago|pagos|1,000/i.test(e.message)) {
    return res.status(422).json({ error: 'VALIDACION', mensaje: e.message });
  }
  next(e);
}

export function ventasRouter(firmante: () => Firmante, despertarWorker: () => void) {
  const r = Router();

  r.post('/ventas/cotizar', async (req, res, next) => {
    const p = z.object({ items: ItemsSchema, tipoComprobante: z.enum(['31', '32', '44', '45']).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', detalles: p.error.flatten() });
    try { res.json(await cotizarVenta(pool, p.data.items, p.data.tipoComprobante)); } catch (e) { manejarError(e, res, next); }
  });

  r.post('/ventas', async (req: Request, res: Response, next: NextFunction) => {
    const parsed = VentaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDACION', detalles: parsed.error.flatten() });
    try {
      const resultado = await procesarVenta({ ...parsed.data, usuarioId: usuarioDe(req).id }, firmante());
      despertarWorker(); // intenta transmitir de inmediato; si no hay internet, queda en cola
      res.status(resultado.repetida ? 200 : 201).json(resultado);
    } catch (e) { manejarError(e, res, next); }
  });

  // Datos completos para la representación impresa
  r.get('/ventas/:id/ticket', async (req, res, next) => {
    try {
      const v = (await pool.query(
        `SELECT v.*, c.nombre AS cliente_nombre, c.identificacion AS cliente_ident, u.nombre AS cajero,
                f.encf, f.tipo_ecf, f.fecha_vencimiento_sec, f.codigo_seguridad, f.url_qr, f.estado AS estado_fiscal,
                to_char(f.fecha_hora_firma, 'DD-MM-YYYY HH24:MI:SS') AS fecha_firma,
                to_char(v.creado_en, 'DD-MM-YYYY HH24:MI') AS fecha,
                e.rnc, e.razon_social, e.nombre_comercial, e.direccion, e.telefono, e.ambiente
           FROM ventas v
           JOIN clientes c ON c.id = v.cliente_id
           JOIN usuarios u ON u.id = v.usuario_id
           JOIN facturas_electronicas f ON f.venta_id = v.id
           JOIN emisor e ON e.id = f.emisor_id
          WHERE v.id = $1`, [req.params.id],
      )).rows[0];
      if (!v) return res.status(404).json({ error: 'NO_ENCONTRADA', mensaje: 'Venta no encontrada' });
      const items = (await pool.query(
        `SELECT numero_linea, nombre, cantidad, precio_unitario, descuento_monto, monto_item, indicador_itbis, itbis_item
           FROM detalles_venta WHERE venta_id = $1 ORDER BY numero_linea`, [req.params.id])).rows;
      const pagos = (await pool.query(
        `SELECT metodo, monto, referencia FROM pagos_venta WHERE venta_id = $1 ORDER BY id`, [req.params.id])).rows;
      res.json({ venta: v, items, pagos });
    } catch (e) { next(e); }
  });

  // Anulación total con Nota de Crédito E34. Requiere administrador o su PIN.
  r.post('/ventas/:id/anular', async (req, res, next) => {
    const p = z.object({ motivo: z.string().trim().min(5).max(90), pinSupervisor: z.string().optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Escribe el motivo (mínimo 5 letras)' });
    const u = usuarioDe(req);
    try {
      const autorizadoPor = u.rol === 'administrador' ? u.id : await pinSupervisor(p.data.pinSupervisor ?? '');
      if (!autorizadoPor) return res.status(403).json({ error: 'PIN_SUPERVISOR', mensaje: 'PIN de administrador incorrecto' });
      const caja = (await pool.query(`SELECT id FROM cajas WHERE usuario_id = $1 AND estado = 'abierta'`, [u.id])).rows[0];
      const r2 = await anularVenta({ ventaId: req.params.id, usuarioId: u.id, autorizadoPor, motivo: p.data.motivo, cajaActualId: caja?.id }, firmante());
      despertarWorker();
      res.json(r2);
    } catch (e) { manejarError(e, res, next); }
  });

  // Historial: administrador/contador ven todo; un cajero solo sus ventas
  r.get('/ventas', async (req, res, next) => {
    const u = usuarioDe(req);
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde)) ? String(req.query.desde) : null;
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.hasta)) ? String(req.query.hasta) : null;
    const q = String(req.query.q ?? '').trim();
    const estado = ['completada', 'anulada'].includes(String(req.query.estado)) ? String(req.query.estado) : null;
    try {
      const { rows } = await pool.query(
        `SELECT v.id, to_char(v.creado_en, 'DD-MM-YYYY HH24:MI') AS fecha, v.monto_total, v.total_itbis, v.total_descuento,
                v.estado, v.motivo_anulacion, f.encf, f.tipo_ecf, f.estado AS estado_fiscal, c.nombre AS cliente,
                c.identificacion, u.nombre AS cajero, t.codigo AS terminal,
                (SELECT string_agg(DISTINCT p.metodo::text, ', ') FROM pagos_venta p WHERE p.venta_id = v.id) AS metodos,
                (SELECT nc.encf FROM facturas_electronicas nc WHERE nc.referencia_fe_id = f.id) AS nota_credito
           FROM ventas v
           JOIN facturas_electronicas f ON f.venta_id = v.id
           JOIN clientes c ON c.id = v.cliente_id
           JOIN usuarios u ON u.id = v.usuario_id
           JOIN cajas ca ON ca.id = v.caja_id JOIN terminales t ON t.id = ca.terminal_id
          WHERE ($1::date IS NULL OR (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date >= $1)
            AND ($2::date IS NULL OR (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date <= $2)
            AND ($3 = '' OR f.encf ILIKE '%' || $3 || '%' OR unaccent(c.nombre) ILIKE '%' || unaccent($3) || '%' OR c.identificacion LIKE $3 || '%')
            AND ($4::text IS NULL OR v.estado::text = $4)
            AND ($5::uuid IS NULL OR v.usuario_id = $5)
          ORDER BY v.creado_en DESC LIMIT 500`,
        [desde, hasta, q, estado, u.rol === 'cajero' ? u.id : null]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // Últimas ventas de la caja (para reimprimir)
  r.get('/cajas/:id/ventas', async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT v.id, to_char(v.creado_en, 'HH24:MI') AS hora, v.monto_total, v.estado, f.encf, f.estado AS estado_fiscal,
                c.nombre AS cliente, (SELECT nc.encf FROM facturas_electronicas nc WHERE nc.referencia_fe_id = f.id) AS nota_credito
           FROM ventas v JOIN facturas_electronicas f ON f.venta_id = v.id JOIN clientes c ON c.id = v.cliente_id
          WHERE v.caja_id = $1 ORDER BY v.creado_en DESC LIMIT 30`, [req.params.id]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  return r;
}
