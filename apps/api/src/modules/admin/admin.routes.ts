import { Router } from 'express';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { pool, withTransaction } from '../../db.js';
import { hashSecreto, usuarioDe } from '../../auth.js';
import { secretoValido } from '../acceso/acceso.routes.js';

const TASAS: Record<number, number> = { 1: 0.18, 2: 0.16, 3: 0, 4: 0 };
const monto = z.coerce.number().min(0).max(1e12);

function errorPg(e: any, res: any, next: any) {
  const msgs: Record<string, string> = {
    productos_codigo_interno_key: 'Ya existe un producto con ese código',
    ux_productos_barras: 'Ya existe un producto con ese código de barras',
    categorias_nombre_key: 'Ya existe esa categoría',
    usuarios_usuario_key: 'Ese nombre de usuario ya existe',
    ux_usuarios_correo: 'Ya existe un usuario con ese correo',
    ux_secuencia_activa: 'Ya hay una secuencia activa para ese comprobante',
    chk_stock_no_negativo: 'El stock no puede quedar negativo',
    chk_ident: 'Identificación inválida (RNC 9 dígitos, cédula 11)',
  };
  if (e.constraint && msgs[e.constraint]) return res.status(409).json({ error: 'DUPLICADO', mensaje: msgs[e.constraint] });
  next(e);
}
const invalido = (res: any, error: z.ZodError) =>
  res.status(400).json({ error: 'VALIDACION', mensaje: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') });

export function adminRouter() {
  const r = Router();

  // ============================================================ productos
  r.get('/admin/productos', async (req, res, next) => {
    const q = String(req.query.q ?? '').trim();
    try {
      const { rows } = await pool.query(
        `SELECT p.*, c.nombre AS categoria, round(p.precio_venta * (1 + t.porcentaje / 100), 2) AS precio_final,
                CASE WHEN p.precio_venta > 0 THEN round((p.precio_venta - p.costo) / p.precio_venta * 100, 1) END AS margen
           FROM productos p JOIN tasas_itbis t ON t.indicador = p.indicador_itbis
           LEFT JOIN categorias c ON c.id = p.categoria_id
          WHERE ($1 = '' OR unaccent(p.nombre) ILIKE '%' || unaccent($1) || '%' OR p.codigo_interno ILIKE $1 || '%' OR p.codigo_barras = $1)
          ORDER BY p.activo DESC, c.nombre NULLS LAST, p.nombre`, [q]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  const ProductoSchema = z.object({
    codigoInterno: z.string().trim().min(1).max(35),
    codigoBarras: z.string().trim().max(30).optional().or(z.literal('')),
    nombre: z.string().trim().min(2).max(80),
    categoriaId: z.string().uuid().optional().or(z.literal('')),
    precioFinal: monto,                       // con ITBIS, como lo ve el cliente
    indicadorItbis: z.coerce.number().int().min(1).max(4),
    costo: monto.default(0),
    esServicio: z.boolean().default(false),
    manejaInventario: z.boolean().default(true),
    stockMinimo: monto.default(0),
    stockInicial: monto.optional(),
    activo: z.boolean().default(true),
  });

  const sinItbis = (final: number, ind: number) => new Decimal(final).div(1 + TASAS[ind]).toDecimalPlaces(4).toString();

  r.post('/admin/productos', async (req, res, next) => {
    const p = ProductoSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    const d = p.data;
    try {
      const id = await withTransaction(async (tx) => {
        const inv = d.manejaInventario && !d.esServicio;
        const stock = inv ? d.stockInicial ?? 0 : 0;
        const row = (await tx.query(
          `INSERT INTO productos (codigo_interno, codigo_barras, nombre, categoria_id, precio_venta, indicador_itbis, costo,
                  es_servicio, maneja_inventario, stock_actual, stock_minimo, activo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [d.codigoInterno.toUpperCase(), d.codigoBarras || null, d.nombre, d.categoriaId || null, sinItbis(d.precioFinal, d.indicadorItbis),
           d.indicadorItbis, d.costo, d.esServicio, inv, stock, inv ? d.stockMinimo : 0, d.activo])).rows[0];
        if (stock > 0) {
          await tx.query(
            `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_resultante, costo_unitario, referencia_tipo, usuario_id)
             VALUES ($1,'ajuste_pos',$2,$2,$3,'inventario_inicial',$4)`, [row.id, stock, d.costo, usuarioDe(req).id]);
        }
        return row.id;
      });
      res.status(201).json({ id });
    } catch (e) { errorPg(e, res, next); }
  });

  r.put('/admin/productos/:id', async (req, res, next) => {
    const p = ProductoSchema.omit({ stockInicial: true }).safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    const d = p.data;
    try {
      const antes = (await pool.query(`SELECT precio_venta, costo FROM productos WHERE id = $1`, [req.params.id])).rows[0];
      if (!antes) return res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'Producto no encontrado' });
      const inv = d.manejaInventario && !d.esServicio;
      await pool.query(
        `UPDATE productos SET codigo_interno=$2, codigo_barras=$3, nombre=$4, categoria_id=$5, precio_venta=$6, indicador_itbis=$7,
                costo=$8, es_servicio=$9, maneja_inventario=$10, stock_minimo=$11, activo=$12, actualizado_en=now()
          WHERE id = $1`,
        [req.params.id, d.codigoInterno.toUpperCase(), d.codigoBarras || null, d.nombre, d.categoriaId || null,
         sinItbis(d.precioFinal, d.indicadorItbis), d.indicadorItbis, d.costo, d.esServicio, inv, inv ? d.stockMinimo : 0, d.activo]);
      await pool.query(
        `INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, antes, despues) VALUES ($1,'producto.editar','producto',$2,$3,$4)`,
        [usuarioDe(req).id, req.params.id, JSON.stringify(antes), JSON.stringify(d)]);
      res.json({ ok: true });
    } catch (e) { errorPg(e, res, next); }
  });

  /**
   * Eliminar producto. Si ya se vendió o se compró, borrarlo rompería facturas y el kardex:
   * en ese caso responde 409 con `tieneHistorial` y la interfaz ofrece desactivarlo.
   * Con ?desactivar=1 lo marca inactivo (deja de salir en el POS, conserva su historial).
   */
  r.delete('/admin/productos/:id', async (req, res, next) => {
    const id = req.params.id;
    try {
      const prod = (await pool.query(`SELECT id, nombre, activo FROM productos WHERE id = $1`, [id])).rows[0];
      if (!prod) return res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'Producto no encontrado' });
      const uso = (await pool.query(
        `SELECT (SELECT count(*) FROM detalles_venta WHERE producto_id = $1)::int AS ventas,
                (SELECT count(*) FROM compras_detalle WHERE producto_id = $1)::int AS compras,
                (SELECT count(*) FROM movimientos_inventario WHERE producto_id = $1 AND referencia_tipo IS DISTINCT FROM 'inventario_inicial')::int AS movimientos`,
        [id])).rows[0];
      const tieneHistorial = uso.ventas + uso.compras + uso.movimientos > 0;
      if (req.query.desactivar === '1') {
        await pool.query(`UPDATE productos SET activo = false, actualizado_en = now() WHERE id = $1`, [id]);
        await pool.query(`INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, antes) VALUES ($1,'producto.desactivar','producto',$2,$3)`,
          [usuarioDe(req).id, id, JSON.stringify(prod)]);
        return res.json({ ok: true, desactivado: true });
      }
      if (tieneHistorial) {
        return res.status(409).json({
          error: 'CON_HISTORIAL', tieneHistorial: true, uso,
          mensaje: `«${prod.nombre}» tiene ${uso.ventas} venta(s), ${uso.compras} compra(s) y ${uso.movimientos} movimiento(s). Para no perder ese historial se puede desactivar.`,
        });
      }
      await withTransaction(async (tx) => {
        await tx.query(`DELETE FROM movimientos_inventario WHERE producto_id = $1`, [id]);   // solo el inventario inicial
        await tx.query(`DELETE FROM productos WHERE id = $1`, [id]);
        await tx.query(`INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, antes) VALUES ($1,'producto.eliminar','producto',$2,$3)`,
          [usuarioDe(req).id, id, JSON.stringify(prod)]);
      });
      res.json({ ok: true, eliminado: true });
    } catch (e) { errorPg(e, res, next); }
  });

  // ============================================================ categorías
  r.get('/admin/categorias', async (_req, res, next) => {
    try {
      res.json((await pool.query(
        `SELECT c.id, c.nombre, count(p.id)::int AS productos, count(p.id) FILTER (WHERE p.activo)::int AS activos
           FROM categorias c LEFT JOIN productos p ON p.categoria_id = c.id
          GROUP BY c.id ORDER BY c.nombre`)).rows);
    } catch (e) { next(e); }
  });
  /** Eliminar categoría. Si tiene productos, pide a qué categoría pasarlos (?reasignarA=<id> o 'ninguna'). */
  r.delete('/admin/categorias/:id', async (req, res, next) => {
    const id = req.params.id;
    const destino = typeof req.query.reasignarA === 'string' ? req.query.reasignarA : undefined;
    try {
      const cat = (await pool.query(`SELECT * FROM categorias WHERE id = $1`, [id])).rows[0];
      if (!cat) return res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'Categoría no encontrada' });
      const n = Number((await pool.query(`SELECT count(*) FROM productos WHERE categoria_id = $1`, [id])).rows[0].count);
      if (n > 0 && !destino) {
        return res.status(409).json({ error: 'CON_PRODUCTOS', productos: n, mensaje: `«${cat.nombre}» tiene ${n} producto(s). Elige a qué categoría pasarlos.` });
      }
      if (destino && destino !== 'ninguna') {
        if (destino === id) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Elige una categoría distinta' });
        const ok = (await pool.query(`SELECT 1 FROM categorias WHERE id = $1`, [destino])).rowCount;
        if (!ok) return res.status(400).json({ error: 'VALIDACION', mensaje: 'La categoría de destino no existe' });
      }
      await withTransaction(async (tx) => {
        if (n > 0) await tx.query(`UPDATE productos SET categoria_id = $2, actualizado_en = now() WHERE categoria_id = $1`, [id, destino === 'ninguna' ? null : destino]);
        await tx.query(`DELETE FROM categorias WHERE id = $1`, [id]);
        await tx.query(`INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, antes, despues) VALUES ($1,'categoria.eliminar','categoria',$2,$3,$4)`,
          [usuarioDe(req).id, id, JSON.stringify(cat), JSON.stringify({ reasignados: n, destino: destino ?? null })]);
      });
      res.json({ ok: true, reasignados: n });
    } catch (e) { errorPg(e, res, next); }
  });
  r.post('/admin/categorias', async (req, res, next) => {
    const p = z.object({ nombre: z.string().trim().min(2).max(60) }).safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    try { res.status(201).json((await pool.query(`INSERT INTO categorias (nombre) VALUES ($1) RETURNING *`, [p.data.nombre])).rows[0]); }
    catch (e) { errorPg(e, res, next); }
  });
  r.put('/admin/categorias/:id', async (req, res, next) => {
    const p = z.object({ nombre: z.string().trim().min(2).max(60) }).safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    try { await pool.query(`UPDATE categorias SET nombre = $2 WHERE id = $1`, [req.params.id, p.data.nombre]); res.json({ ok: true }); }
    catch (e) { errorPg(e, res, next); }
  });

  // ============================================================ usuarios
  r.get('/admin/usuarios', async (_req, res, next) => {
    try {
      res.json((await pool.query(
        `SELECT id, nombre, usuario, correo, rol, activo, to_char(ultimo_acceso, 'DD-MM-YYYY HH24:MI') AS ultimo_acceso
           FROM usuarios ORDER BY activo DESC, rol, nombre`)).rows);
    } catch (e) { next(e); }
  });

  const UsuarioSchema = z.object({
    nombre: z.string().trim().min(2).max(100),
    usuario: z.string().trim().min(3).max(50).regex(/^[a-z0-9._-]+$/i, 'solo letras, números, punto o guion'),
    rol: z.enum(['cajero', 'administrador', 'contador']),
    correo: z.string().trim().email('correo inválido').max(120).optional().or(z.literal('')),
    pin: z.string().refine(secretoValido, 'usa un PIN de 4 a 6 dígitos o una contraseña de 6+ caracteres con letras').optional().or(z.literal('')),
    activo: z.boolean().default(true),
  });

  r.post('/admin/usuarios', async (req, res, next) => {
    const p = UsuarioSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    if (!p.data.pin) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Asigna un PIN o una contraseña' });
    try {
      const h = hashSecreto(p.data.pin);
      const { rows } = await pool.query(
        `INSERT INTO usuarios (nombre, usuario, password_hash, pin_hash, rol, activo, correo) VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id`,
        [p.data.nombre, p.data.usuario.toLowerCase(), h, p.data.rol, p.data.activo, p.data.correo ? p.data.correo.toLowerCase() : null]);
      res.status(201).json(rows[0]);
    } catch (e) { errorPg(e, res, next); }
  });

  r.put('/admin/usuarios/:id', async (req, res, next) => {
    const p = UsuarioSchema.safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    const yo = usuarioDe(req);
    if (req.params.id === yo.id && (!p.data.activo || p.data.rol !== 'administrador')) {
      return res.status(409).json({ error: 'PROPIO', mensaje: 'No puedes desactivarte ni quitarte el rol de administrador' });
    }
    try {
      await pool.query(
        `UPDATE usuarios SET nombre=$2, usuario=$3, rol=$4, activo=$5, correo=$6 ${p.data.pin ? ', pin_hash=$7, password_hash=$7' : ''} WHERE id=$1`,
        [req.params.id, p.data.nombre, p.data.usuario.toLowerCase(), p.data.rol, p.data.activo, p.data.correo ? p.data.correo.toLowerCase() : null, ...(p.data.pin ? [hashSecreto(p.data.pin)] : [])]);
      res.json({ ok: true });
    } catch (e) { errorPg(e, res, next); }
  });

  // ============================================================ datos del negocio
  r.get('/admin/emisor', async (_req, res, next) => {
    try { res.json((await pool.query(`SELECT rnc, razon_social, nombre_comercial, direccion, telefono, correo, ambiente FROM emisor LIMIT 1`)).rows[0]); }
    catch (e) { next(e); }
  });
  r.put('/admin/emisor', async (req, res, next) => {
    const p = z.object({
      rnc: z.string().regex(/^\d{9}(\d{2})?$/, 'RNC de 9 dígitos o cédula de 11'),
      razonSocial: z.string().trim().min(2).max(150),
      nombreComercial: z.string().trim().max(150).optional().or(z.literal('')),
      direccion: z.string().trim().min(3).max(100),
      telefono: z.string().trim().max(12).optional().or(z.literal('')),
      correo: z.string().email().optional().or(z.literal('')),
    }).safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    const d = p.data;
    try {
      await pool.query(
        `UPDATE emisor SET rnc=$1, razon_social=$2, nombre_comercial=$3, direccion=$4, telefono=$5, correo=$6`,
        [d.rnc, d.razonSocial.toUpperCase(), d.nombreComercial || null, d.direccion, d.telefono || null, d.correo || null]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ============================================================ secuencias autorizadas
  r.get('/admin/secuencias', async (_req, res, next) => {
    try {
      res.json((await pool.query(
        `SELECT id, serie || tipo AS comprobante, desde, hasta, ultimo_usado, hasta - ultimo_usado AS restantes,
                fecha_vencimiento, numero_autorizacion, activa
           FROM secuencias_ncf ORDER BY activa DESC, serie, tipo, creado_en DESC`)).rows);
    } catch (e) { next(e); }
  });
  r.post('/admin/secuencias', async (req, res, next) => {
    const p = z.object({
      comprobante: z.enum(['E31', 'E32', 'E33', 'E34', 'B01', 'B02', 'B04']),
      desde: z.coerce.number().int().positive(),
      hasta: z.coerce.number().int().positive(),
      fechaVencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
      numeroAutorizacion: z.string().max(40).optional(),
    }).safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    const d = p.data;
    if (d.hasta < d.desde) return res.status(400).json({ error: 'VALIDACION', mensaje: '"Hasta" debe ser mayor que "desde"' });
    const [serie, tipo] = [d.comprobante[0], d.comprobante.slice(1)];
    try {
      await withTransaction(async (tx) => {
        const emisor = (await tx.query(`SELECT id FROM emisor LIMIT 1`)).rows[0];
        await tx.query(`UPDATE secuencias_ncf SET activa = false WHERE emisor_id = $1 AND serie = $2 AND tipo = $3 AND activa`, [emisor.id, serie, tipo]);
        await tx.query(
          `INSERT INTO secuencias_ncf (emisor_id, serie, tipo, desde, hasta, ultimo_usado, fecha_vencimiento, numero_autorizacion)
           VALUES ($1,$2,$3,$4,$5,$4 - 1,$6,$7)`,
          [emisor.id, serie, tipo, d.desde, d.hasta, d.fechaVencimiento || null, d.numeroAutorizacion || null]);
      });
      res.status(201).json({ ok: true });
    } catch (e) { errorPg(e, res, next); }
  });

  // ============================================================ clientes (crédito)
  r.put('/admin/clientes/:id', async (req, res, next) => {
    const p = z.object({
      nombre: z.string().trim().min(2).max(150),
      correo: z.string().email().optional().or(z.literal('')),
      telefono: z.string().max(12).optional().or(z.literal('')),
      esContribuyente: z.boolean(),
      limiteCredito: monto,
      activo: z.boolean().default(true),
    }).safeParse(req.body);
    if (!p.success) return invalido(res, p.error);
    const d = p.data;
    try {
      await pool.query(
        `UPDATE clientes SET nombre=$2, correo_fe=$3, telefono=$4, es_contribuyente=$5 AND tipo_identificacion IN ('RNC','CEDULA'),
                limite_credito=$6, activo=$7 WHERE id=$1 AND id <> '00000000-0000-0000-0000-000000000001'`,
        [req.params.id, d.nombre.toUpperCase(), d.correo || null, d.telefono || null, d.esContribuyente, d.limiteCredito, d.activo]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return r;
}
