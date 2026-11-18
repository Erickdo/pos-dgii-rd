/**
 * Demo de punta a punta contra una BD con schema.sql cargado:
 *   npm run demo   (DATABASE_URL=...)
 * Genera un .p12 AUTOFIRMADO solo para pruebas (la DGII exige uno de una entidad autorizada).
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = tmpdir();
import forge from 'node-forge';
import { pool } from '../src/db.js';
import { cargarP12, verificarFirma } from '../src/modules/fiscal/firma.js';
import { procesarVenta, ErrorNegocio } from '../src/modules/ventas/ventas.service.js';
import { ClienteDGII } from '../src/modules/fiscal/dgii.client.js';
import { procesarLote } from '../src/modules/fiscal/transmision.worker.js';

function p12Prueba(ruta: string, clave: string) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'FIRMANTE PRUEBA' }, { name: 'countryName', value: 'DO' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], clave, { algorithm: '3des' });
  writeFileSync(ruta, Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'));
}

async function sembrar() {
  const q = (s: string, p: unknown[] = []) => pool.query(s, p).then((r) => r.rows[0]);
  const em = await q(`INSERT INTO emisor (rnc, razon_social, nombre_comercial, direccion, certificado_ref)
                      VALUES ('131000001','CAFETERIA DEMO SRL','Cafetería Demo','C/ Duarte 10, Santo Domingo','vault://fe/demo')
                      RETURNING id`);
  const su = await q(`INSERT INTO sucursales (emisor_id, codigo, nombre, direccion) VALUES ($1,'001','Principal','C/ Duarte 10') RETURNING id`, [em.id]);
  const te = await q(`INSERT INTO terminales (sucursal_id, codigo) VALUES ($1,'CAJA1') RETURNING id`, [su.id]);
  const us = await q(`INSERT INTO usuarios (nombre, usuario, password_hash, rol, sucursal_id) VALUES ('Ana','ana','x','cajero',$1) RETURNING id`, [su.id]);
  const ca = await q(`INSERT INTO cajas (terminal_id, usuario_id, monto_inicial) VALUES ($1,$2,2000) RETURNING id`, [te.id, us.id]);
  await q(`INSERT INTO secuencias_ncf (emisor_id, serie, tipo, desde, hasta, ultimo_usado, fecha_vencimiento)
           VALUES ($1,'E','32',1,1000,0,NULL), ($1,'E','31',1,500,0,'2027-12-31')`, [em.id]);
  const cafe = await q(`INSERT INTO productos (codigo_interno, codigo_barras, nombre, precio_venta, indicador_itbis, stock_actual)
                        VALUES ('CAF-01','7460000000011','Café americano', 84.7458, 1, 50) RETURNING id`);
  const leche = await q(`INSERT INTO productos (codigo_interno, nombre, precio_venta, indicador_itbis, stock_actual)
                         VALUES ('LEC-01','Leche entera 1L', 75.00, 2, 3) RETURNING id`);
  const pan = await q(`INSERT INTO productos (codigo_interno, nombre, precio_venta, indicador_itbis, stock_actual)
                       VALUES ('PAN-01','Pan sobao', 10.00, 4, 100) RETURNING id`);
  const cli = await q(`INSERT INTO clientes (tipo_identificacion, identificacion, nombre, es_contribuyente, correo_fe)
                       VALUES ('RNC','101000002','DISTRIBUIDORA EJEMPLO SRL', true, 'compras@ejemplo.do') RETURNING id`);
  return { caja: ca.id, usuario: us.id, cafe: cafe.id, leche: leche.id, pan: pan.id, cliente: cli.id };
}

async function main() {
  p12Prueba(join(TMP, 'firma-prueba.p12'), 'clave123');
  const firmante = cargarP12(join(TMP, 'firma-prueba.p12'), 'clave123');
  const d = await sembrar();

  // 1) Consumo E32 con pago mixto: efectivo + tarjeta (genera RFCE)
  const key = randomUUID();
  const v1 = await procesarVenta({
    idempotencyKey: key, cajaId: d.caja, usuarioId: d.usuario,
    items: [
      { productoId: d.cafe, cantidad: '2' },
      { productoId: d.leche, cantidad: '1' },
      { productoId: d.pan, cantidad: '5', descuentoMonto: '5.00' },
    ],
    pagos: [{ metodo: 'tarjeta', monto: '150.00', referencia: 'AUT123', ultimos4: '4242' },
            { metodo: 'efectivo', monto: '200.00' }],
  }, firmante);
  console.log('\n[1] Venta E32:', v1);

  // 2) Reintento con la misma clave → no duplica
  const v1b = await procesarVenta({
    idempotencyKey: key, cajaId: d.caja, usuarioId: d.usuario,
    items: [{ productoId: d.cafe, cantidad: '2' }], pagos: [{ metodo: 'efectivo', monto: '500' }],
  }, firmante);
  console.log('[2] Reintento idempotente → mismo e-NCF:', v1b.encf, 'repetida =', v1b.repetida);

  // 3) Crédito fiscal E31 por transferencia
  const v3 = await procesarVenta({
    idempotencyKey: randomUUID(), cajaId: d.caja, usuarioId: d.usuario, clienteId: d.cliente, creditoFiscal: true,
    items: [{ productoId: d.cafe, cantidad: '10' }],
    pagos: [{ metodo: 'transferencia', monto: '1000.00', referencia: 'TRF-889' }],
  }, firmante);
  console.log('[3] Venta E31:', v3.encf, 'total', v3.montoTotal, '\n    QR:', v3.urlQr);

  // 4) Stock insuficiente → rollback total, el e-NCF no se consume
  try {
    await procesarVenta({
      idempotencyKey: randomUUID(), cajaId: d.caja, usuarioId: d.usuario,
      items: [{ productoId: d.leche, cantidad: '99' }], pagos: [{ metodo: 'efectivo', monto: '99999' }],
    }, firmante);
  } catch (e) { console.log('[4] Rechazada:', e instanceof ErrorNegocio ? e.codigo : e); }

  // Verificaciones
  const fe = await pool.query(`SELECT encf, xml_firmado, xml_rfce_firmado FROM facturas_electronicas ORDER BY encf`);
  for (const f of fe.rows) {
    console.log(`    firma ${f.encf}: ${verificarFirma(f.xml_firmado, firmante.certPem) ? 'VÁLIDA' : 'INVÁLIDA'}` +
                (f.xml_rfce_firmado ? ` | RFCE ${verificarFirma(f.xml_rfce_firmado, firmante.certPem) ? 'VÁLIDO' : 'INVÁLIDO'}` : ''));
  }
  console.log('[5] Secuencias:', (await pool.query(`SELECT comprobante, ultimo_usado, restantes FROM v_secuencias_estado`)).rows);
  console.log('    Stock:', (await pool.query(`SELECT codigo_interno, stock_actual FROM productos ORDER BY 1`)).rows);
  console.log('    Caja:', (await pool.query(`SELECT efectivo_esperado, total_ventas, total_itbis, num_ventas, por_metodo FROM v_resumen_caja`)).rows[0]);

  // 6) Worker sin acceso a la DGII → contingencia por conectividad (reintento programado)
  await procesarLote(new ClienteDGII(() => firmante));
  console.log('[6] Cola fiscal:', (await pool.query(
    `SELECT encf, estado, intentos, left(ultimo_error, 60) AS error, round(extract(epoch FROM tiempo_restante)/3600) AS horas_para_limite
       FROM v_ecf_pendientes`)).rows);

  writeFileSync(join(TMP, 'ejemplo-E32-firmado.xml'), fe.rows.find((r) => r.encf.startsWith('E32')).xml_firmado);
  writeFileSync(join(TMP, 'ejemplo-RFCE-firmado.xml'), fe.rows.find((r) => r.encf.startsWith('E32')).xml_rfce_firmado);
  writeFileSync(join(TMP, 'ejemplo-E31-firmado.xml'), fe.rows.find((r) => r.encf.startsWith('E31')).xml_firmado);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
