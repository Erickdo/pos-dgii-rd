import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db.js';
import { cedulaValida, rncValido } from '../../validacion.js';

const COLS_PRODUCTO = `
  p.id, p.codigo_interno, p.codigo_barras, p.nombre, p.precio_venta, p.indicador_itbis,
  t.porcentaje AS tasa, round(p.precio_venta * (1 + t.porcentaje / 100), 2) AS precio_final,
  p.maneja_inventario, p.stock_actual, p.stock_minimo, c.nombre AS categoria`;

export function catalogoRouter() {
  const r = Router();

  r.get('/categorias', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT c.id, c.nombre, count(p.id)::int AS productos
           FROM categorias c LEFT JOIN productos p ON p.categoria_id = c.id AND p.activo
          GROUP BY c.id ORDER BY c.nombre`);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // Búsqueda: código de barras / código interno exacto primero, luego texto aproximado
  r.get('/productos', async (req, res, next) => {
    const q = String(req.query.q ?? '').trim();
    const cat = String(req.query.categoria ?? '');
    try {
      if (q) {
        const exacto = await pool.query(
          `SELECT ${COLS_PRODUCTO} FROM productos p JOIN tasas_itbis t ON t.indicador = p.indicador_itbis
             LEFT JOIN categorias c ON c.id = p.categoria_id
            WHERE p.activo AND (p.codigo_barras = $1 OR upper(p.codigo_interno) = upper($1))`, [q]);
        if (exacto.rowCount) return res.json({ exacto: true, productos: exacto.rows });
        const { rows } = await pool.query(
          `SELECT ${COLS_PRODUCTO} FROM productos p JOIN tasas_itbis t ON t.indicador = p.indicador_itbis
             LEFT JOIN categorias c ON c.id = p.categoria_id
            WHERE p.activo AND (unaccent(p.nombre) ILIKE '%' || unaccent($1) || '%' OR similarity(unaccent(p.nombre), unaccent($1)) > 0.25)
            ORDER BY (unaccent(p.nombre) ILIKE unaccent($1) || '%') DESC, similarity(unaccent(p.nombre), unaccent($1)) DESC, p.nombre LIMIT 40`, [q]);
        return res.json({ exacto: false, productos: rows });
      }
      const { rows } = await pool.query(
        `SELECT ${COLS_PRODUCTO} FROM productos p JOIN tasas_itbis t ON t.indicador = p.indicador_itbis
           LEFT JOIN categorias c ON c.id = p.categoria_id
          WHERE p.activo AND ($1 = '' OR p.categoria_id::text = $1)
          ORDER BY c.nombre NULLS LAST, p.nombre LIMIT 200`, [cat]);
      res.json({ exacto: false, productos: rows });
    } catch (e) { next(e); }
  });

  r.get('/productos/stock-bajo', async (_req, res, next) => {
    try { res.json((await pool.query(`SELECT * FROM v_stock_bajo LIMIT 50`)).rows); } catch (e) { next(e); }
  });

  r.get('/clientes', async (req, res, next) => {
    const q = String(req.query.q ?? '').trim();
    try {
      const { rows } = await pool.query(
        `SELECT c.id, c.nombre, c.tipo_identificacion, c.identificacion, c.correo_fe, c.es_contribuyente, c.telefono,
                c.limite_credito, COALESCE(s.saldo, 0) AS saldo, c.activo
           FROM clientes c LEFT JOIN v_saldos_clientes s ON s.cliente_id = c.id
          WHERE (c.activo OR $2) AND ($1 = '' OR unaccent(c.nombre) ILIKE '%' || unaccent($1) || '%' OR c.identificacion LIKE regexp_replace($1, '\\D', '', 'g') || '%')
          ORDER BY (c.id = '00000000-0000-0000-0000-000000000001') DESC, c.nombre LIMIT $3`, [q, req.query.todos === '1', req.query.todos === '1' ? 500 : 25]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  r.post('/clientes', async (req, res, next) => {
    const p = z.object({
      tipoIdentificacion: z.enum(['RNC', 'CEDULA', 'PASAPORTE']),
      identificacion: z.string().trim().min(3).max(20),
      nombre: z.string().trim().min(2).max(150),
      correo: z.string().email().optional().or(z.literal('')),
      esContribuyente: z.boolean().default(false),
      telefono: z.string().max(12).optional().or(z.literal('')),
      limiteCredito: z.coerce.number().min(0).default(0),
      forzar: z.boolean().default(false),   // guardar aunque el dígito verificador no coincida
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Revisa nombre, identificación y correo' });
    const d = p.data;
    const ident = d.tipoIdentificacion === 'PASAPORTE' ? d.identificacion : d.identificacion.replace(/\D/g, '');
    if (d.tipoIdentificacion === 'RNC' && ident.length !== 9) return res.status(422).json({ error: 'RNC', mensaje: 'El RNC debe tener 9 dígitos' });
    if (d.tipoIdentificacion === 'CEDULA' && ident.length !== 11) return res.status(422).json({ error: 'CEDULA', mensaje: 'La cédula debe tener 11 dígitos' });
    const dvOk = d.tipoIdentificacion === 'RNC' ? rncValido(ident) : d.tipoIdentificacion === 'CEDULA' ? cedulaValida(ident) : true;
    if (!dvOk && !d.forzar) {
      return res.status(422).json({ error: 'DIGITO_VERIFICADOR', mensaje: `El dígito verificador del ${d.tipoIdentificacion === 'RNC' ? 'RNC' : 'número de cédula'} no coincide. Revísalo.` });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO clientes (tipo_identificacion, identificacion, nombre, correo_fe, es_contribuyente, telefono, limite_credito)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, nombre, tipo_identificacion, identificacion, correo_fe, es_contribuyente, limite_credito, 0 AS saldo`,
        [d.tipoIdentificacion, ident, d.nombre.toUpperCase(), d.correo || null,
         d.esContribuyente && d.tipoIdentificacion !== 'PASAPORTE', d.telefono || null, d.limiteCredito]);
      res.status(201).json(rows[0]);
    } catch (e: any) {
      if (e.constraint === 'ux_clientes_ident') return res.status(409).json({ error: 'DUPLICADO', mensaje: 'Ya existe un cliente con esa identificación' });
      next(e);
    }
  });

  return r;
}
