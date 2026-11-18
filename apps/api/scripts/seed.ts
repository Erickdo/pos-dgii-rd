/**
 * Datos iniciales para empezar a usar el POS:  npm run seed
 * Edita los datos del negocio (RNC, razón social, dirección) antes de pasar a CerteCF/producción.
 */
import { pool } from '../src/db.js';
import { hashSecreto } from '../src/auth.js';

const PRODUCTOS: [string, string, string | null, string, number, 1 | 2 | 3 | 4, number][] = [
  // categoría, código, código de barras, nombre, PRECIO FINAL con ITBIS, indicador, stock
  ['Café', 'CAF-01', '7460000000011', 'Café americano', 100, 1, 0],
  ['Café', 'CAF-02', '7460000000028', 'Café con leche', 125, 1, 0],
  ['Café', 'CAF-03', '7460000000035', 'Cappuccino', 160, 1, 0],
  ['Café', 'CAF-04', '7460000000042', 'Espresso', 90, 1, 0],
  ['Café', 'CAF-05', '7460000000059', 'Chocolate caliente', 140, 1, 0],
  ['Desayunos', 'DES-01', null, 'Mangú con los tres golpes', 350, 1, 0],
  ['Desayunos', 'DES-02', null, 'Sándwich de jamón y queso', 225, 1, 0],
  ['Desayunos', 'DES-03', null, 'Tostada con huevo', 180, 1, 0],
  ['Desayunos', 'DES-04', null, 'Avena caliente', 120, 1, 0],
  ['Panadería', 'PAN-01', '7460000000066', 'Pan sobao', 10, 4, 200],
  ['Panadería', 'PAN-02', '7460000000073', 'Croissant', 85, 1, 40],
  ['Panadería', 'PAN-03', '7460000000080', 'Pastelito de pollo', 60, 1, 50],
  ['Panadería', 'PAN-04', '7460000000097', 'Bizcocho (porción)', 150, 1, 24],
  ['Bebidas', 'BEB-01', '7460000000103', 'Agua 500 ml', 35, 1, 120],
  ['Bebidas', 'BEB-02', '7460000000110', 'Jugo natural de naranja', 150, 1, 0],
  ['Bebidas', 'BEB-03', '7460000000127', 'Refresco 20 oz', 75, 1, 96],
  ['Bebidas', 'BEB-04', '7460000000134', 'Leche entera 1 L', 87, 2, 6],
  ['Bebidas', 'BEB-05', '7460000000141', 'Morir soñando', 175, 1, 0],
  ['Snacks', 'SNK-01', '7460000000158', 'Galletas de soda', 40, 1, 60],
  ['Snacks', 'SNK-02', '7460000000165', 'Maní tostado', 50, 1, 4],
];
const TASAS = { 1: 0.18, 2: 0.16, 3: 0, 4: 0 } as const;

async function main() {
  const existe = await pool.query(`SELECT 1 FROM emisor LIMIT 1`);
  if (existe.rowCount) { console.log('La base ya tiene datos: no se sembró nada.'); return pool.end(); }

  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0];
  const em = await q(
    `INSERT INTO emisor (rnc, razon_social, nombre_comercial, direccion, telefono, correo, certificado_ref)
     VALUES ('131000002','MI NEGOCIO SRL','Mi Cafetería','C/ Principal #1, Santo Domingo','8095550000',
             'facturacion@minegocio.do','.datos/certificado-prueba.p12') RETURNING id`);
  const su = await q(`INSERT INTO sucursales (emisor_id, codigo, nombre, direccion) VALUES ($1,'001','Principal','C/ Principal #1') RETURNING id`, [em.id]);
  await pool.query(`INSERT INTO terminales (sucursal_id, codigo, descripcion) VALUES ($1,'CAJA1','Mostrador'), ($1,'CAJA2','Terraza')`, [su.id]);

  for (const [nombre, usuario, rol, pin] of [
    ['Administrador', 'admin', 'administrador', '1234'],
    ['Cajero 1', 'cajero1', 'cajero', '0000'],
  ]) {
    await pool.query(
      `INSERT INTO usuarios (nombre, usuario, password_hash, pin_hash, rol, sucursal_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [nombre, usuario, hashSecreto(pin), hashSecreto(pin), rol, su.id]);
  }

  // Rangos de PRUEBA. En producción se cargan los rangos autorizados en la Oficina Virtual.
  await pool.query(
    `INSERT INTO secuencias_ncf (emisor_id, serie, tipo, desde, hasta, ultimo_usado, fecha_vencimiento) VALUES
       ($1,'E','31',1,10000,0,'2027-12-31'),
       ($1,'E','32',1,100000,0,NULL),
       ($1,'E','34',1,1000,0,NULL),
       ($1,'E','44',1,1000,0,'2027-12-31'),
       ($1,'E','45',1,1000,0,'2027-12-31')`, [em.id]);

  const cats = new Map<string, string>();
  for (const c of new Set(PRODUCTOS.map((p) => p[0]))) {
    cats.set(c, (await q(`INSERT INTO categorias (nombre) VALUES ($1) RETURNING id`, [c])).id);
  }
  for (const [cat, cod, barras, nombre, final, ind, stock] of PRODUCTOS) {
    const sinItbis = (final / (1 + TASAS[ind])).toFixed(4); // se guarda SIN ITBIS
    const inventario = stock > 0;
    await pool.query(
      `INSERT INTO productos (codigo_interno, codigo_barras, nombre, categoria_id, precio_venta, indicador_itbis,
              maneja_inventario, stock_actual, stock_minimo, costo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [cod, barras, nombre, cats.get(cat), sinItbis, ind, inventario, stock, inventario ? 10 : 0, (Number(sinItbis) * 0.38).toFixed(2)]);
  }

  await pool.query(
    `INSERT INTO clientes (tipo_identificacion, identificacion, nombre, es_contribuyente, correo_fe, limite_credito) VALUES
       ('RNC','101000007','DISTRIBUIDORA EJEMPLO SRL', true, 'compras@ejemplo.do', 50000)`);

  console.log('Datos iniciales creados. Usuarios: Administrador (PIN 1234) y Cajero 1 (PIN 0000).');
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
