import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../db.js';
import { usuarioDe } from '../../auth.js';

export function inventarioRouter() {
  const r = Router();

  // Compra a proveedor: entra stock, actualiza último costo y deja kardex
  r.post('/inventario/compras', async (req, res, next) => {
    const p = z.object({
      proveedorNombre: z.string().trim().min(2).max(150),
      proveedorRnc: z.string().regex(/^\d{9}(\d{2})?$/).optional().or(z.literal('')),
      ncfProveedor: z.string().trim().max(19).optional().or(z.literal('')),
      itbisPagado: z.coerce.number().min(0).default(0),
      notas: z.string().max(500).optional(),
      items: z.array(z.object({
        productoId: z.string().uuid(),
        cantidad: z.coerce.number().positive(),
        costoUnitario: z.coerce.number().min(0),
      })).min(1),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Revisa proveedor, cantidades y costos' });
    const d = p.data;
    const u = usuarioDe(req);
    try {
      const id = await withTransaction(async (tx) => {
        const total = d.items.reduce((s, i) => s + i.cantidad * i.costoUnitario, 0);
        const compra = (await tx.query(
          `INSERT INTO compras (proveedor_nombre, proveedor_rnc, ncf_proveedor, total, itbis_pagado, notas, usuario_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [d.proveedorNombre, d.proveedorRnc || null, d.ncfProveedor || null, total.toFixed(2), d.itbisPagado, d.notas ?? null, u.id])).rows[0];
        for (const it of d.items) {
          await tx.query(`INSERT INTO compras_detalle (compra_id, producto_id, cantidad, costo_unitario) VALUES ($1,$2,$3,$4)`,
            [compra.id, it.productoId, it.cantidad, it.costoUnitario]);
          const pr = (await tx.query(
            `UPDATE productos SET stock_actual = stock_actual + $2, costo = $3, actualizado_en = now()
              WHERE id = $1 AND maneja_inventario RETURNING stock_actual`, [it.productoId, it.cantidad, it.costoUnitario])).rows[0];
          if (pr) {
            await tx.query(
              `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_resultante, costo_unitario, referencia_tipo, referencia_id, usuario_id)
               VALUES ($1,'compra',$2,$3,$4,'compra',$5,$6)`, [it.productoId, it.cantidad, pr.stock_actual, it.costoUnitario, compra.id, u.id]);
          }
        }
        return compra.id;
      });
      res.status(201).json({ id });
    } catch (e) { next(e); }
  });

  r.get('/inventario/compras', async (_req, res, next) => {
    try {
      res.json((await pool.query(
        `SELECT c.id, to_char(c.fecha, 'DD-MM-YYYY') AS fecha, c.proveedor_nombre, c.proveedor_rnc, c.ncf_proveedor,
                c.total, c.itbis_pagado, u.nombre AS usuario, count(d.id)::int AS lineas
           FROM compras c JOIN usuarios u ON u.id = c.usuario_id LEFT JOIN compras_detalle d ON d.compra_id = c.id
          GROUP BY c.id, u.nombre ORDER BY c.creado_en DESC LIMIT 100`)).rows);
    } catch (e) { next(e); }
  });

  // Ajuste manual (conteo físico, merma, vencido…)
  r.post('/inventario/ajustes', async (req, res, next) => {
    const p = z.object({
      productoId: z.string().uuid(),
      cantidad: z.coerce.number().refine((n) => n !== 0, 'no puede ser 0'),
      motivo: z.string().trim().min(3).max(200),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Indica cantidad (+/-) y motivo' });
    const d = p.data;
    try {
      const r2 = await withTransaction(async (tx) => {
        const pr = (await tx.query(
          `UPDATE productos SET stock_actual = stock_actual + $2, actualizado_en = now()
            WHERE id = $1 AND maneja_inventario RETURNING stock_actual`, [d.productoId, d.cantidad])).rows[0];
        if (!pr) return null;
        await tx.query(
          `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_resultante, referencia_tipo, usuario_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [d.productoId, d.cantidad > 0 ? 'ajuste_pos' : 'ajuste_neg', d.cantidad, pr.stock_actual, d.motivo.slice(0, 20), usuarioDe(req).id]);
        return pr;
      });
      if (!r2) return res.status(409).json({ error: 'SIN_INVENTARIO', mensaje: 'Ese producto no maneja inventario' });
      res.json({ stock: r2.stock_actual });
    } catch (e: any) {
      if (e.constraint === 'chk_stock_no_negativo') return res.status(409).json({ error: 'STOCK', mensaje: 'El stock no puede quedar negativo' });
      next(e);
    }
  });

  r.get('/inventario/kardex/:productoId', async (req, res, next) => {
    try {
      res.json((await pool.query(
        `SELECT m.tipo, m.cantidad, m.stock_resultante, m.costo_unitario, m.referencia_tipo,
                to_char(m.creado_en, 'DD-MM-YYYY HH24:MI') AS fecha, u.nombre AS usuario
           FROM movimientos_inventario m LEFT JOIN usuarios u ON u.id = m.usuario_id
          WHERE m.producto_id = $1 ORDER BY m.creado_en DESC, m.id DESC LIMIT 200`, [req.params.productoId])).rows);
    } catch (e) { next(e); }
  });

  r.get('/inventario/valorizado', async (_req, res, next) => {
    try {
      res.json((await pool.query(
        `SELECT count(*)::int AS productos, COALESCE(sum(stock_actual * costo), 0) AS valor_costo,
                count(*) FILTER (WHERE stock_actual <= stock_minimo)::int AS bajo_minimo
           FROM productos WHERE maneja_inventario AND activo`)).rows[0]);
    } catch (e) { next(e); }
  });

  return r;
}
