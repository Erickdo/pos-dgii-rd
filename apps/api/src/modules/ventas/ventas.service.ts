import { Decimal } from 'decimal.js';
import type { Tx } from '../../db.js';
import { withTransaction } from '../../db.js';
import {
  calcularVenta, validarPagos, FORMA_PAGO_DGII,
  type LineaEntrada, type PagoEntrada, type MetodoPago,
} from './calculos.js';
import { construirECF, construirRFCE, extraerFechaHoraFirma, type DocumentoECF } from '../fiscal/ecf.builder.js';
import { firmarXml, type Firmante } from '../fiscal/firma.js';
import { urlTimbre } from '../fiscal/qr.js';

export type TipoVenta = '31' | '32' | '44' | '45';

export class ErrorNegocio extends Error {
  constructor(public codigo: string, mensaje: string, public status = 422) { super(mensaje); }
}

export interface SolicitudVenta {
  idempotencyKey: string;
  cajaId: string;
  usuarioId: string;
  clienteId?: string;                // vacío = consumidor final
  creditoFiscal?: boolean;           // compatibilidad: equivale a tipoComprobante '31'
  tipoComprobante?: TipoVenta;       // 32 consumo · 31 crédito fiscal · 44 regímenes especiales · 45 gubernamental
  items: { productoId: string; cantidad: string; descuentoMonto?: string }[];
  pagos: { metodo: MetodoPago; monto: string; referencia?: string; ultimos4?: string }[];
}

export interface ResultadoVenta {
  ventaId: string;
  encf: string;
  tipoECF: string;
  montoTotal: string;
  cambio: string;
  codigoSeguridad: string;
  urlQr: string;
  fechaHoraFirma: string;
  estadoFiscal: string;
  repetida: boolean;
}

const CONSUMIDOR_FINAL = '00000000-0000-0000-0000-000000000001';
const LIMITE_RESUMEN = new Decimal(250_000);

/**
 * Procesa una venta en UNA transacción ACID:
 *   1. Idempotencia y validación de caja/usuario
 *   2. Precios e impuestos desde la BD (nunca desde el navegador)
 *   3. Venta + detalle (el trigger descuenta stock y escribe el kardex) + pagos
 *   4. Toma del e-NCF de la secuencia autorizada (fila bloqueada, sin duplicados)
 *   5. Construcción y FIRMA del e-CF (local, no requiere internet)
 * Si algo falla, no queda venta, ni stock descontado, ni e-NCF consumido.
 *
 * La transmisión a la DGII ocurre DESPUÉS, en el worker: un corte de internet nunca
 * detiene la caja; el e-CF queda firmado y en cola (contingencia por conectividad).
 */
