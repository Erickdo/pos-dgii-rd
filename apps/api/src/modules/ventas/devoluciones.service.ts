import { Decimal } from 'decimal.js';
import { withTransaction } from '../../db.js';
import type { LineaCalculada, Totales } from './calculos.js';
import { ErrorNegocio } from './ventas.service.js';
import { construirECF, extraerFechaHoraFirma, type DocumentoECF } from '../fiscal/ecf.builder.js';
import { firmarXml, type Firmante } from '../fiscal/firma.js';
import { urlTimbre } from '../fiscal/qr.js';

/**
 * Anulación total de una venta mediante Nota de Crédito Electrónica (E34).
 * El e-CF original NO se modifica (es inmutable); la E34 lo referencia con CodigoModificacion = 1.
 *
 * Efectivo: si la venta se cobró en una caja que sigue abierta, basta con marcarla anulada
 * (v_resumen_caja deja de contarla). Si esa caja ya cerró, el reembolso sale como "salida"
 * de la caja actual de quien anula.
 */
export async function anularVenta(p: {
  ventaId: string; usuarioId: string; autorizadoPor: string; motivo: string; cajaActualId?: string | null;
}, firmante: Firmante) {
  return withTransaction(async (tx) => {
    const v = (await tx.query(
      `SELECT v.*, f.id AS fe_id, f.encf, f.fecha_emision AS fe_fecha, f.emisor_id, f.tipo_ecf,
              c.identificacion AS cli_ident, c.nombre AS cli_nombre, c.correo_fe, ca.estado AS caja_estado
         FROM ventas v
         JOIN facturas_electronicas f ON f.venta_id = v.id
         JOIN clientes c ON c.id = v.cliente_id
         JOIN cajas ca ON ca.id = v.caja_id
        WHERE v.id = $1
        FOR UPDATE OF v`, [p.ventaId])).rows[0];
    if (!v) throw new ErrorNegocio('NO_ENCONTRADA', 'Venta no encontrada', 404);
    if (v.estado !== 'completada') throw new ErrorNegocio('YA_ANULADA', 'Esta venta ya fue anulada', 409);

    const det = (await tx.query(
      `SELECT * FROM detalles_venta WHERE venta_id = $1 ORDER BY numero_linea`, [p.ventaId])).rows;
    const lineas: LineaCalculada[] = det.map((d) => ({
      productoId: d.producto_id, codigoInterno: d.codigo_interno, nombre: d.nombre, esServicio: d.es_servicio,
      unidadMedida: d.unidad_medida, cantidad: new Decimal(d.cantidad), precioUnitario: new Decimal(d.precio_unitario),
      descuentoMonto: new Decimal(d.descuento_monto), indicadorItbis: d.indicador_itbis, numeroLinea: d.numero_linea,
      montoItem: new Decimal(d.monto_item), itbisItem: new Decimal(d.itbis_item),
    }));
    const D = (x: string) => new Decimal(x);
    const totales: Totales = {
      montoGravadoI1: D(v.monto_gravado_i1), montoGravadoI2: D(v.monto_gravado_i2), montoGravadoI3: D(v.monto_gravado_i3),
      montoExento: D(v.monto_exento), totalItbis1: D(v.total_itbis1), totalItbis2: D(v.total_itbis2),
      totalItbis: D(v.total_itbis1).plus(v.total_itbis2), totalDescuento: D(v.total_descuento), montoTotal: D(v.monto_total),
    };

    const ncf = (await tx.query(`SELECT ncf FROM tomar_ncf($1, 'E', '34')`, [v.emisor_id])
      .catch((e) => { throw new ErrorNegocio('SECUENCIA', `Secuencia E34: ${e.message}`, 409); })).rows[0];
    const emisor = (await tx.query(
      `SELECT rnc, razon_social, nombre_comercial, direccion, municipio, provincia, telefono, correo FROM emisor WHERE id = $1`,
      [v.emisor_id])).rows[0];

    const ahora = new Date();
    const doc: DocumentoECF = {
      tipoECF: '34', encf: ncf.ncf, fechaEmision: ahora, tipoPago: 1, formasPago: [],
      emisor: {
        rnc: emisor.rnc, razonSocial: emisor.razon_social, nombreComercial: emisor.nombre_comercial,
        direccion: emisor.direccion, municipio: emisor.municipio, provincia: emisor.provincia,
        telefono: emisor.telefono, correo: emisor.correo,
      },
      comprador: v.cli_ident ? { rnc: v.cli_ident, razonSocial: v.cli_nombre, correo: v.correo_fe } : null,
      lineas, totales,
      referencia: { ncfModificado: v.encf, fechaNcfModificado: new Date(v.fe_fecha), codigoModificacion: 1, razon: p.motivo },
    };
    const { xmlFirmado, codigoSeguridad } = firmarXml(construirECF(doc), firmante);
    const fechaHoraFirma = extraerFechaHoraFirma(xmlFirmado);
    const urlQr = urlTimbre({
      tipoECF: '34', rncEmisor: emisor.rnc, rncComprador: v.cli_ident, encf: ncf.ncf, fechaEmision: ahora,
      montoTotal: totales.montoTotal, fechaHoraFirma, codigoSeguridad,
    });

    const nc = (await tx.query(
      `INSERT INTO facturas_electronicas (emisor_id, tipo_ecf, encf, monto_total, rnc_comprador, fecha_emision,
              fecha_hora_firma, codigo_seguridad, xml_firmado, url_qr, estado, limite_envio, proximo_intento_en,
              referencia_fe_id, motivo)
       VALUES ($1,'34',$2,$3,$4,$5::date, to_timestamp($6,'DD-MM-YYYY HH24:MI:SS'), $7,$8,$9,'firmado',
               now() + interval '72 hours', now(), $10, $11)
       RETURNING id`,
      [v.emisor_id, ncf.ncf, totales.montoTotal.toFixed(2), v.cli_ident, ahora, fechaHoraFirma, codigoSeguridad,
       xmlFirmado, urlQr, v.fe_id, p.motivo])).rows[0];
    await tx.query(`INSERT INTO eventos_fe (factura_id, tipo, detalle) VALUES ($1,'nota_credito', $2)`,
      [nc.id, JSON.stringify({ modifica: v.encf, motivo: p.motivo, autorizadoPor: p.autorizadoPor })]);

    // Anula la venta: el trigger repone el stock y la saca de cuentas por cobrar y del cuadre
    await tx.query(
      `UPDATE ventas SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`,
      [p.ventaId, p.usuarioId, p.motivo]);

    // Dinero a devolver
    const pagos = (await tx.query(`SELECT metodo, SUM(monto) AS monto FROM pagos_venta WHERE venta_id = $1 GROUP BY metodo`, [p.ventaId])).rows;
    const efectivoNeto = new Decimal(pagos.find((x) => x.metodo === 'efectivo')?.monto ?? 0).minus(v.cambio);
    const otros = pagos.filter((x) => x.metodo !== 'efectivo' && x.metodo !== 'credito');

    let salidaRegistrada = false;
    if (efectivoNeto.gt(0) && v.caja_estado !== 'abierta') {
      if (!p.cajaActualId) {
        throw new ErrorNegocio('SIN_CAJA', 'Para devolver efectivo de una venta de un turno cerrado necesitas una caja abierta', 409);
      }
      await tx.query(
        `INSERT INTO movimientos_caja (caja_id, tipo, monto, motivo, usuario_id, autorizado_por)
         VALUES ($1,'salida',$2,$3,$4,$5)`,
        [p.cajaActualId, efectivoNeto.toFixed(2), `Devolución ${v.encf} (${ncf.ncf})`, p.usuarioId, p.autorizadoPor]);
      salidaRegistrada = true;
    }

    return {
      notaCredito: ncf.ncf, notaCreditoId: nc.id, facturaAnulada: v.encf, codigoSeguridad, urlQr,
      devolverEfectivo: efectivoNeto.gt(0) ? efectivoNeto.toFixed(2) : '0.00',
      salidaRegistrada,
      devolverPorOtroMedio: otros.map((o) => ({ metodo: o.metodo, monto: o.monto })),
    };
  });
}
