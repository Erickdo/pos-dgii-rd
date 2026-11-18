# POS Web + Facturación Electrónica DGII (República Dominicana)

POS táctil con emisión de e-CF conforme a la Ley 32-23, el Decreto 587-24 y la Norma General 01-2020.

---

## 1. Stack y arquitectura

| Capa | Elección | Por qué |
|---|---|---|
| UI POS | **Next.js (React) + Tailwind**, PWA instalable | Pantalla completa en tablet, caché offline del catálogo, teclado/escáner HID |
| API | **Node.js + Express (TypeScript)** por módulos (`ventas`, `cajas`, `inventario`, `fiscal`) | Mismo lenguaje que el front; `xml-crypto` y `node-forge` cubren firma XMLDSig y `.p12` |
| BD | **PostgreSQL 15+** | ACID, `FOR UPDATE` para secuencias, triggers de stock, índices parciales |
| Fiscal | Módulo `fiscal` + **worker de transmisión** (patrón *outbox*) | La caja no depende de la DGII ni de internet |

```
 Tablet/PC (PWA) ──LAN──▶  Servidor de tienda (mini-PC o VPS cercano)
   React + Tailwind          ├─ API Express  ──▶ PostgreSQL
   useBarcodeScanner         │     └─ firma e-CF localmente (.p12)
   impresora térmica ESC/POS └─ Worker fiscal ──internet──▶ DGII (TesteCF / CerteCF / eCF)
```

**Decisión clave:** la venta se confirma con el e-CF **ya firmado** (e-NCF, código de seguridad y QR), y la transmisión ocurre después. Si se cae internet, el ticket sale igual y el worker envía cuando vuelve la conexión.

Para un solo local, API + Postgres pueden ir en un mini-PC dentro del negocio (la LAN sigue funcionando sin internet). Con varias sucursales, cada tienda tiene su servidor y replica a la nube.

## 2. Estructura de carpetas (monorepo)

```
pos-dgii-rd/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ config.ts                  ambiente DGII, endpoints, certificado
│  │  │  ├─ db.ts                      pool + withTransaction()
│  │  │  ├─ server.ts
│  │  │  └─ modules/
│  │  │     ├─ ventas/
│  │  │     │  ├─ calculos.ts          ITBIS 18/16/0/exento, pagos múltiples, cambio
│  │  │     │  ├─ ventas.service.ts    venta ACID + e-NCF + firma
│  │  │     │  └─ ventas.routes.ts     POST /api/ventas (zod)
│  │  │     ├─ cajas/                  apertura, entradas/salidas, arqueo  (pendiente)
│  │  │     ├─ inventario/             compras, ajustes, alertas           (pendiente)
│  │  │     └─ fiscal/
│  │  │        ├─ ecf.builder.ts       XML e-CF y RFCE
│  │  │        ├─ firma.ts             .p12 → XMLDSig RSA-SHA256
│  │  │        ├─ qr.ts                URL del timbre (ConsultaTimbre / ConsultaTimbreFC)
│  │  │        ├─ dgii.client.ts       semilla → token, recepción, RFCE, consulta TrackId
│  │  │        └─ transmision.worker.ts  cola, reintentos, contingencia
│  │  └─ scripts/demo-venta.ts         prueba de punta a punta
│  └─ web/
│     └─ src/hooks/useBarcodeScanner.ts
├─ database/schema.sql
└─ docs/ejemplos-xml/                  E31, E32 y RFCE firmados por la demo
```

## 3. Módulos funcionales

### Carrito ágil
- **Búsqueda:** código de barras exacto (índice único) y, si no hay coincidencia, texto difuso con `pg_trgm`. El catálogo se cachea en IndexedDB para respuesta instantánea.
- **Escáner:** `useBarcodeScanner` distingue el escáner (teclas a menos de 30 ms y luego Enter) de una persona que escribe, sin necesidad de enfocar un campo.
- **Impuestos:** los precios se guardan sin ITBIS. El ITBIS total se calcula sobre la **base acumulada de cada tasa** (`TotalITBIS1 = MontoGravadoI1 × 18 %`), igual que como valida la DGII. Nunca se suma el ITBIS redondeado línea por línea.
- **Precios:** el servidor ignora los precios que mande el navegador y lee los de la BD.
- **Pagos múltiples:** efectivo + tarjeta + transferencia en una venta. Solo el efectivo puede pasarse del total (genera el cambio). En el XML, el cambio se resta del efectivo para que `TablaFormasPago` sume el `MontoTotal`.
- **Idempotencia:** el front genera un `idempotencyKey` por venta; un doble toque o un reintento devuelve el mismo e-NCF.

