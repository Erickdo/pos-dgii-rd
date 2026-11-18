import { Decimal } from 'decimal.js';
import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { LineaCalculada, Totales } from '../ventas/calculos.js';

/**
 * Construye el XML del e-CF (Formato e-CF v1.0) y del RFCE.
 *
 * IMPORTANTE: el XSD de la DGII es una <xs:sequence>, el ORDEN de los nodos importa y los
 * nodos opcionales vacíos NO deben aparecer. Valida cada tipo contra el XSD oficial
 * (e-CF 31 v.1.0.xsd, e-CF 32 v.1.0.xsd, RFCE 32 v.1.0.xsd ...) en CI con xmllint.
 */

export interface DatosEmisor {
  rnc: string;
  razonSocial: string;
  nombreComercial?: string | null;
  direccion: string;
  municipio?: string | null;
  provincia?: string | null;
  telefono?: string | null;
  correo?: string | null;
}

export interface DatosComprador {
  rnc?: string | null;          // RNC (9) o cédula (11)
  razonSocial?: string | null;
  correo?: string | null;
  direccion?: string | null;
}

export interface FormaPagoXml { codigo: number; monto: Decimal }

export interface DocumentoECF {
  tipoECF: '31' | '32' | '33' | '34' | '44' | '45';
  encf: string;
  fechaVencimientoSecuencia?: Date | null; // obligatoria en E31, E33, E44 y E45
  fechaEmision: Date;
  tipoPago: 1 | 2;                        // 1 contado, 2 crédito
  formasPago: FormaPagoXml[];
  emisor: DatosEmisor;
  comprador?: DatosComprador | null;
  lineas: LineaCalculada[];
  totales: Totales;
  /** Solo E33/E34: comprobante que se modifica */
  referencia?: {
    ncfModificado: string;
    fechaNcfModificado: Date;
    codigoModificacion: 1 | 2 | 3 | 4; // 1 anula, 2 corrige texto, 3 corrige montos, 4 reemplazo por contingencia
    razon: string;
  } | null;
}

// ---------------------------------------------------------------- formatos DGII
const TZ = 'America/Santo_Domingo';
const partes = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );

