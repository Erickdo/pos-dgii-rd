import { Router } from 'express';
import { pool } from '../../db.js';
import { config } from '../../config.js';
import { requiereRol } from '../../auth.js';

export interface EstadoWorker { ultimoIntento: string | null; ultimoExito: string | null; ultimoTipoError: 'red' | 'autenticacion' | 'otro' | null }

export function fiscalRouter(opts: {
  infoCertificado: () => { esPrueba: boolean; vence: string; titular: string; origen: string; diasRestantes: number };
  estadoWorker: () => EstadoWorker;
  sincronizar: () => Promise<number>;
}) {
  const r = Router();

  // Resumen para el indicador superior y el monitor
  r.get('/fiscal/estado', async (_req, res, next) => {
    try {
      const cola = (await pool.query(
        `SELECT count(*) FILTER (WHERE estado IN ('pendiente','firmado','enviado'))::int AS pendientes,
                count(*) FILTER (WHERE estado = 'rechazado')::int AS rechazados,
                count(*) FILTER (WHERE estado IN ('aceptado','aceptado_condicional'))::int AS aceptados,
                count(*)::int AS total,
                min(limite_envio) FILTER (WHERE estado IN ('pendiente','firmado','enviado')) AS limite_mas_proximo,
                (SELECT ultimo_error FROM facturas_electronicas
                  WHERE estado IN ('firmado','enviado') AND ultimo_error IS NOT NULL
                  ORDER BY actualizado_en DESC LIMIT 1) AS ultimo_error
           FROM facturas_electronicas`)).rows[0];
      const secuencias = (await pool.query(`SELECT * FROM v_secuencias_estado ORDER BY comprobante`)).rows;
      const emisor = (await pool.query(`SELECT rnc, razon_social, nombre_comercial FROM emisor LIMIT 1`)).rows[0];
      const cert = opts.infoCertificado();
      res.json({
        ambiente: config.ambiente, emisor, cola, secuencias, worker: opts.estadoWorker(),
        certificadoPrueba: cert.esPrueba, certificado: cert,
      });
    } catch (e) { next(e); }
  });

  // Listado de e-CF con filtros
  r.get('/fiscal/comprobantes', async (req, res, next) => {
    const estado = String(req.query.estado ?? '');
    const q = String(req.query.q ?? '').trim().toUpperCase();
    const tipo = String(req.query.tipo ?? '');
    const grupos: Record<string, string[]> = {
      cola: ['pendiente', 'firmado', 'enviado'], aceptados: ['aceptado', 'aceptado_condicional'], rechazados: ['rechazado'],
    };
    try {
      const { rows } = await pool.query(
        `SELECT f.id, f.encf, f.tipo_ecf, f.estado, f.monto_total, f.rnc_comprador, f.codigo_seguridad, f.track_id,
                f.intentos, f.ultimo_error, f.es_consumo_resumido, f.motivo,
                to_char(f.fecha_hora_firma, 'DD-MM-YYYY HH24:MI') AS firmado,
                to_char(f.actualizado_en, 'DD-MM-YYYY HH24:MI') AS actualizado,
                extract(epoch FROM (f.limite_envio - now())) / 3600 AS horas_restantes,
                orig.encf AS modifica, c.nombre AS cliente, f.respuesta_dgii -> 'mensajes' AS mensajes
           FROM facturas_electronicas f
           LEFT JOIN facturas_electronicas orig ON orig.id = f.referencia_fe_id
           LEFT JOIN ventas v ON v.id = COALESCE(f.venta_id, orig.venta_id)
           LEFT JOIN clientes c ON c.id = v.cliente_id
          WHERE ($1::text[] IS NULL OR f.estado::text = ANY($1))
            AND ($2 = '' OR f.encf LIKE '%' || $2 || '%' OR f.rnc_comprador LIKE $2 || '%')
            AND ($3 = '' OR f.tipo_ecf = $3)
          ORDER BY f.creado_en DESC LIMIT 300`,
        [grupos[estado] ?? null, q, tipo]);
      res.json(rows);
    } catch (e) { next(e); }
  });

  // XML firmado para descargar / auditar
  r.get('/fiscal/comprobantes/:id/xml', async (req, res, next) => {
    try {
      const f = (await pool.query(
        `SELECT f.encf, f.xml_firmado, e.rnc FROM facturas_electronicas f JOIN emisor e ON e.id = f.emisor_id WHERE f.id = $1`,
        [req.params.id])).rows[0];
      if (!f?.xml_firmado) return res.status(404).json({ error: 'NO_ENCONTRADO', mensaje: 'XML no disponible' });
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${f.rnc}${f.encf}.xml"`);
      res.send(f.xml_firmado);
    } catch (e) { next(e); }
  });

  // Forzar sincronización manual: reintenta ya todo lo que está en cola
  r.post('/fiscal/sincronizar', requiereRol('administrador', 'contador'), async (_req, res, next) => {
    try {
      await pool.query(`UPDATE facturas_electronicas SET proximo_intento_en = now() WHERE estado IN ('firmado','enviado')`);
      const procesados = await opts.sincronizar();
      res.json({ procesados, worker: opts.estadoWorker() });
    } catch (e) { next(e); }
  });

  return r;
}