### Caja (turnos)
- Solo puede haber una caja abierta por terminal y por cajero (índices únicos parciales). Además, un trigger impide vender con la caja cerrada.
- Las entradas y salidas manuales van a `movimientos_caja`. Las salidas llevan `autorizado_por` (supervisor).
- **Arqueo:** `v_resumen_caja` calcula el efectivo esperado: inicial + ventas en efectivo − cambio + entradas − salidas. El cajero cuenta por denominación (`detalle_arqueo`, que es JSONB) y la diferencia se calcula sola en una columna generada.

### Inventario
- El trigger `detalle_venta → descuenta stock` escribe también el **kardex**. Si el stock no alcanza, el CHECK aborta toda la venta y no se consume ningún e-NCF (verificado en la demo).
- Al anular una venta, el stock se repone con su propio movimiento de kardex.
- **Alertas:** `v_stock_bajo` se apoya en un índice parcial. El front la consulta al cerrar cada venta o la recibe por WebSocket.

## 4. Módulo fiscal DGII

### Flujo de emisión

| Paso | Dónde | Qué ocurre |
|---|---|---|
| 1 | Transacción de venta | `tomar_ncf()` bloquea la secuencia → `E32` + 10 dígitos |
| 2 | Transacción de venta | Se construye el XML `<ECF>` sin espacios y `FechaHoraFirma` queda justo antes de `<Signature>` |
| 3 | Transacción de venta | Firma XMLDSig enveloped, RSA-SHA256, C14N, con el certificado en `X509Data` |
| 4 | Transacción de venta | Código de seguridad = 6 primeros caracteres del `SignatureValue` → URL del QR |
| 5 | Worker | E31 / E33 / E34 / E32 ≥ RD$250k → recepción → **TrackId** → consulta de estado |
| 6 | Worker | E32 < RD$250k → se envía el **RFCE** firmado → respuesta inmediata, sin TrackId |

La autenticación pide la semilla, la firma con el mismo certificado y la canjea por un token Bearer, que queda en caché hasta poco antes de vencer.

### QR en el ticket
- **E32 menor de RD$250k:** `https://fc.dgii.gov.do/{ambiente}/ConsultaTimbreFC?RncEmisor&ENCF&MontoTotal&CodigoSeguridad`
- **Demás comprobantes:** `ConsultaTimbre`, que además lleva `RncComprador`, `FechaEmision` y `FechaFirma`.

Para imprimir, en ESC/POS se usa el comando nativo de QR (`GS ( k`), o bien se genera un PNG con `qrcode` para tickets en HTML. El ticket también debe mostrar e-NCF, código de seguridad, fecha de firma y, en E31, la fecha de vencimiento de la secuencia.

### Contingencia

| Situación | Comportamiento del POS |
|---|---|
| **Sin internet o DGII caída** (se puede firmar pero no enviar) | La venta se completa normal con su e-CF firmado. El worker reintenta con backoff exponencial (5 s → 5 min). `limite_envio` = 72 h; con menos de 12 h restantes genera `alerta_plazo`. En la UI aparece un banner: "N comprobantes pendientes de envío". |
| **No se puede emitir e-CF** (certificado vencido, servidor dañado, secuencias E agotadas) | Se abre un registro en `contingencias` (tipo `emision`) y se usan **NCF serie B** autorizados (`tomar_ncf(..., 'B', '02')`). Esto se notifica en la Oficina Virtual (`notificada_ofv`). Al salir, se generan los e-CF de reemplazo (`modalidad = respaldo_serie_b`, con `ncf_respaldo`), que se envían **solo a la DGII** dentro de 30 días. |

