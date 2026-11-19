import { pool } from './db.js';
import { hashSecreto } from './auth.js';

/** Cuenta con la que se entra la primera vez. Cambia el PIN en Configuración → Usuarios y accesos. */
export const CUENTA_INICIAL = { nombre: 'Erick', usuario: 'erickqdo', secreto: '010509' };

// Usuarios de prueba de versiones anteriores (admin / cajero1)
const DE_PRUEBA = ['admin', 'cajero1'];
const MARCA = 'cuentas_iniciales_v2';

/**
 * Se ejecuta una sola vez por instalación:
 *  1. Crea el administrador inicial si no existe.
 *  2. Quita los usuarios de prueba. Si ya tienen ventas o cajas registradas, no se pueden
 *     borrar sin romper el historial fiscal, así que se desactivan.
 * Si el administrador cambió después estas cuentas, no se vuelve a tocar nada.
 */
export async function asegurarCuentaInicial() {
  const hecho = await pool.query(`SELECT 1 FROM configuracion WHERE clave = $1`, [MARCA]);
  if (hecho.rowCount) return;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const existe = await db.query(`SELECT 1 FROM usuarios WHERE lower(usuario) = $1 OR lower(correo) = $1`, [CUENTA_INICIAL.usuario]);
    if (!existe.rowCount) {
      const su = (await db.query(`SELECT id FROM sucursales LIMIT 1`)).rows[0];
      const h = hashSecreto(CUENTA_INICIAL.secreto);
      await db.query(
        `INSERT INTO usuarios (nombre, usuario, password_hash, pin_hash, rol, sucursal_id) VALUES ($1,$2,$3,$3,'administrador',$4)`,
        [CUENTA_INICIAL.nombre, CUENTA_INICIAL.usuario, h, su?.id ?? null]);
      console.log(`[cuentas] Administrador inicial creado: ${CUENTA_INICIAL.usuario}`);
    }
    for (const u of DE_PRUEBA) {
      await db.query('SAVEPOINT quitar');
      try {
        const r = await db.query(`DELETE FROM usuarios WHERE usuario = $1`, [u]);
        if (r.rowCount) console.log(`[cuentas] Usuario de prueba eliminado: ${u}`);
      } catch {
        await db.query('ROLLBACK TO SAVEPOINT quitar');
        await db.query(`UPDATE usuarios SET activo = false WHERE usuario = $1`, [u]);
        console.log(`[cuentas] Usuario de prueba desactivado (tiene historial): ${u}`);
      }
    }
    await db.query(`INSERT INTO configuracion (clave, valor) VALUES ($1, 'true') ON CONFLICT (clave) DO NOTHING`, [MARCA]);
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('[cuentas] No se pudo preparar la cuenta inicial:', (e as Error).message);
  } finally { db.release(); }
}
