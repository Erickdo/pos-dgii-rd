import { pool, withTransaction } from '../../db.js';
import { config } from '../../config.js';
import { cargarP12 } from './firma.js';
import { ClienteDGII, ErrorAutenticacion, ErrorDGII, ErrorRed, type RespuestaEstado } from './dgii.client.js';
import { nombreArchivo } from './ecf.builder.js';

/**
 * Worker de transmisión (patrón "outbox").
 *
 * La venta NUNCA espera a la DGII: queda firmada en `facturas_electronicas` y este proceso
 * la envía. Si no hay internet, el e-CF sigue en cola con backoff exponencial; eso ES la
 * contingencia por conectividad (envío diferido, plazo máximo 72 h).
 *
 * Varias instancias pueden correr a la vez: FOR UPDATE SKIP LOCKED evita dobles envíos.
 */

type Fila = {
  id: string; encf: string; tipo_ecf: string; estado: string; es_consumo_resumido: boolean;
  xml_firmado: string; xml_rfce_firmado: string | null; track_id: string | null;
  intentos: number; limite_envio: Date | null; rnc: string;
};

const ESTADOS_FINALES: Record<string, 'aceptado' | 'aceptado_condicional' | 'rechazado'> = {
  'Aceptado': 'aceptado',
  'Aceptado Condicional': 'aceptado_condicional',
  'Rechazado': 'rechazado',
};

/** Último resultado del worker (para el indicador "DGII en línea / contingencia"). */
export const estadoWorker = {
  ultimoIntento: null as string | null,
  ultimoExito: null as string | null,
  ultimoTipoError: null as 'red' | 'autenticacion' | 'otro' | null,
};

export async function procesarLote(dgii: ClienteDGII): Promise<number> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<Fila>(
      `SELECT f.id, f.encf, f.tipo_ecf, f.estado, f.es_consumo_resumido, f.xml_firmado,
              f.xml_rfce_firmado, f.track_id, f.intentos, f.limite_envio, e.rnc
         FROM facturas_electronicas f JOIN emisor e ON e.id = f.emisor_id
        WHERE f.estado IN ('firmado', 'enviado')
          AND (f.proximo_intento_en IS NULL OR f.proximo_intento_en <= now())
        ORDER BY f.limite_envio NULLS LAST, f.creado_en
        LIMIT $1
        FOR UPDATE OF f SKIP LOCKED`,
      [config.worker.loteMaximo],
    );

    if (rows.length) estadoWorker.ultimoIntento = new Date().toISOString();
    for (const f of rows) {  // (break si falla la autenticación)
      try {
        if (f.estado === 'firmado' && f.es_consumo_resumido) {
          // E32 < RD$250,000: se envía el resumen y la respuesta es inmediata
          const r = await dgii.enviarRFCE(f.xml_rfce_firmado!, nombreArchivo(f.rnc, f.encf));
          await registrarResultado(tx, f, r);
        } else if (f.estado === 'firmado') {
          const trackId = await dgii.enviarECF(f.xml_firmado, nombreArchivo(f.rnc, f.encf));
          await tx.query(
            `UPDATE facturas_electronicas
                SET estado = 'enviado', track_id = $2, intentos = intentos + 1,
                    proximo_intento_en = now() + interval '10 seconds', ultimo_error = NULL
              WHERE id = $1`, [f.id, trackId],
          );
          await evento(tx, f.id, 'enviado', { trackId });
        } else {
          const r = await dgii.consultarEstado(f.track_id!);
          if (r.estado === 'En Proceso') {
            await reprogramar(tx, f, 'En proceso en la DGII', 30_000);
          } else {
            await registrarResultado(tx, f, r);
          }
        }
        estadoWorker.ultimoExito = new Date().toISOString();
        estadoWorker.ultimoTipoError = null;
      } catch (e) {
        estadoWorker.ultimoTipoError = e instanceof ErrorRed ? 'red' : e instanceof ErrorAutenticacion ? 'autenticacion' : e instanceof ErrorDGII ? null : 'otro';
        if (e instanceof ErrorDGII) estadoWorker.ultimoExito = new Date().toISOString(); // la DGII respondió
        if (e instanceof ErrorAutenticacion) {
          // Problema del certificado/credenciales: afecta a TODO el lote, no a esta factura
          await reprogramar(tx, f, e.message, 5 * 60_000);
          await evento(tx, f.id, 'error_autenticacion', { status: e.status, cuerpo: e.cuerpo });
          for (const resto of rows.slice(rows.indexOf(f) + 1)) await reprogramar(tx, resto, e.message, 5 * 60_000);
          break;
        } else if (e instanceof ErrorRed) {
          // Sin internet / DGII caída → contingencia por conectividad, se reintenta
          await reprogramar(tx, f, e.message);
        } else if (e instanceof ErrorDGII) {
          await tx.query(
            `UPDATE facturas_electronicas SET estado = 'rechazado', respuesta_dgii = $2, ultimo_error = $3,
                    intentos = intentos + 1 WHERE id = $1`,
            [f.id, JSON.stringify(e.cuerpo ?? {}), e.message],
          );
          await evento(tx, f.id, 'error_dgii', { status: e.status, cuerpo: e.cuerpo });
        } else {
          await reprogramar(tx, f, (e as Error).message);
        }
      }
    }
    return rows.length;
  });
}

