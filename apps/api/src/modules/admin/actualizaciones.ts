import { Router } from 'express';
import { z } from 'zod';
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { requiereRol } from '../../auth.js';

/**
 * Actualizaciones desde el sistema.
 * Origen por defecto: un repositorio de GitHub (rama main). También admite una URL propia que
 * sirva version.json y paquete.zip. El servidor descarga y PREPARA la actualización; el lanzador
 * (lanzador.mjs) la aplica con respaldo y reversión automática al reiniciar.
 */

export interface Version { version: string; fecha: string; historial: { version: string; fecha: string; titulo?: string; cambios: string[] }[] }
interface Origen { tipo: 'github' | 'url'; repo?: string; rama?: string; url?: string; token?: string }

const ORIGEN_DEFECTO: Origen = { tipo: 'github', repo: 'Erickdo/pos-dgii-rd', rama: 'main' };

/** Compara versiones semánticas (1.10.0 > 1.9.3) */
export function esMasNueva(a: string, b: string) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0); }
  return false;
}

export function actualizacionesRouter(opts: { raiz: string; dirDatos: string; supervisado: boolean }) {
  const r = Router();
  const dirAct = join(opts.dirDatos, 'actualizacion');
  const rutaOrigen = join(opts.dirDatos, 'origen-actualizaciones.json');
  const rutaCache = join(dirAct, 'ultima-verificacion.json');

  const versionLocal = (): Version => JSON.parse(readFileSync(join(opts.raiz, 'version.json'), 'utf8'));
  const leerOrigen = (): Origen => {
    if (process.env.POS_ORIGEN_ACTUALIZACION) return { tipo: 'url', url: process.env.POS_ORIGEN_ACTUALIZACION };
    try { return { ...ORIGEN_DEFECTO, ...JSON.parse(readFileSync(rutaOrigen, 'utf8')) }; } catch { return ORIGEN_DEFECTO; }
  };
  const cabeceras = (o: Origen, accept: string): Record<string, string> => ({
    Accept: accept, 'User-Agent': 'pos-dgii-rd', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
  });
  const describir = (o: Origen) => (o.tipo === 'github' ? `github.com/${o.repo} (${o.rama})` : o.url!);

  async function obtenerRemota(o: Origen): Promise<Version> {
    const url = o.tipo === 'github'
      ? `https://api.github.com/repos/${o.repo}/contents/version.json?ref=${encodeURIComponent(o.rama ?? 'main')}`
      : `${o.url!.replace(/\/$/, '')}/version.json`;
    const res = await fetch(url, { headers: cabeceras(o, 'application/vnd.github.raw+json'), signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) throw new Error(o.token ? 'No se encontró el repositorio o la rama' : 'Repositorio no encontrado (si es privado, configura el token)');
    if (res.status === 401 || res.status === 403) throw new Error('GitHub rechazó el acceso: revisa el token');
    if (!res.ok) throw new Error(`El servidor de actualizaciones respondió ${res.status}`);
    return res.json() as Promise<Version>;
  }

  async function verificar() {
    const local = versionLocal();
    const o = leerOrigen();
    const remota = await obtenerRemota(o);
    const disponible = esMasNueva(remota.version, local.version);
    const datos = {
      verificadoEn: new Date().toISOString(), versionRemota: remota.version, disponible,
      novedades: remota.historial.filter((h) => esMasNueva(h.version, local.version)),
    };
    mkdirSync(dirAct, { recursive: true });
    writeFileSync(rutaCache, JSON.stringify(datos));
    return datos;
  }

  // Revisión automática cada 6 horas (silenciosa)
  const revisar = () => verificar().catch(() => {});
  setTimeout(revisar, 20_000);
  setInterval(revisar, 6 * 3_600_000);

  // ------------------------------------------------------------ público: versión instalada
  r.get('/version', (_req, res) => res.json({ version: versionLocal().version }));

  // ------------------------------------------------------------ estado (admin)
  r.get('/admin/actualizaciones', requiereRol('administrador'), (_req, res) => {
    const o = leerOrigen();
    const leer = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
    // La revisión guardada se compara SIEMPRE contra lo instalado (tras actualizar deja de mostrarse)
    const instalada = versionLocal().version;
    const cache = leer(rutaCache);
    const ultimaVerificacion = cache && {
      ...cache,
      disponible: esMasNueva(cache.versionRemota, instalada),
      novedades: (cache.novedades ?? []).filter((n: { version: string }) => esMasNueva(n.version, instalada)),
    };
    res.json({
      instalada: versionLocal(),
      origen: { tipo: o.tipo, repo: o.repo, rama: o.rama, url: o.url, tieneToken: !!o.token, descripcion: describir(o), fijadoPorVariable: !!process.env.POS_ORIGEN_ACTUALIZACION },
      ultimaVerificacion,
      ultimoResultado: leer(join(dirAct, 'resultado.json')),
      supervisado: opts.supervisado,
    });
  });

  r.put('/admin/actualizaciones/origen', requiereRol('administrador'), (req, res) => {
    const p = z.object({
      tipo: z.enum(['github', 'url']),
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'formato usuario/repositorio').optional(),
      rama: z.string().max(100).optional(),
      url: z.string().url().optional(),
      token: z.string().max(300).optional(),     // vacío = conservar el actual; "-" = borrar
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'VALIDACION', mensaje: p.error.issues[0].message });
    const actual = leerOrigen();
    const token = p.data.token === '-' ? undefined : p.data.token || actual.token;
    mkdirSync(opts.dirDatos, { recursive: true });
    writeFileSync(rutaOrigen, JSON.stringify({ ...p.data, token }), { mode: 0o600 });
    rmSync(rutaCache, { force: true });
    res.json({ ok: true });
  });

  r.post('/admin/actualizaciones/verificar', requiereRol('administrador'), async (_req, res) => {
    try { res.json(await verificar()); }
    catch (e) { res.status(502).json({ error: 'ORIGEN', mensaje: `No se pudo consultar ${describir(leerOrigen())}: ${(e as Error).message}` }); }
  });

  // ------------------------------------------------------------ descargar, preparar y reiniciar
  r.post('/admin/actualizaciones/instalar', requiereRol('administrador'), async (_req, res) => {
    if (!opts.supervisado) {
      return res.status(409).json({ error: 'SIN_LANZADOR', mensaje: 'Abre el POS con el acceso directo "Punto de Venta" (INICIAR-POS) para poder actualizar desde aquí.' });
    }
    const o = leerOrigen();
    const local = versionLocal();
    try {
      const remota = await obtenerRemota(o);
      if (!esMasNueva(remota.version, local.version)) return res.status(409).json({ error: 'AL_DIA', mensaje: 'Ya tienes la versión más reciente' });

      const url = o.tipo === 'github'
        ? `https://api.github.com/repos/${o.repo}/zipball/${encodeURIComponent(o.rama ?? 'main')}`
        : `${o.url!.replace(/\/$/, '')}/paquete.zip`;
      const r2 = await fetch(url, { headers: cabeceras(o, 'application/vnd.github+json'), redirect: 'follow', signal: AbortSignal.timeout(180_000) });
      if (!r2.ok) throw new Error(`descarga falló (${r2.status})`);
      const zip = new AdmZip(Buffer.from(await r2.arrayBuffer()));

      // GitHub mete todo en una carpeta "usuario-repo-sha/": se quita ese prefijo
      const entradas = zip.getEntries().filter((e) => !e.isDirectory);
      const prefijo = entradas.every((e) => e.entryName.startsWith(entradas[0].entryName.split('/')[0] + '/'))
        && !entradas.some((e) => e.entryName === 'version.json')
        ? entradas[0].entryName.split('/')[0] + '/' : '';

      const pendiente = join(dirAct, 'pendiente');
      rmSync(pendiente, { recursive: true, force: true });
      mkdirSync(pendiente, { recursive: true });
      for (const e of entradas) {
        const rel = e.entryName.slice(prefijo.length);
        if (!rel || /(^|\/)(node_modules|\.datos|\.respaldos|\.git)(\/|$)/.test(rel)) continue;
        const destino = normalize(join(pendiente, rel));
        if (!destino.startsWith(pendiente + sep)) throw new Error(`ruta no permitida en el paquete: ${rel}`);
        mkdirSync(join(destino, '..'), { recursive: true });
        writeFileSync(destino, e.getData());
      }
      for (const imprescindible of ['version.json', 'apps/api/package.json', 'apps/api/src/server.ts', 'apps/web/package.json']) {
        if (!existsSync(join(pendiente, imprescindible))) throw new Error(`el paquete no contiene ${imprescindible}`);
      }
      const vPaquete = JSON.parse(readFileSync(join(pendiente, 'version.json'), 'utf8')).version;
      if (vPaquete !== remota.version) throw new Error(`el paquete trae la versión ${vPaquete}, se esperaba ${remota.version}`);

      res.json({ ok: true, version: remota.version, mensaje: 'Actualización descargada. El sistema se reinicia para instalarla.' });
      setTimeout(() => process.exit(75), 800); // el lanzador aplica, verifica y, si falla, revierte
    } catch (e) {
      res.status(502).json({ error: 'DESCARGA', mensaje: `No se pudo preparar la actualización: ${(e as Error).message}` });
    }
  });

  return r;
}
