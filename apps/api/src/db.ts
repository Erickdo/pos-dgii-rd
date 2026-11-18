import pg from 'pg';
import { config } from './config.js';

// NUMERIC llega como string: así se conserva la precisión y se convierte con Decimal.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  options: '-c search_path=pos,public -c timezone=America/Santo_Domingo',
});

export type Tx = pg.PoolClient;

/** Ejecuta fn en una transacción; hace ROLLBACK ante cualquier error. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
