import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';

// ---------------------------------------------------------------- PIN / contraseña (scrypt)
export function hashSecreto(secreto: string): string {
  const sal = randomBytes(16);
  const h = scryptSync(secreto, sal, 32);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}

export function verificarSecreto(secreto: string, guardado: string | null): boolean {
  if (!guardado?.startsWith('scrypt$')) return false;
  const [, salHex, hHex] = guardado.split('$');
  const h = scryptSync(secreto, Buffer.from(salHex, 'hex'), 32);
  return timingSafeEqual(h, Buffer.from(hHex, 'hex'));
}

// ---------------------------------------------------------------- token de sesión firmado
// Clave persistida en disco: las sesiones sobreviven a un reinicio del servidor.
const RUTA_CLAVE = process.env.SESSION_KEY_PATH ?? join(process.cwd(), '.datos', 'session.key');
function claveSesion(): Buffer {
  if (process.env.SESSION_SECRET) return Buffer.from(process.env.SESSION_SECRET);
  if (!existsSync(RUTA_CLAVE)) {
    mkdirSync(dirname(RUTA_CLAVE), { recursive: true });
    writeFileSync(RUTA_CLAVE, randomBytes(32).toString('hex'));
  }
  return Buffer.from(readFileSync(RUTA_CLAVE, 'utf8').trim());
}
const CLAVE = claveSesion();
const DURACION_MS = 14 * 3_600_000; // un turno largo

export interface Sesion { id: string; nombre: string; rol: 'cajero' | 'administrador' | 'contador'; exp: number }

export function firmarToken(s: Omit<Sesion, 'exp'>): string {
  const cuerpo = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + DURACION_MS })).toString('base64url');
  const firma = createHmac('sha256', CLAVE).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

function leerToken(token: string): Sesion | null {
  const [cuerpo, firma] = token.split('.');
  if (!cuerpo || !firma) return null;
  const esperada = createHmac('sha256', CLAVE).update(cuerpo).digest('base64url');
  if (firma.length !== esperada.length || !timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  const s = JSON.parse(Buffer.from(cuerpo, 'base64url').toString()) as Sesion;
  return s.exp > Date.now() ? s : null;
}

export type ReqAuth = Request & { usuario: Sesion };

export function requiereSesion(req: Request, res: Response, next: NextFunction) {
  const h = req.header('authorization') ?? '';
  const s = h.startsWith('Bearer ') ? leerToken(h.slice(7)) : null;
  if (!s) return res.status(401).json({ error: 'SESION', mensaje: 'Sesión vencida, vuelve a entrar' });
  (req as ReqAuth).usuario = s;
  next();
}

export function requiereRol(...roles: Sesion['rol'][]) {
  return (req: Request, res: Response, next: NextFunction) =>
    roles.includes((req as ReqAuth).usuario.rol)
      ? next()
      : res.status(403).json({ error: 'PERMISO', mensaje: 'No tienes permiso para esta acción' });
}

/** Verifica el PIN de cualquier administrador activo (autorización de supervisor). */
export async function pinSupervisor(pin: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT id, pin_hash FROM usuarios WHERE rol = 'administrador' AND activo`);
  return rows.find((u) => verificarSecreto(pin, u.pin_hash))?.id ?? null;
}

/** Usuario de la sesión actual (lo coloca requiereSesion). */
export const usuarioDe = (req: Request): Sesion => (req as unknown as ReqAuth).usuario;
