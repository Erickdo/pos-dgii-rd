import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db.js';
import { requiereRol } from '../../auth.js';
import type { GestorCertificado } from '../fiscal/certificado.js';

export function configRouter(cert: GestorCertificado, alCambiarCertificado: () => void) {
  const r = Router();

  // Lectura para cualquier usuario: el POS necesita saber el ancho del ticket
  r.get('/config', async (_req, res, next) => {
    try {
      const rows = (await pool.query(`SELECT clave, valor FROM configuracion`)).rows;
      res.json(Object.fromEntries(rows.map((x) => [x.clave, x.valor])));
    } catch (e) { next(e); }
  });

  r.put('/admin/config/impresora', requiereRol('administrador'), async (req, res, next) => {
    const p = z.object({
      ancho: z.enum(['80', '58']),
      copias: z.coerce.number().int().min(1).max(3),
      mensajePie: z.string().max(120),
      imprimirAutomatico: z.boolean(),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Configuración de impresora inválida' });
    try {
      await pool.query(
        `INSERT INTO configuracion (clave, valor) VALUES ('impresora', $1)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [JSON.stringify(p.data)]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.get('/admin/certificado', requiereRol('administrador'), (_req, res) => res.json(cert.info()));

  // Subida del .p12 (base64). Se valida con la clave antes de reemplazar el actual.
  r.post('/admin/certificado', requiereRol('administrador'), (req, res) => {
    const p = z.object({ archivoBase64: z.string().min(100).max(2_000_000), clave: z.string().min(1).max(200) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: 'Selecciona el archivo .p12 y escribe su clave' });
    try {
      cert.instalar(Buffer.from(p.data.archivoBase64, 'base64'), p.data.clave);
      alCambiarCertificado();
      res.json(cert.info());
    } catch (e) {
      const m = (e as Error).message;
      res.status(422).json({
        error: 'CERTIFICADO',
        mensaje: /vencido/i.test(m) ? m : /password|MAC|Invalid/i.test(m) ? 'La clave del certificado es incorrecta' : `No se pudo leer el certificado: ${m}`,
      });
    }
  });

  return r;
}