/** dd-MM-yyyy */
export const fechaDGII = (d: Date) => { const p = partes(d); return `${p.day}-${p.month}-${p.year}`; };
/** dd-MM-yyyy HH:mm:ss */
export const fechaHoraDGII = (d: Date) => { const p = partes(d); return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`; };

const m2 = (d: Decimal) => d.toFixed(2);
const qty = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);
const precio = (d: Decimal) => d.toDecimalPlaces(4).toFixed(4);
/** Limpia y recorta texto (los campos tienen longitudes máximas en el formato) */
const txt = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

const opt = (n: XMLBuilder, tag: string, v: string | null | undefined) => {
  if (v !== null && v !== undefined && v !== '') n.ele(tag).txt(v);
};

// ---------------------------------------------------------------- bloques comunes
function idDoc(n: XMLBuilder, d: DocumentoECF, resumen = false) {
  const id = n.ele('IdDoc');
  id.ele('TipoeCF').txt(d.tipoECF);
  id.ele('eNCF').txt(d.encf);
  if (!resumen && ['31', '33', '44', '45'].includes(d.tipoECF)) {
    if (!d.fechaVencimientoSecuencia) throw new Error(`E${d.tipoECF} requiere FechaVencimientoSecuencia`);
    id.ele('FechaVencimientoSecuencia').txt(fechaDGII(d.fechaVencimientoSecuencia));
  }
  if (!resumen && d.tipoECF === '34') {
    // 0 = emitida dentro de los 30 días de la factura original; 1 = después (sin derecho a rebajar ITBIS)
    const dias = d.referencia ? (d.fechaEmision.getTime() - d.referencia.fechaNcfModificado.getTime()) / 86_400_000 : 0;
    id.ele('IndicadorNotaCredito').txt(dias <= 30 ? '0' : '1');
  }
  const hayGravado = d.totales.montoGravadoI1.plus(d.totales.montoGravadoI2).plus(d.totales.montoGravadoI3).gt(0);
  if (!resumen && hayGravado) id.ele('IndicadorMontoGravado').txt('0'); // 0 = precios SIN ITBIS
  id.ele('TipoIngresos').txt('01');                                    // 01 ingresos por operaciones
  id.ele('TipoPago').txt(String(d.tipoPago));
  if (d.formasPago.length) {
    const t = id.ele('TablaFormasPago');
    for (const fp of d.formasPago) {
      const f = t.ele('FormaDePago');
      f.ele('FormaPago').txt(String(fp.codigo));
      f.ele('MontoPago').txt(m2(fp.monto));
    }
  }
}

function totales(n: XMLBuilder, t: Totales) {
  const x = n.ele('Totales');
  const gravadoTotal = t.montoGravadoI1.plus(t.montoGravadoI2).plus(t.montoGravadoI3);
  if (gravadoTotal.gt(0)) x.ele('MontoGravadoTotal').txt(m2(gravadoTotal));
  if (t.montoGravadoI1.gt(0)) x.ele('MontoGravadoI1').txt(m2(t.montoGravadoI1));
  if (t.montoGravadoI2.gt(0)) x.ele('MontoGravadoI2').txt(m2(t.montoGravadoI2));
  if (t.montoGravadoI3.gt(0)) x.ele('MontoGravadoI3').txt(m2(t.montoGravadoI3));
  if (t.montoExento.gt(0)) x.ele('MontoExento').txt(m2(t.montoExento));
  if (t.montoGravadoI1.gt(0)) x.ele('ITBIS1').txt('18');
  if (t.montoGravadoI2.gt(0)) x.ele('ITBIS2').txt('16');
  if (t.montoGravadoI3.gt(0)) x.ele('ITBIS3').txt('0');
  if (gravadoTotal.gt(0)) {
    x.ele('TotalITBIS').txt(m2(t.totalItbis));
    if (t.montoGravadoI1.gt(0)) x.ele('TotalITBIS1').txt(m2(t.totalItbis1));
    if (t.montoGravadoI2.gt(0)) x.ele('TotalITBIS2').txt(m2(t.totalItbis2));
    if (t.montoGravadoI3.gt(0)) x.ele('TotalITBIS3').txt('0.00');
  }
  x.ele('MontoTotal').txt(m2(t.montoTotal));
}

function comprador(n: XMLBuilder, c: DatosComprador | null | undefined, obligatorio: boolean) {
  if (!c?.rnc && !obligatorio) return;
  if (!c?.rnc || !c.razonSocial) throw new Error('Este comprobante requiere RNC/cédula y razón social del comprador');
  const x = n.ele('Comprador');
  x.ele('RNCComprador').txt(c.rnc);
  x.ele('RazonSocialComprador').txt(txt(c.razonSocial, 150));
  opt(x, 'CorreoComprador', c.correo ?? undefined);
  opt(x, 'DireccionComprador', c.direccion ? txt(c.direccion, 100) : undefined);
}

// ---------------------------------------------------------------- e-CF completo
export function construirECF(d: DocumentoECF): string {
  const doc = create({ version: '1.0', encoding: 'utf-8' });
  const ecf = doc.ele('ECF');
  const enc = ecf.ele('Encabezado');
  enc.ele('Version').txt('1.0');
  idDoc(enc, d);

  const em = enc.ele('Emisor');
  em.ele('RNCEmisor').txt(d.emisor.rnc);
  em.ele('RazonSocialEmisor').txt(txt(d.emisor.razonSocial, 150));
  opt(em, 'NombreComercial', d.emisor.nombreComercial ? txt(d.emisor.nombreComercial, 150) : undefined);
  em.ele('DireccionEmisor').txt(txt(d.emisor.direccion, 100));
  opt(em, 'Municipio', d.emisor.municipio ?? undefined);
  opt(em, 'Provincia', d.emisor.provincia ?? undefined);
  if (d.emisor.telefono) em.ele('TablaTelefonoEmisor').ele('TelefonoEmisor').txt(d.emisor.telefono);
  opt(em, 'CorreoEmisor', d.emisor.correo ?? undefined);
  em.ele('FechaEmision').txt(fechaDGII(d.fechaEmision));

  // E31/E44/E45 siempre llevan comprador; E32 solo desde RD$250,000 (o si el cliente se identificó)
  const obligatorio = ['31', '44', '45'].includes(d.tipoECF) || (d.tipoECF === '32' && d.totales.montoTotal.gte(250_000));
  comprador(enc, d.comprador, obligatorio);
  totales(enc, d.totales);

  const det = ecf.ele('DetallesItems');
  for (const l of d.lineas) {
    const it = det.ele('Item');
    it.ele('NumeroLinea').txt(String(l.numeroLinea));
    it.ele('IndicadorFacturacion').txt(String(l.indicadorItbis));
    it.ele('NombreItem').txt(txt(l.nombre, 80));
    it.ele('IndicadorBienoServicio').txt(l.esServicio ? '2' : '1');
    it.ele('CantidadItem').txt(qty(l.cantidad));
    if (l.unidadMedida) it.ele('UnidadMedida').txt(String(l.unidadMedida));
    it.ele('PrecioUnitarioItem').txt(precio(l.precioUnitario));
    if (l.descuentoMonto.gt(0)) it.ele('DescuentoMonto').txt(m2(l.descuentoMonto));
    it.ele('MontoItem').txt(m2(l.montoItem));
  }

  if (d.tipoECF === '33' || d.tipoECF === '34') {
    if (!d.referencia) throw new Error(`E${d.tipoECF} requiere InformacionReferencia`);
    const ref = ecf.ele('InformacionReferencia');
    ref.ele('NCFModificado').txt(d.referencia.ncfModificado);
    ref.ele('FechaNCFModificado').txt(fechaDGII(d.referencia.fechaNcfModificado));
    ref.ele('CodigoModificacion').txt(String(d.referencia.codigoModificacion));
    ref.ele('RazonModificacion').txt(txt(d.referencia.razon, 90));
  }

  // FechaHoraFirma va inmediatamente antes de <Signature>
  ecf.ele('FechaHoraFirma').txt(fechaHoraDGII(new Date()));
  return doc.end({ prettyPrint: false }); // sin espacios: la firma se calcula sobre bytes exactos
}

/** Lee FechaHoraFirma del XML ya construido (se usa en el QR y en la BD). */
export function extraerFechaHoraFirma(xml: string): string {
  const m = xml.match(/<FechaHoraFirma>([^<]+)<\/FechaHoraFirma>/);
  if (!m) throw new Error('XML sin FechaHoraFirma');
  return m[1];
}

// ---------------------------------------------------------------- RFCE (E32 < RD$250,000)
export function construirRFCE(d: DocumentoECF, codigoSeguridadECF: string): string {
  if (d.tipoECF !== '32' || d.totales.montoTotal.gte(250_000)) {
    throw new Error('El RFCE solo aplica a E32 con monto total menor a RD$250,000');
  }
  const doc = create({ version: '1.0', encoding: 'utf-8' });
  const rf = doc.ele('RFCE');
  const enc = rf.ele('Encabezado');
  enc.ele('Version').txt('1.0');
  idDoc(enc, d, true);

  const em = enc.ele('Emisor');
  em.ele('RNCEmisor').txt(d.emisor.rnc);
  em.ele('RazonSocialEmisor').txt(txt(d.emisor.razonSocial, 150));
  em.ele('FechaEmision').txt(fechaDGII(d.fechaEmision));

  if (d.comprador?.rnc) {
    const c = enc.ele('Comprador');
    c.ele('RNCComprador').txt(d.comprador.rnc);
    opt(c, 'RazonSocialComprador', d.comprador.razonSocial ? txt(d.comprador.razonSocial, 150) : undefined);
  }
  totales(enc, d.totales);
  enc.ele('CodigoSeguridadeCF').txt(codigoSeguridadECF);
  return doc.end({ prettyPrint: false });
}

/** Nombre de archivo exigido en la recepción: {RNCEmisor}{eNCF}.xml */
export const nombreArchivo = (rnc: string, encf: string) => `${rnc}${encf}.xml`;
