import { Router } from 'express';
import { pool } from '../../db.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const hoyRD = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());

export function reportesRouter() {
  const r = Router();

  // ------------------------------------------------------------ dashboard del día
  r.get('/reportes/hoy', async (_req, res, next) => {
    try {
      const hoy = hoyRD();
      const tot = (await pool.query(
        `SELECT
           COALESCE(sum(monto_total) FILTER (WHERE dia = $1::date AND estado = 'completada'), 0) AS ventas_hoy,
           count(*) FILTER (WHERE dia = $1::date AND estado = 'completada')::int AS tickets_hoy,
           COALESCE(sum(total_itbis) FILTER (WHERE dia = $1::date AND estado = 'completada'), 0) AS itbis_hoy,
           count(*) FILTER (WHERE dia = $1::date AND estado = 'anulada')::int AS anuladas_hoy,
           COALESCE(sum(monto_total) FILTER (WHERE dia = $1::date - 1 AND estado = 'completada'), 0) AS ventas_ayer,
           COALESCE(sum(monto_total) FILTER (WHERE dia = $1::date - 7 AND estado = 'completada'), 0) AS ventas_semana_pasada
         FROM v_ventas_detalle WHERE dia >= $1::date - 7`, [hoy])).rows[0];
      const porHora = (await pool.query(
        `SELECT h AS hora, COALESCE(sum(v.monto_total), 0) AS total, count(v.id)::int AS tickets
           FROM generate_series(6, 23) h
           LEFT JOIN v_ventas_detalle v ON v.hora = h AND v.dia = $1::date AND v.estado = 'completada'
          GROUP BY h ORDER BY h`, [hoy])).rows;
      const top = (await pool.query(
        `SELECT d.nombre, sum(d.cantidad) AS cantidad, sum(d.monto_item + d.itbis_item) AS total
           FROM detalles_venta d JOIN v_ventas_detalle v ON v.id = d.venta_id
          WHERE v.dia = $1::date AND v.estado = 'completada'
          GROUP BY d.nombre ORDER BY total DESC LIMIT 6`, [hoy])).rows;
      const porMetodo = (await pool.query(
        `SELECT p.metodo, sum(p.monto) AS monto
           FROM pagos_venta p JOIN v_ventas_detalle v ON v.id = p.venta_id
          WHERE v.dia = $1::date AND v.estado = 'completada' GROUP BY p.metodo ORDER BY 2 DESC`, [hoy])).rows;
      const cambio = (await pool.query(
        `SELECT COALESCE(sum(v.cambio), 0) AS c FROM ventas v WHERE (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date = $1::date AND v.estado = 'completada'`, [hoy])).rows[0].c;
      const ef = porMetodo.find((m) => m.metodo === 'efectivo');
      if (ef) ef.monto = (Number(ef.monto) - Number(cambio)).toFixed(2);
      const cajas = (await pool.query(
        `SELECT t.codigo AS terminal, u.nombre AS cajero, to_char(c.abierta_en, 'HH24:MI') AS desde, r.total_ventas, r.efectivo_esperado
           FROM cajas c JOIN terminales t ON t.id = c.terminal_id JOIN usuarios u ON u.id = c.usuario_id
           JOIN v_resumen_caja r ON r.caja_id = c.id WHERE c.estado = 'abierta'`)).rows;
      const stockBajo = (await pool.query(`SELECT nombre, stock_actual, stock_minimo FROM v_stock_bajo LIMIT 8`)).rows;
      const cxc = (await pool.query(`SELECT COALESCE(sum(saldo), 0) AS total, count(*) FILTER (WHERE saldo > 0)::int AS clientes FROM v_saldos_clientes`)).rows[0];
      res.json({ hoy, totales: tot, porHora, top, porMetodo, cajas, stockBajo, cxc });
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------ resumen por rango
  r.get('/reportes/resumen', async (req, res, next) => {
    const desde = String(req.query.desde ?? '');
    const hasta = String(req.query.hasta ?? '');
    if (!FECHA.test(desde) || !FECHA.test(hasta)) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Fechas inválidas' });
    const rango = [desde, hasta];
    const W = `dia BETWEEN $1::date AND $2::date`;
    try {
      const totales = (await pool.query(
        `SELECT COALESCE(sum(monto_total) FILTER (WHERE estado='completada'), 0) AS ventas,
                count(*) FILTER (WHERE estado='completada')::int AS tickets,
                COALESCE(sum(monto_sin_itbis) FILTER (WHERE estado='completada'), 0) AS base,
                COALESCE(sum(total_itbis1) FILTER (WHERE estado='completada'), 0) AS itbis18,
                COALESCE(sum(total_itbis2) FILTER (WHERE estado='completada'), 0) AS itbis16,
                COALESCE(sum(total_itbis) FILTER (WHERE estado='completada'), 0) AS itbis,
                COALESCE(sum(total_descuento) FILTER (WHERE estado='completada'), 0) AS descuentos,
                count(*) FILTER (WHERE estado='anulada')::int AS anuladas,
                COALESCE(sum(monto_total) FILTER (WHERE estado='anulada'), 0) AS monto_anulado
           FROM v_ventas_detalle WHERE ${W}`, rango)).rows[0];
      const porDia = (await pool.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS dia, COALESCE(sum(v.monto_total), 0) AS total, count(v.id)::int AS tickets
           FROM generate_series($1::date, $2::date, '1 day') d
           LEFT JOIN v_ventas_detalle v ON v.dia = d AND v.estado = 'completada'
          GROUP BY d ORDER BY d`, rango)).rows;
      const porCajero = (await pool.query(
        `SELECT cajero, sum(monto_total) AS total, count(*)::int AS tickets
           FROM v_ventas_detalle WHERE ${W} AND estado = 'completada' GROUP BY cajero ORDER BY total DESC`, rango)).rows;
      const porMetodo = (await pool.query(
        `SELECT p.metodo, sum(p.monto) AS monto FROM pagos_venta p JOIN v_ventas_detalle v ON v.id = p.venta_id
          WHERE v.${W} AND v.estado = 'completada' GROUP BY p.metodo ORDER BY monto DESC`, rango)).rows;
      const cambio = (await pool.query(
        `SELECT COALESCE(sum(v.cambio), 0) AS c FROM ventas v JOIN v_ventas_detalle d ON d.id = v.id
          WHERE d.${W} AND v.estado = 'completada'`, rango)).rows[0].c;
      const ef = porMetodo.find((m) => m.metodo === 'efectivo');
      if (ef) ef.monto = (Number(ef.monto) - Number(cambio)).toFixed(2);
      const productos = (await pool.query(
        `SELECT d.codigo_interno, d.nombre, sum(d.cantidad) AS cantidad, sum(d.monto_item) AS base,
                sum(d.monto_item + d.itbis_item) AS total,
                sum(d.cantidad * p.costo) AS costo
           FROM detalles_venta d JOIN v_ventas_detalle v ON v.id = d.venta_id JOIN productos p ON p.id = d.producto_id
          WHERE v.${W} AND v.estado = 'completada'
          GROUP BY d.codigo_interno, d.nombre ORDER BY total DESC LIMIT 25`, rango)).rows;
      const comprobantes = (await pool.query(
        `SELECT tipo_ecf, estado, count(*)::int AS cantidad, sum(monto_total) AS monto
           FROM facturas_electronicas WHERE fecha_emision BETWEEN $1::date AND $2::date
          GROUP BY tipo_ecf, estado ORDER BY tipo_ecf`, rango)).rows;
      res.json({ desde, hasta, totales, porDia, porCajero, porMetodo, productos, comprobantes });
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------ 607 (ventas) en CSV
  // Columnas del Formato 607. Valida el archivo con la Herramienta de Envío de Datos de la DGII
  // antes de presentarlo; algunos contribuyentes con e-CF pueden tener reglas especiales.
  r.get('/reportes/607.csv', async (req, res, next) => {
    const mes = String(req.query.mes ?? '');
    if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Mes inválido (AAAA-MM)' });
    try {
      const { rows } = await pool.query(
        `SELECT f.encf, f.tipo_ecf, to_char(f.fecha_emision, 'YYYYMMDD') AS fecha, orig.encf AS ncf_modificado,
                c.identificacion, c.tipo_identificacion,
                v.monto_gravado_i1 + v.monto_gravado_i2 + v.monto_gravado_i3 + v.monto_exento AS monto, v.total_itbis AS itbis,
                COALESCE(sum(p.monto) FILTER (WHERE p.metodo = 'efectivo'), 0) - v.cambio AS efectivo,
                COALESCE(sum(p.monto) FILTER (WHERE p.metodo IN ('cheque','transferencia')), 0) AS cheque,
                COALESCE(sum(p.monto) FILTER (WHERE p.metodo = 'tarjeta'), 0) AS tarjeta,
                COALESCE(sum(p.monto) FILTER (WHERE p.metodo = 'credito'), 0) AS credito,
                COALESCE(sum(p.monto) FILTER (WHERE p.metodo = 'bono'), 0) AS bonos,
                COALESCE(sum(p.monto) FILTER (WHERE p.metodo = 'otro'), 0) AS otras
           FROM facturas_electronicas f
           LEFT JOIN facturas_electronicas orig ON orig.id = f.referencia_fe_id
           JOIN ventas v ON v.id = COALESCE(f.venta_id, orig.venta_id)
           JOIN clientes c ON c.id = v.cliente_id
           LEFT JOIN pagos_venta p ON p.venta_id = v.id
          WHERE to_char(f.fecha_emision, 'YYYY-MM') = $1 AND f.estado <> 'pendiente'
          GROUP BY f.id, orig.encf, c.identificacion, c.tipo_identificacion, v.id
          ORDER BY f.fecha_emision, f.encf`, [mes]);
      const tipoId: Record<string, string> = { RNC: '1', CEDULA: '2', PASAPORTE: '3' };
      const enc = ['RNC/Cédula o Pasaporte', 'Tipo Identificación', 'Número Comprobante Fiscal', 'NCF o Documento Modificado',
        'Tipo de Ingreso', 'Fecha Comprobante', 'Fecha de Retención', 'Monto Facturado', 'ITBIS Facturado',
        'ITBIS Retenido por Terceros', 'ITBIS Percibido', 'Retención Renta por Terceros', 'ISR Percibido',
        'Impuesto Selectivo al Consumo', 'Otros Impuestos/Tasas', 'Monto Propina Legal', 'Efectivo',
        'Cheque/ Transferencia/ Depósito', 'Tarjeta Débito/Crédito', 'Venta a Crédito', 'Bonos o Certificados de Regalo',
        'Permuta', 'Otras Formas de Ventas'];
      const n = (x: unknown) => Number(x).toFixed(2);
      const filas = rows.map((x) => [
        x.identificacion ?? '', x.identificacion ? tipoId[x.tipo_identificacion] ?? '' : '', x.encf, x.ncf_modificado ?? '',
        '01', x.fecha, '', n(x.monto), n(x.itbis), '', '', '', '', '', '', '',
        n(x.efectivo), n(x.cheque), n(x.tarjeta), n(x.credito), n(x.bonos), '', n(x.otras),
      ]);
      const csv = '﻿' + [enc, ...filas].map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="607-${mes}.csv"`);
      res.send(csv);
    } catch (e) { next(e); }
  });

  return r;
}