Datos de respaldo en la venta: el XML firmado y el RFCE se guardan en la BD (`xml_firmado`, `xml_rfce_firmado`). La BD debe tener respaldo continuo (WAL o `pg_basebackup`), porque es la fuente de verdad fiscal.

### Reglas que impone el esquema
- **e-NCF único** (`UNIQUE`) y numeración sin huecos (fila bloqueada, con rollback si la venta falla).
- **Inmutabilidad:** un e-CF firmado no puede cambiar su XML, su e-NCF ni su monto. Cualquier corrección se hace con **E34 (nota de crédito)** o **E33 (nota de débito)**.
- **E31** exige RNC del comprador. **E32 desde RD$250k** exige identificar al comprador. El RFCE solo se usa en E32 por debajo de RD$250k.
- **Alertas de secuencia:** `v_secuencias_estado` avisa cuando quedan pocas o están por vencer, para pedir un nuevo rango en la OFV a tiempo.

## 5. Instalar y usar (Windows)

1. Extrae el zip (clic derecho → *Extraer todo*).
2. En PowerShell, dentro de la carpeta extraída: `Get-ChildItem -Recurse | Unblock-File` y luego `.\INSTALAR-POS.cmd`.
3. Se abre **http://localhost:3000**. Queda el acceso directo **"Punto de Venta"** en el escritorio.

Usuarios iniciales: **`admin` / 1234** (pestaña Administrador) y **`cajero1` / 0000** (pestaña Caja). Cámbialos en Configuración → Usuarios y accesos. Los nuevos integrantes piden acceso desde la pantalla de entrada y el administrador los aprueba desde la campana.
Reinstalar o actualizar **no borra datos**: el servidor aplica solo las migraciones de `database/migraciones/` al arrancar.

### Módulos (menú lateral)

| # | Módulo | Roles | Qué hace |
|---|---|---|---|
| 1 | Punto de Venta | cajero, admin | Catálogo, escáner, selector **E32/E31/E44/E45**, descuentos por línea y global, cobro mixto (efectivo, tarjeta, transferencia, crédito), ticket con QR |
| 2 | Historial de Ventas | todos | Filtros por fecha/estado, reimpresión, **nota de crédito E34** con PIN de admin |
| 3 | Control de Caja | cajero, admin | Apertura, entradas/salidas (gastos), arqueo por denominación, **cuadre de tarjetas** contra el lote del datáfono, historial de turnos |
| 4 | Inventario y Productos | admin | CRUD con ITBIS 18/16/exento, costo y margen, compras a proveedores, ajustes, kardex, categorías |
| 5 | Clientes | todos | Directorio con **validación del dígito verificador** de RNC y cédula, límite de crédito, estado de cuenta y abonos |
| 6 | Facturación Electrónica | todos | Monitor de e-CF (aceptados, en cola, rechazados), **sincronización manual**, XML firmado, secuencias de e-NCF |
| 7 | Reportes y Contabilidad | admin, contador | Resumen del día, ventas por período, **cuadre de ITBIS**, más vendidos con margen, **607 en CSV** |
| 8 | Configuración | admin | Empresa (emisor) y logo, usuarios y solicitudes de acceso, impresora 80/58 mm, **carga del certificado .p12** |

Atajos: **F2** buscar · **F9** cobrar · **Enter** confirmar / nueva venta · **Ctrl+P** imprimir.

## 6. Pendientes antes de certificar con la DGII
1. **Validar cada XML contra los XSD oficiales** (e-CF 31/32/33/34 y RFCE 32) con `xmllint --schema` en CI. El builder sigue el orden del formato v1.0, pero el XSD es la referencia.
2. **Endpoints:** confirmar las rutas en `config.ts` contra la "Descripción Técnica Servicios DGII" vigente.
3. **Certificado:** el de prueba es autofirmado. En producción se usa el de persona física emitido por una entidad autorizada y se guarda en un gestor de secretos.
4. **Proceso de certificación** de la DGII: set de pruebas en `CerteCF`, simulación y declaración de cumplimiento.
5. Pendiente: devoluciones parciales (hoy la E34 anula la factura completa), formato 606 de compras, modo restaurante (mesas/comandas), notas de crédito E34 para devoluciones, envío del e-CF por correo y la recepción/aprobación comercial (si se reciben e-CF de proveedores).