export async function procesarVenta(sol: SolicitudVenta, firmante: Firmante): Promise<ResultadoVenta> {
  return withTransaction(async (tx) => {
    // 1. Idempotencia: el mismo clic reintentado devuelve la misma venta
    const previa = await buscarPorIdempotencia(tx, sol.idempotencyKey);
    if (previa) return { ...previa, repetida: true };

    const caja = await tx.query(
      `SELECT c.id, s.emisor_id, s.id AS sucursal_id
         FROM cajas c
         JOIN terminales t ON t.id = c.terminal_id
         JOIN sucursales s ON s.id = t.sucursal_id
        WHERE c.id = $1 AND c.estado = 'abierta' AND c.usuario_id = $2
        FOR SHARE OF c`,
      [sol.cajaId, sol.usuarioId],
    );
    if (!caja.rowCount) throw new ErrorNegocio('CAJA_NO_ABIERTA', 'La caja no está abierta para este usuario', 409);
    const { emisor_id: emisorId } = caja.rows[0];

    // 2. Productos (precio e ITBIS vigentes en la BD)
    const tipoECF: TipoVenta = sol.tipoComprobante ?? (sol.creditoFiscal ? '31' : '32');
    const lineas = await cargarLineas(tx, sol.items, tipoECF);
    const { lineas: calc, totales } = calcularVenta(lineas);
    const pagos: PagoEntrada[] = sol.pagos.map((p) => ({ ...p, monto: new Decimal(p.monto) }));
    const { totalPagado, cambio } = validarPagos(totales.montoTotal, pagos);

    // 3. Cliente y tipo de comprobante
    const clienteId = sol.clienteId ?? CONSUMIDOR_FINAL;
    const cli = (await tx.query(
      `SELECT id, nombre, identificacion, tipo_identificacion, correo_fe, direccion, es_contribuyente, limite_credito
         FROM clientes WHERE id = $1 AND activo`, [clienteId],
    )).rows[0];
    if (!cli) throw new ErrorNegocio('CLIENTE_INVALIDO', 'Cliente inexistente o inactivo');

    const NOMBRES: Record<TipoVenta, string> = { '31': 'Crédito fiscal (E31)', '32': 'Consumo', '44': 'Régimen especial (E44)', '45': 'Gubernamental (E45)' };
    if (tipoECF === '31' && !cli.es_contribuyente) {
      throw new ErrorNegocio('E31_SIN_RNC', 'Crédito fiscal (E31) requiere un cliente con RNC/cédula registrado');
    }
    if ((tipoECF === '44' || tipoECF === '45') && cli.tipo_identificacion !== 'RNC') {
      throw new ErrorNegocio('REQUIERE_RNC', `${NOMBRES[tipoECF]} requiere un cliente con RNC`);
    }
    if (tipoECF === '32' && totales.montoTotal.gte(LIMITE_RESUMEN) && !cli.identificacion) {
      throw new ErrorNegocio('E32_REQUIERE_ID', 'Facturas de consumo desde RD$250,000 requieren identificar al comprador');
    }
    const aCredito = pagos.filter((p) => p.metodo === 'credito').reduce((s, p) => s.plus(p.monto), new Decimal(0));
    if (aCredito.gt(0)) {
      if (clienteId === CONSUMIDOR_FINAL) {
        throw new ErrorNegocio('CREDITO_SIN_CLIENTE', 'Las ventas a crédito requieren un cliente identificado');
      }
      const limite = new Decimal(cli.limite_credito);
      if (limite.lte(0)) throw new ErrorNegocio('SIN_CREDITO', `${cli.nombre} no tiene crédito autorizado`);
      const saldo = new Decimal((await tx.query(`SELECT saldo FROM v_saldos_clientes WHERE cliente_id = $1`, [clienteId])).rows[0]?.saldo ?? 0);
      if (saldo.plus(aCredito).gt(limite)) {
        throw new ErrorNegocio('LIMITE_CREDITO',
          `Excede el límite de crédito: debe RD$${saldo.toFixed(2)} de RD$${limite.toFixed(2)} autorizados`);
      }
    }

    // 4. Venta, detalle y pagos
    const venta = await tx.query(
      `INSERT INTO ventas (idempotency_key, caja_id, cliente_id, usuario_id,
              monto_gravado_i1, monto_gravado_i2, monto_gravado_i3, monto_exento,
              total_itbis1, total_itbis2, total_descuento, monto_total, total_pagado, cambio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, creado_en`,
      [sol.idempotencyKey, sol.cajaId, clienteId, sol.usuarioId,
       totales.montoGravadoI1.toFixed(2), totales.montoGravadoI2.toFixed(2), totales.montoGravadoI3.toFixed(2),
       totales.montoExento.toFixed(2), totales.totalItbis1.toFixed(2), totales.totalItbis2.toFixed(2),
       totales.totalDescuento.toFixed(2), totales.montoTotal.toFixed(2), totalPagado.toFixed(2), cambio.toFixed(2)],
    );
    const ventaId: string = venta.rows[0].id;
    const fechaEmision: Date = venta.rows[0].creado_en;

    // Inserción en lote del detalle. El trigger descuenta stock; si no alcanza, el CHECK
    // de productos aborta TODA la transacción (se traduce a error legible más abajo).
    await tx.query(
      `INSERT INTO detalles_venta (venta_id, numero_linea, producto_id, codigo_interno, nombre, es_servicio,
              unidad_medida, cantidad, precio_unitario, descuento_monto, monto_item, indicador_itbis, itbis_item)
       SELECT $1, * FROM unnest($2::smallint[], $3::uuid[], $4::text[], $5::text[], $6::bool[], $7::smallint[],
              $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::smallint[], $13::numeric[])`,
      [ventaId,
       calc.map((l) => l.numeroLinea), calc.map((l) => l.productoId), calc.map((l) => l.codigoInterno),
       calc.map((l) => l.nombre), calc.map((l) => l.esServicio), calc.map((l) => l.unidadMedida),
       calc.map((l) => l.cantidad.toString()), calc.map((l) => l.precioUnitario.toString()),
       calc.map((l) => l.descuentoMonto.toFixed(2)), calc.map((l) => l.montoItem.toFixed(2)),
       calc.map((l) => l.indicadorItbis), calc.map((l) => l.itbisItem.toFixed(2))],
    ).catch(traducirErrorStock);

    for (const p of pagos) {
      await tx.query(
        `INSERT INTO pagos_venta (venta_id, metodo, monto, referencia, ultimos4) VALUES ($1,$2,$3,$4,$5)`,
        [ventaId, p.metodo, p.monto.toFixed(2), p.referencia ?? null, p.ultimos4 ?? null],
      );
    }

    // 5. e-NCF de la secuencia autorizada (bloqueo de fila = sin duplicados entre cajas)
    const ncf = (await tx.query(`SELECT ncf, vence, restantes FROM tomar_ncf($1, 'E', $2)`, [emisorId, tipoECF])
      .catch((e) => { throw new ErrorNegocio('SECUENCIA', e.message, 409); })).rows[0];

    // 6. Construir y firmar el e-CF
    const emisor = (await tx.query(
      `SELECT rnc, razon_social, nombre_comercial, direccion, municipio, provincia, telefono, correo
         FROM emisor WHERE id = $1`, [emisorId],
    )).rows[0];

    // Forma de pago: se descuenta el cambio del efectivo para que sume el MontoTotal
    const formas = agruparFormasPago(pagos, cambio);

    const doc: DocumentoECF = {
      tipoECF,
      encf: ncf.ncf,
      fechaVencimientoSecuencia: ncf.vence,
      fechaEmision,
      tipoPago: pagos.some((p) => p.metodo === 'credito') ? 2 : 1,
      formasPago: formas,
      emisor: {
        rnc: emisor.rnc, razonSocial: emisor.razon_social, nombreComercial: emisor.nombre_comercial,
        direccion: emisor.direccion, municipio: emisor.municipio, provincia: emisor.provincia,
        telefono: emisor.telefono, correo: emisor.correo,
      },
      comprador: cli.identificacion
        ? { rnc: cli.identificacion, razonSocial: cli.nombre, correo: cli.correo_fe, direccion: cli.direccion }
        : null,
      lineas: calc,
      totales,
    };

    const xml = construirECF(doc);
    const { xmlFirmado, codigoSeguridad } = firmarXml(xml, firmante);
    const fechaHoraFirma = extraerFechaHoraFirma(xmlFirmado);

    const esResumen = tipoECF === '32' && totales.montoTotal.lt(LIMITE_RESUMEN);
    const xmlRfce = esResumen ? firmarXml(construirRFCE(doc, codigoSeguridad), firmante).xmlFirmado : null;

    const urlQr = urlTimbre({
      tipoECF, rncEmisor: emisor.rnc, rncComprador: cli.identificacion, encf: ncf.ncf,
      fechaEmision, montoTotal: totales.montoTotal, fechaHoraFirma, codigoSeguridad,
    });

    // 7. Registro fiscal en cola. limite_envio = 72 h (envío diferido por conectividad)
    const fe = await tx.query(
      `INSERT INTO facturas_electronicas (venta_id, emisor_id, tipo_ecf, encf, fecha_vencimiento_sec,
              es_consumo_resumido, monto_total, rnc_comprador, fecha_emision, fecha_hora_firma,
              codigo_seguridad, xml_firmado, xml_rfce_firmado, url_qr, estado, limite_envio, proximo_intento_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date, to_timestamp($10,'DD-MM-YYYY HH24:MI:SS'),
               $11,$12,$13,$14,'firmado', now() + interval '72 hours', now())
       RETURNING id`,
      [ventaId, emisorId, tipoECF, ncf.ncf, ncf.vence, esResumen, totales.montoTotal.toFixed(2),
       cli.identificacion, fechaEmision, fechaHoraFirma, codigoSeguridad, xmlFirmado, xmlRfce, urlQr],
    );
    await tx.query(
      `INSERT INTO eventos_fe (factura_id, tipo, detalle) VALUES ($1, 'firmado', $2)`,
      [fe.rows[0].id, { encf: ncf.ncf, restantesSecuencia: Number(ncf.restantes) }],
    );

    return {
      ventaId, encf: ncf.ncf, tipoECF, montoTotal: totales.montoTotal.toFixed(2), cambio: cambio.toFixed(2),
      codigoSeguridad, urlQr, fechaHoraFirma, estadoFiscal: 'firmado', repetida: false,
    };
  });
}