async function registrarResultado(tx: import('../../db.js').Tx, f: Fila, r: RespuestaEstado) {
  const estado = ESTADOS_FINALES[r.estado];
  if (!estado) return reprogramar(tx, f, `Estado desconocido: ${r.estado}`, 60_000);

  await tx.query(
    `UPDATE facturas_electronicas
        SET estado = $2, respuesta_dgii = $3, intentos = intentos + 1, proximo_intento_en = NULL,
            ultimo_error = $4
      WHERE id = $1`,
    [f.id, estado, JSON.stringify(r),
     estado === 'rechazado' ? (r.mensajes ?? []).map((m) => `${m.codigo}: ${m.valor}`).join(' | ') : null],
  );
  // Rechazado: requiere intervención (corregir datos). Si el RFCE indica
  // secuenciaUtilizada=false, el mismo e-NCF puede reenviarse corregido; si no, se emite uno nuevo.
  await evento(tx, f.id, estado, r);
}

async function reprogramar(tx: import('../../db.js').Tx, f: Fila, error: string, esperaMs?: number) {
  const backoff = esperaMs ?? Math.min(config.worker.backoffMaxMs, 5_000 * 2 ** Math.min(f.intentos, 10));
  await tx.query(
    `UPDATE facturas_electronicas
        SET intentos = intentos + 1, ultimo_error = $2,
            proximo_intento_en = now() + ($3 || ' milliseconds')::interval
      WHERE id = $1`,
    [f.id, error, String(backoff)],
  );
  const horasRestantes = f.limite_envio ? (f.limite_envio.getTime() - Date.now()) / 3_600_000 : Infinity;
  await evento(tx, f.id, horasRestantes < 12 ? 'alerta_plazo' : 'reintento', { error, horasRestantes });
}

const evento = (tx: import('../../db.js').Tx, id: string, tipo: string, detalle: unknown) =>
  tx.query(`INSERT INTO eventos_fe (factura_id, tipo, detalle) VALUES ($1, $2, $3)`, [id, tipo, JSON.stringify(detalle)]);

// ---------------------------------------------------------------- arranque
if (import.meta.url === `file://${process.argv[1]}`) {
  const f = cargarP12(config.certificado.rutaP12, config.certificado.clave);
  const dgii = new ClienteDGII(() => f);
  const ciclo = async () => {
    try {
      const n = await procesarLote(dgii);
      setTimeout(ciclo, n === config.worker.loteMaximo ? 0 : config.worker.intervaloMs);
    } catch (e) {
      console.error('[worker-fe]', e);
      setTimeout(ciclo, config.worker.intervaloMs);
    }
  };
  ciclo();
  process.on('SIGTERM', () => pool.end().then(() => process.exit(0)));
}