type Consultable = { query: Tx['query'] };

/** Lee precio, nombre e ITBIS vigentes desde la BD. Nunca se confía en precios del navegador. */
export async function cargarLineas(db: Consultable, items: SolicitudVenta['items'], tipo: TipoVenta = '32'): Promise<LineaEntrada[]> {
  const ids = [...new Set(items.map((i) => i.productoId))];
  const prod = await db.query(
    `SELECT id, codigo_interno, nombre, es_servicio, unidad_medida, precio_venta, indicador_itbis
       FROM productos WHERE id = ANY($1::uuid[]) AND activo`,
    [ids],
  );
  const porId = new Map(prod.rows.map((p: any) => [p.id, p]));
  return items.map((i, n) => {
    const p: any = porId.get(i.productoId);
    if (!p) throw new ErrorNegocio('PRODUCTO_INVALIDO', `Línea ${n + 1}: producto inexistente o inactivo`);
    return {
      productoId: p.id,
      codigoInterno: p.codigo_interno,
      nombre: p.nombre,
      esServicio: p.es_servicio,
      unidadMedida: p.unidad_medida,
      cantidad: new Decimal(i.cantidad),
      precioUnitario: new Decimal(p.precio_venta),
      descuentoMonto: new Decimal(i.descuentoMonto ?? 0),
      // E44 (regímenes especiales, p. ej. zonas francas): ventas exentas de ITBIS
      indicadorItbis: tipo === '44' ? 4 : p.indicador_itbis,
    };
  });
}

/** Totales oficiales (mismo cálculo que la venta) para mostrar en la pantalla de cobro. */
export async function cotizarVenta(db: Consultable, items: SolicitudVenta['items'], tipo: TipoVenta = '32') {
  const { lineas, totales } = calcularVenta(await cargarLineas(db, items, tipo));
  const s = (d: Decimal) => d.toFixed(2);
  return {
    lineas: lineas.map((l) => ({ productoId: l.productoId, montoItem: s(l.montoItem), itbis: s(l.itbisItem) })),
    totales: Object.fromEntries(Object.entries(totales).map(([k, v]) => [k, s(v as Decimal)])),
  };
}

// ---------------------------------------------------------------- auxiliares
async function buscarPorIdempotencia(tx: Tx, key: string): Promise<Omit<ResultadoVenta, 'repetida'> | null> {
  const r = await tx.query(
    `SELECT v.id, v.monto_total, v.cambio, f.encf, f.tipo_ecf, f.codigo_seguridad, f.url_qr,
            to_char(f.fecha_hora_firma, 'DD-MM-YYYY HH24:MI:SS') AS fhf, f.estado
       FROM ventas v JOIN facturas_electronicas f ON f.venta_id = v.id
      WHERE v.idempotency_key = $1`, [key],
  );
  if (!r.rowCount) return null;
  const v = r.rows[0];
  return {
    ventaId: v.id, encf: v.encf, tipoECF: v.tipo_ecf, montoTotal: v.monto_total, cambio: v.cambio,
    codigoSeguridad: v.codigo_seguridad, urlQr: v.url_qr, fechaHoraFirma: v.fhf, estadoFiscal: v.estado,
  };
}

function agruparFormasPago(pagos: PagoEntrada[], cambio: Decimal) {
  const acc = new Map<number, Decimal>();
  for (const p of pagos) {
    const cod = FORMA_PAGO_DGII[p.metodo];
    acc.set(cod, (acc.get(cod) ?? new Decimal(0)).plus(p.monto));
  }
  if (cambio.gt(0)) acc.set(1, acc.get(1)!.minus(cambio)); // el cambio siempre sale del efectivo
  return [...acc].filter(([, m]) => m.gt(0)).map(([codigo, monto]) => ({ codigo, monto }));
}

function traducirErrorStock(e: { constraint?: string; message: string }): never {
  if (e.constraint === 'chk_stock_no_negativo') {
    throw new ErrorNegocio('STOCK_INSUFICIENTE', 'Stock insuficiente para uno de los productos', 409);
  }
  throw e;
}
