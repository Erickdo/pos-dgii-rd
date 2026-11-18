-- =============================================================================
--  POS Web + Facturación Electrónica DGII — República Dominicana (e-CF)
--  PostgreSQL 15+  |  Montos en NUMERIC (nunca FLOAT)
-- =============================================================================
--  Marco: Ley 32-23, Decreto 587-24, Norma General 01-2020 y Formato e-CF v1.0.
--  Convenciones:
--   * PK UUID para poder crear registros en el servidor de tienda sin choques al sincronizar.
--   * NUMERIC(18,2) en totales (el formato e-CF admite 16 enteros + 2 decimales).
--   * Lo transaccional no se borra: se anula o se corrige con Nota de Crédito (E34).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsqueda difusa de productos / clientes
CREATE EXTENSION IF NOT EXISTS unaccent;   -- buscar "cafe" encuentra "Café"

CREATE SCHEMA IF NOT EXISTS pos;
SET search_path TO pos, public;

-- -----------------------------------------------------------------------------
-- 0. Tipos
-- -----------------------------------------------------------------------------
CREATE TYPE rol_usuario     AS ENUM ('cajero', 'administrador', 'contador');
CREATE TYPE estado_caja     AS ENUM ('abierta', 'cerrada');
CREATE TYPE tipo_mov_caja   AS ENUM ('entrada', 'salida');
CREATE TYPE estado_venta    AS ENUM ('completada', 'anulada');
-- Se mapean a <FormaPago> del e-CF: 1 efectivo, 2 cheque/transferencia/depósito,
-- 3 tarjeta débito/crédito, 4 venta a crédito, 5 bonos o certificados de regalo, 8 otras
CREATE TYPE metodo_pago     AS ENUM ('efectivo', 'tarjeta', 'transferencia', 'cheque',
                                     'credito', 'bono', 'otro');
CREATE TYPE tipo_ident      AS ENUM ('RNC', 'CEDULA', 'PASAPORTE', 'NINGUNA');
CREATE TYPE ambiente_dgii   AS ENUM ('TesteCF', 'CerteCF', 'eCF');
CREATE TYPE estado_ecf      AS ENUM ('pendiente',            -- creado, falta firmar
                                     'firmado',              -- firmado, en cola de envío
                                     'enviado',              -- DGII devolvió TrackId, falta resultado
                                     'aceptado',
                                     'aceptado_condicional',
                                     'rechazado',
                                     'anulado');
-- normal: emitido y enviado al momento
-- contingencia_conexion: e-CF firmado sin internet → envío diferido (máx. 72 h)
-- respaldo_serie_b: no se pudo emitir e-CF → NCF serie B entregado al cliente; el e-CF
--                   que lo reemplaza se envía SOLO a la DGII (máx. 30 días tras la contingencia)
CREATE TYPE modalidad_ecf   AS ENUM ('normal', 'contingencia_conexion', 'respaldo_serie_b');
CREATE TYPE tipo_mov_inv    AS ENUM ('venta', 'devolucion', 'compra', 'ajuste_pos',
                                     'ajuste_neg', 'anulacion_venta');

-- -----------------------------------------------------------------------------
-- 1. Emisor, sucursales y terminales
-- -----------------------------------------------------------------------------
CREATE TABLE emisor (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rnc                 VARCHAR(11)  NOT NULL UNIQUE CHECK (rnc ~ '^\d{9}(\d{2})?$'),
    razon_social        VARCHAR(150) NOT NULL,
    nombre_comercial    VARCHAR(150),
    direccion           VARCHAR(100) NOT NULL,
    municipio           CHAR(6),                   -- código de la tabla de municipios DGII
    provincia           CHAR(6),
    telefono            VARCHAR(12),
    correo              VARCHAR(80),
    ambiente            ambiente_dgii NOT NULL DEFAULT 'TesteCF',
    -- Referencia al gestor de secretos donde está el .p12 y su clave. NUNCA el archivo aquí.
    certificado_ref     VARCHAR(200) NOT NULL,
    certificado_vence   DATE,
    creado_en           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE sucursales (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emisor_id   UUID NOT NULL REFERENCES emisor(id),
    codigo      VARCHAR(20)  NOT NULL,             -- <CodigoSucursal> (opcional en el XML)
    nombre      VARCHAR(100) NOT NULL,
    direccion   VARCHAR(100) NOT NULL,
    activa      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (emisor_id, codigo)
);

CREATE TABLE terminales (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sucursal_id UUID NOT NULL REFERENCES sucursales(id),
    codigo      VARCHAR(10) NOT NULL,
    descripcion VARCHAR(60),
    activa      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (sucursal_id, codigo)
);

-- -----------------------------------------------------------------------------
-- 2. Secuencias autorizadas (rangos solicitados en la Oficina Virtual)
--    Se numera por TIPO de comprobante para todo el RNC, no por terminal.
-- -----------------------------------------------------------------------------
CREATE TABLE secuencias_ncf (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emisor_id           UUID NOT NULL REFERENCES emisor(id),
    serie               CHAR(1) NOT NULL CHECK (serie IN ('E', 'B')),
    tipo                CHAR(2) NOT NULL,          -- E: 31,32,33,34,41,43,44,45,46,47 | B: 01,02,04,...
    desde               BIGINT  NOT NULL CHECK (desde > 0),
    hasta               BIGINT  NOT NULL,
    ultimo_usado        BIGINT  NOT NULL,          -- inicia en desde - 1
    fecha_vencimiento   DATE,                      -- E32 y E34 no llevan vencimiento en la RI
    numero_autorizacion VARCHAR(40),
    activa              BOOLEAN NOT NULL DEFAULT TRUE,
    alerta_restantes    INTEGER NOT NULL DEFAULT 100,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (hasta >= desde),
    CHECK (ultimo_usado BETWEEN desde - 1 AND hasta),
    -- E: 10 dígitos de secuencial; B: 8 dígitos
    CHECK ((serie = 'E' AND hasta <= 9999999999) OR (serie = 'B' AND hasta <= 99999999))
);
-- Un solo rango activo por tipo de comprobante
CREATE UNIQUE INDEX ux_secuencia_activa ON secuencias_ncf (emisor_id, serie, tipo) WHERE activa;

-- -----------------------------------------------------------------------------
-- 3. Usuarios
-- -----------------------------------------------------------------------------
CREATE TABLE usuarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre          VARCHAR(100) NOT NULL,
    usuario         VARCHAR(50)  NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,         -- argon2id
    pin_hash        TEXT,                          -- PIN rápido de cajero
    rol             rol_usuario  NOT NULL,
    sucursal_id     UUID REFERENCES sucursales(id),
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    ultimo_acceso   TIMESTAMPTZ,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 4. Clientes
-- -----------------------------------------------------------------------------
CREATE TABLE clientes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_identificacion tipo_ident  NOT NULL DEFAULT 'NINGUNA',
    identificacion      VARCHAR(20),               -- RNC (9) o cédula (11), sin guiones
    nombre              VARCHAR(150) NOT NULL,     -- <RazonSocialComprador>
    direccion           VARCHAR(100),
    telefono            VARCHAR(12),
    correo_fe           VARCHAR(80),               -- destino de la representación impresa
    -- Si es contribuyente, por defecto se le emite E31 (crédito fiscal)
    es_contribuyente    BOOLEAN NOT NULL DEFAULT FALSE,
    limite_credito      NUMERIC(18,2) NOT NULL DEFAULT 0,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_ident CHECK (
        (tipo_identificacion = 'NINGUNA' AND identificacion IS NULL) OR
        (tipo_identificacion = 'RNC'     AND identificacion ~ '^\d{9}$') OR
        (tipo_identificacion = 'CEDULA'  AND identificacion ~ '^\d{11}$') OR
        (tipo_identificacion = 'PASAPORTE' AND identificacion IS NOT NULL)
    ),
    CONSTRAINT chk_contribuyente CHECK (NOT es_contribuyente OR tipo_identificacion IN ('RNC', 'CEDULA')),
    CONSTRAINT chk_correo CHECK (correo_fe IS NULL OR correo_fe ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
CREATE UNIQUE INDEX ux_clientes_ident ON clientes (tipo_identificacion, identificacion)
    WHERE identificacion IS NOT NULL;
CREATE INDEX ix_clientes_nombre_trgm ON clientes USING gin (nombre gin_trgm_ops);

INSERT INTO clientes (id, nombre) VALUES
    ('00000000-0000-0000-0000-000000000001', 'CONSUMIDOR FINAL');

-- -----------------------------------------------------------------------------
-- 5. Productos e inventario
-- -----------------------------------------------------------------------------
-- <IndicadorFacturacion> del ítem: 1 = ITBIS 18 %, 2 = ITBIS 16 %, 3 = ITBIS 0 %, 4 = exento
CREATE TABLE tasas_itbis (
    indicador   SMALLINT PRIMARY KEY,
    porcentaje  NUMERIC(5,2) NOT NULL,
    descripcion VARCHAR(40)  NOT NULL
);
INSERT INTO tasas_itbis VALUES
    (1, 18.00, 'ITBIS tasa general 18%'),
    (2, 16.00, 'ITBIS tasa reducida 16%'),
    (3,  0.00, 'ITBIS 0%'),
    (4,  0.00, 'Exento');

CREATE TABLE categorias (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre  VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE productos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_interno      VARCHAR(35)  NOT NULL UNIQUE,
    codigo_barras       VARCHAR(30),
    nombre              VARCHAR(80)  NOT NULL,       -- <NombreItem> admite 80 car.
    descripcion         VARCHAR(1000),
    categoria_id        UUID REFERENCES categorias(id),
    es_servicio         BOOLEAN NOT NULL DEFAULT FALSE,  -- <IndicadorBienoServicio> 1 bien / 2 servicio
    unidad_medida       SMALLINT,                    -- código de la tabla de unidades DGII (opcional)
    -- Precio SIN ITBIS. La UI muestra el precio final (con ITBIS) al cajero.
    precio_venta        NUMERIC(18,4) NOT NULL CHECK (precio_venta >= 0),
    costo               NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (costo >= 0),
    indicador_itbis     SMALLINT NOT NULL DEFAULT 1 REFERENCES tasas_itbis(indicador),
    maneja_inventario   BOOLEAN NOT NULL DEFAULT TRUE,
    stock_actual        NUMERIC(14,4) NOT NULL DEFAULT 0,
    stock_minimo        NUMERIC(14,4) NOT NULL DEFAULT 0,
    permite_negativo    BOOLEAN NOT NULL DEFAULT FALSE,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_stock_no_negativo CHECK (permite_negativo OR NOT maneja_inventario OR stock_actual >= 0),
    CONSTRAINT chk_servicio_sin_stock CHECK (NOT (es_servicio AND maneja_inventario))
);
CREATE UNIQUE INDEX ux_productos_barras ON productos (codigo_barras) WHERE codigo_barras IS NOT NULL;
CREATE INDEX ix_productos_nombre_trgm ON productos USING gin (nombre gin_trgm_ops);
CREATE INDEX ix_productos_stock_bajo ON productos (id)
    WHERE maneja_inventario AND activo AND stock_actual <= stock_minimo;

-- Kardex
CREATE TABLE movimientos_inventario (
    id                  BIGSERIAL PRIMARY KEY,
    producto_id         UUID NOT NULL REFERENCES productos(id),
    tipo                tipo_mov_inv NOT NULL,
    cantidad            NUMERIC(14,4) NOT NULL,      -- + entra / - sale
    stock_resultante    NUMERIC(14,4) NOT NULL,
    costo_unitario      NUMERIC(18,4),
    referencia_tipo     VARCHAR(20),
    referencia_id       UUID,
    usuario_id          UUID REFERENCES usuarios(id),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_mov_inv_producto ON movimientos_inventario (producto_id, creado_en DESC);

-- -----------------------------------------------------------------------------
-- 6. Cajas (turnos)
-- -----------------------------------------------------------------------------
CREATE TABLE cajas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    terminal_id         UUID NOT NULL REFERENCES terminales(id),
    usuario_id          UUID NOT NULL REFERENCES usuarios(id),
    estado              estado_caja NOT NULL DEFAULT 'abierta',
    monto_inicial       NUMERIC(18,2) NOT NULL CHECK (monto_inicial >= 0),
    abierta_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
    cerrada_en          TIMESTAMPTZ,
    cerrada_por         UUID REFERENCES usuarios(id),
    efectivo_esperado   NUMERIC(18,2),
    efectivo_contado    NUMERIC(18,2),
    diferencia          NUMERIC(18,2) GENERATED ALWAYS AS (efectivo_contado - efectivo_esperado) STORED,
    detalle_arqueo      JSONB,                      -- {"2000": 3, "1000": 5, "500": 2, ...}
    observaciones       TEXT,
    CONSTRAINT chk_cierre CHECK (
        estado = 'abierta' OR (cerrada_en IS NOT NULL AND efectivo_contado IS NOT NULL)
    )
);
CREATE UNIQUE INDEX ux_caja_abierta_terminal ON cajas (terminal_id) WHERE estado = 'abierta';
CREATE UNIQUE INDEX ux_caja_abierta_usuario  ON cajas (usuario_id)  WHERE estado = 'abierta';

CREATE TABLE movimientos_caja (
    id              BIGSERIAL PRIMARY KEY,
    caja_id         UUID NOT NULL REFERENCES cajas(id),
    tipo            tipo_mov_caja NOT NULL,
    monto           NUMERIC(18,2) NOT NULL CHECK (monto > 0),
    motivo          VARCHAR(200) NOT NULL,
    usuario_id      UUID NOT NULL REFERENCES usuarios(id),
    autorizado_por  UUID REFERENCES usuarios(id),    -- supervisor en salidas
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_mov_caja_caja ON movimientos_caja (caja_id);

-- -----------------------------------------------------------------------------
-- 7. Ventas
-- -----------------------------------------------------------------------------
CREATE TABLE ventas (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key     UUID NOT NULL UNIQUE,         -- doble clic / reintento no duplica
    caja_id             UUID NOT NULL REFERENCES cajas(id),
    cliente_id          UUID NOT NULL REFERENCES clientes(id),
    usuario_id          UUID NOT NULL REFERENCES usuarios(id),
    estado              estado_venta NOT NULL DEFAULT 'completada',
    -- Totales con la misma partición que <Totales> del e-CF
    monto_gravado_i1    NUMERIC(18,2) NOT NULL DEFAULT 0,  -- base 18 %
    monto_gravado_i2    NUMERIC(18,2) NOT NULL DEFAULT 0,  -- base 16 %
    monto_gravado_i3    NUMERIC(18,2) NOT NULL DEFAULT 0,  -- base 0 %
    monto_exento        NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_itbis1        NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_itbis2        NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_descuento     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (total_descuento >= 0),
    total_itbis         NUMERIC(18,2) GENERATED ALWAYS AS (total_itbis1 + total_itbis2) STORED,
    monto_total         NUMERIC(18,2) NOT NULL CHECK (monto_total >= 0),
    total_pagado        NUMERIC(18,2) NOT NULL,
    cambio              NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (cambio >= 0),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    anulada_en          TIMESTAMPTZ,
    anulada_por         UUID REFERENCES usuarios(id),
    motivo_anulacion    VARCHAR(200),
    CONSTRAINT chk_cuadre CHECK (
        monto_total = monto_gravado_i1 + monto_gravado_i2 + monto_gravado_i3 + monto_exento
                    + total_itbis1 + total_itbis2
    ),
    CONSTRAINT chk_pago CHECK (estado <> 'completada' OR total_pagado - cambio = monto_total)
);
CREATE INDEX ix_ventas_caja    ON ventas (caja_id);
CREATE INDEX ix_ventas_fecha   ON ventas (creado_en DESC);
CREATE INDEX ix_ventas_cliente ON ventas (cliente_id);

CREATE TABLE detalles_venta (
    id                  BIGSERIAL PRIMARY KEY,
    venta_id            UUID NOT NULL REFERENCES ventas(id) ON DELETE RESTRICT,
    numero_linea        SMALLINT NOT NULL,           -- <NumeroLinea>
    producto_id         UUID NOT NULL REFERENCES productos(id),
    -- Snapshot congelado al momento de la venta
    codigo_interno      VARCHAR(35) NOT NULL,
    nombre              VARCHAR(80) NOT NULL,
    es_servicio         BOOLEAN NOT NULL,
    unidad_medida       SMALLINT,
    cantidad            NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
    precio_unitario     NUMERIC(18,4) NOT NULL CHECK (precio_unitario >= 0), -- sin ITBIS
    descuento_monto     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (descuento_monto >= 0),
    monto_item          NUMERIC(18,2) NOT NULL,      -- <MontoItem> = cant × precio − descuento (sin ITBIS)
    indicador_itbis     SMALLINT NOT NULL REFERENCES tasas_itbis(indicador),
    itbis_item          NUMERIC(18,2) NOT NULL DEFAULT 0, -- control interno, no va por línea en el XML
    UNIQUE (venta_id, numero_linea),
    CONSTRAINT chk_linea CHECK (numero_linea BETWEEN 1 AND 1000),
    CONSTRAINT chk_monto_item CHECK (monto_item >= 0)
);
CREATE INDEX ix_detalles_producto ON detalles_venta (producto_id);

CREATE TABLE pagos_venta (
    id          BIGSERIAL PRIMARY KEY,
    venta_id    UUID NOT NULL REFERENCES ventas(id) ON DELETE RESTRICT,
    metodo      metodo_pago NOT NULL,
    monto       NUMERIC(18,2) NOT NULL CHECK (monto > 0),
    referencia  VARCHAR(100),                        -- aprobación tarjeta / # transferencia
    ultimos4    CHAR(4),                             -- nunca el número completo de tarjeta
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_referencia CHECK (metodo IN ('efectivo', 'credito', 'otro') OR referencia IS NOT NULL)
);
CREATE INDEX ix_pagos_venta ON pagos_venta (venta_id);

-- -----------------------------------------------------------------------------
-- 8. Comprobantes fiscales electrónicos (e-CF)
-- -----------------------------------------------------------------------------
CREATE TABLE facturas_electronicas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venta_id                UUID REFERENCES ventas(id),          -- NULL en notas de crédito sueltas
    emisor_id               UUID NOT NULL REFERENCES emisor(id),
    tipo_ecf                CHAR(2)  NOT NULL,                   -- 31, 32, 33, 34 ...
    encf                    CHAR(13) NOT NULL UNIQUE CHECK (encf ~ '^E\d{12}$'),
    fecha_vencimiento_sec   DATE,
    modalidad               modalidad_ecf NOT NULL DEFAULT 'normal',
    ncf_respaldo            CHAR(11) CHECK (ncf_respaldo ~ '^B\d{10}$'), -- NCF serie B entregado
    -- E32 < RD$250,000: a la DGII va el resumen (RFCE); el XML completo se conserva y se pone a
    -- disposición del cliente.
    es_consumo_resumido     BOOLEAN NOT NULL DEFAULT FALSE,
    monto_total             NUMERIC(18,2) NOT NULL,
    rnc_comprador           VARCHAR(11),
    fecha_emision           DATE NOT NULL,
    fecha_hora_firma        TIMESTAMP,                           -- hora local RD
    codigo_seguridad        CHAR(6),                             -- 6 primeros car. del SignatureValue
    xml_firmado             TEXT,
    xml_rfce_firmado        TEXT,
    url_qr                  TEXT,
    estado                  estado_ecf NOT NULL DEFAULT 'pendiente',
    track_id                VARCHAR(60),
    respuesta_dgii          JSONB,
    -- Plazos de envío diferido
    limite_envio            TIMESTAMPTZ,                         -- emisión + 72 h, o fin contingencia + 30 días
    intentos                SMALLINT NOT NULL DEFAULT 0,
    proximo_intento_en      TIMESTAMPTZ,
    ultimo_error            TEXT,
    correo_enviado_en       TIMESTAMPTZ,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_consumo_resumido CHECK (NOT es_consumo_resumido OR (tipo_ecf = '32' AND monto_total < 250000)),
    CONSTRAINT chk_e31_comprador    CHECK (tipo_ecf <> '31' OR rnc_comprador IS NOT NULL),
    CONSTRAINT chk_e32_grande       CHECK (tipo_ecf <> '32' OR monto_total < 250000 OR rnc_comprador IS NOT NULL),
    CONSTRAINT chk_respaldo         CHECK (modalidad <> 'respaldo_serie_b' OR ncf_respaldo IS NOT NULL),
    CONSTRAINT chk_firmado          CHECK (estado = 'pendiente' OR (xml_firmado IS NOT NULL AND codigo_seguridad IS NOT NULL))
);
CREATE UNIQUE INDEX ux_fe_venta ON facturas_electronicas (venta_id) WHERE venta_id IS NOT NULL;
-- Cola del worker de transmisión
CREATE INDEX ix_fe_cola ON facturas_electronicas (proximo_intento_en NULLS FIRST, creado_en)
    WHERE estado IN ('pendiente', 'firmado', 'enviado');

-- Bitácora: envíos, respuestas, errores, entrada/salida de contingencia
CREATE TABLE eventos_fe (
    id          BIGSERIAL PRIMARY KEY,
    factura_id  UUID REFERENCES facturas_electronicas(id),
    tipo        VARCHAR(40) NOT NULL,
    detalle     JSONB,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_eventos_fe ON eventos_fe (factura_id, creado_en);

-- Periodos de contingencia (también hay que notificarlos en la Oficina Virtual cuando
-- se usan comprobantes serie B)
CREATE TABLE contingencias (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sucursal_id         UUID REFERENCES sucursales(id),          -- NULL = contingencia total
    tipo                VARCHAR(20) NOT NULL CHECK (tipo IN ('conectividad', 'emision')),
    inicio              TIMESTAMPTZ NOT NULL DEFAULT now(),
    fin                 TIMESTAMPTZ,
    motivo              VARCHAR(250) NOT NULL,
    notificada_ofv      BOOLEAN NOT NULL DEFAULT FALSE,
    abierta_por         UUID REFERENCES usuarios(id)
);
CREATE UNIQUE INDEX ux_contingencia_abierta ON contingencias (COALESCE(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE fin IS NULL;

-- -----------------------------------------------------------------------------
-- 9. Auditoría
-- -----------------------------------------------------------------------------
CREATE TABLE auditoria (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  UUID REFERENCES usuarios(id),
    accion      VARCHAR(60) NOT NULL,
    entidad     VARCHAR(40) NOT NULL,
    entidad_id  TEXT,
    antes       JSONB,
    despues     JSONB,
    ip          INET,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_entidad ON auditoria (entidad, entidad_id);

-- -----------------------------------------------------------------------------
-- 10. Funciones y triggers
-- -----------------------------------------------------------------------------

-- 10.1 Toma el siguiente NCF / e-NCF de la secuencia activa. Bloquea la fila: dos cajas
--      nunca obtienen el mismo número y no quedan huecos si la transacción se revierte.
CREATE OR REPLACE FUNCTION tomar_ncf(p_emisor UUID, p_serie CHAR(1), p_tipo CHAR(2),
                                     OUT ncf TEXT, OUT vence DATE, OUT restantes BIGINT)
LANGUAGE plpgsql AS $$
DECLARE s secuencias_ncf%ROWTYPE;
BEGIN
    SELECT * INTO s FROM secuencias_ncf
     WHERE emisor_id = p_emisor AND serie = p_serie AND tipo = p_tipo AND activa
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No hay secuencia activa para %', p_serie || p_tipo USING ERRCODE = 'P0002';
    END IF;
    IF s.fecha_vencimiento IS NOT NULL AND s.fecha_vencimiento < current_date THEN
        RAISE EXCEPTION 'La secuencia % venció el %', p_serie || p_tipo, s.fecha_vencimiento USING ERRCODE = 'P0003';
    END IF;
    IF s.ultimo_usado >= s.hasta THEN
        RAISE EXCEPTION 'Secuencia % agotada', p_serie || p_tipo USING ERRCODE = 'P0004';
    END IF;

    UPDATE secuencias_ncf SET ultimo_usado = ultimo_usado + 1 WHERE id = s.id;

    ncf := p_serie || p_tipo || lpad((s.ultimo_usado + 1)::text, CASE p_serie WHEN 'E' THEN 10 ELSE 8 END, '0');
    vence := s.fecha_vencimiento;
    restantes := s.hasta - s.ultimo_usado - 1;
END $$;

-- 10.2 Descuento de stock + kardex
CREATE OR REPLACE FUNCTION trg_detalle_descuenta_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_stock NUMERIC(14,4); v_usuario UUID;
BEGIN
    UPDATE productos
       SET stock_actual = stock_actual - NEW.cantidad, actualizado_en = now()
     WHERE id = NEW.producto_id AND maneja_inventario
    RETURNING stock_actual INTO v_stock;

    IF FOUND THEN
        SELECT usuario_id INTO v_usuario FROM ventas WHERE id = NEW.venta_id;
        INSERT INTO movimientos_inventario
            (producto_id, tipo, cantidad, stock_resultante, referencia_tipo, referencia_id, usuario_id)
        VALUES (NEW.producto_id, 'venta', -NEW.cantidad, v_stock, 'venta', NEW.venta_id, v_usuario);
    END IF;
    RETURN NEW;   -- si el stock queda negativo, chk_stock_no_negativo aborta toda la venta
END $$;

CREATE TRIGGER detalle_descuenta_stock
AFTER INSERT ON detalles_venta
FOR EACH ROW EXECUTE FUNCTION trg_detalle_descuenta_stock();

-- 10.3 Reponer stock al anular
CREATE OR REPLACE FUNCTION trg_venta_anulada_repone_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r RECORD; v_stock NUMERIC(14,4);
BEGIN
    IF NEW.estado = 'anulada' AND OLD.estado <> 'anulada' THEN
        FOR r IN SELECT producto_id, cantidad FROM detalles_venta WHERE venta_id = NEW.id LOOP
            UPDATE productos SET stock_actual = stock_actual + r.cantidad, actualizado_en = now()
             WHERE id = r.producto_id AND maneja_inventario
            RETURNING stock_actual INTO v_stock;
            IF FOUND THEN
                INSERT INTO movimientos_inventario
                    (producto_id, tipo, cantidad, stock_resultante, referencia_tipo, referencia_id, usuario_id)
                VALUES (r.producto_id, 'anulacion_venta', r.cantidad, v_stock, 'venta', NEW.id, NEW.anulada_por);
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER venta_anulada_repone_stock
AFTER UPDATE OF estado ON ventas
FOR EACH ROW EXECUTE FUNCTION trg_venta_anulada_repone_stock();

-- 10.4 No vender con la caja cerrada
CREATE OR REPLACE FUNCTION trg_venta_requiere_caja_abierta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cajas WHERE id = NEW.caja_id AND estado = 'abierta') THEN
        RAISE EXCEPTION 'La caja % no está abierta', NEW.caja_id USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER venta_requiere_caja_abierta
BEFORE INSERT ON ventas
FOR EACH ROW EXECUTE FUNCTION trg_venta_requiere_caja_abierta();

-- 10.5 Inmutabilidad fiscal: un e-CF firmado no cambia su XML ni su e-NCF.
--      Errores en un e-CF aceptado se corrigen con E33/E34, nunca editando.
CREATE OR REPLACE FUNCTION trg_fe_inmutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.xml_firmado IS NOT NULL AND (NEW.xml_firmado IS DISTINCT FROM OLD.xml_firmado
                                        OR NEW.encf IS DISTINCT FROM OLD.encf
                                        OR NEW.monto_total IS DISTINCT FROM OLD.monto_total) THEN
        RAISE EXCEPTION 'e-CF % ya firmado: XML, e-NCF y monto son inmutables', OLD.encf;
    END IF;
    IF OLD.estado IN ('aceptado', 'aceptado_condicional') AND NEW.estado NOT IN (OLD.estado, 'anulado') THEN
        RAISE EXCEPTION 'e-CF % ya aceptado por la DGII', OLD.encf;
    END IF;
    NEW.actualizado_en := now();
    RETURN NEW;
END $$;

CREATE TRIGGER fe_inmutable
BEFORE UPDATE ON facturas_electronicas
FOR EACH ROW EXECUTE FUNCTION trg_fe_inmutable();

-- -----------------------------------------------------------------------------
-- 11. Vistas
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_resumen_caja AS
SELECT
    c.id AS caja_id,
    c.estado,
    c.monto_inicial,
    COALESCE(pe.efectivo, 0)  AS ventas_efectivo,
    COALESCE(v.cambios, 0)    AS cambio_entregado,
    COALESCE(m.entradas, 0)   AS entradas,
    COALESCE(m.salidas, 0)    AS salidas,
    c.monto_inicial + COALESCE(pe.efectivo, 0) - COALESCE(v.cambios, 0)
        + COALESCE(m.entradas, 0) - COALESCE(m.salidas, 0) AS efectivo_esperado,
    COALESCE(v.total_ventas, 0) AS total_ventas,
    COALESCE(v.total_itbis, 0)  AS total_itbis,
    COALESCE(v.num_ventas, 0)   AS num_ventas,
    pm.por_metodo
FROM cajas c
LEFT JOIN LATERAL (
    SELECT SUM(monto_total) AS total_ventas, SUM(total_itbis) AS total_itbis,
           SUM(cambio) AS cambios, COUNT(*) AS num_ventas
      FROM ventas WHERE caja_id = c.id AND estado = 'completada'
) v ON TRUE
LEFT JOIN LATERAL (
    SELECT SUM(p.monto) AS efectivo
      FROM pagos_venta p JOIN ventas vv ON vv.id = p.venta_id
     WHERE vv.caja_id = c.id AND vv.estado = 'completada' AND p.metodo = 'efectivo'
) pe ON TRUE
LEFT JOIN LATERAL (
    SELECT SUM(monto) FILTER (WHERE tipo = 'entrada') AS entradas,
           SUM(monto) FILTER (WHERE tipo = 'salida')  AS salidas
      FROM movimientos_caja WHERE caja_id = c.id
) m ON TRUE
LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(metodo, monto) AS por_metodo FROM (
        SELECT p.metodo, SUM(p.monto) AS monto
          FROM pagos_venta p JOIN ventas vv ON vv.id = p.venta_id
         WHERE vv.caja_id = c.id AND vv.estado = 'completada'
         GROUP BY p.metodo
    ) x
) pm ON TRUE;

CREATE OR REPLACE VIEW v_stock_bajo AS
SELECT id, codigo_interno, codigo_barras, nombre, stock_actual, stock_minimo
  FROM productos
 WHERE maneja_inventario AND activo AND stock_actual <= stock_minimo
 ORDER BY stock_actual - stock_minimo;

CREATE OR REPLACE VIEW v_secuencias_estado AS
SELECT serie || tipo AS comprobante, desde, hasta, ultimo_usado,
       hasta - ultimo_usado AS restantes, fecha_vencimiento,
       (hasta - ultimo_usado) <= alerta_restantes AS alerta
  FROM secuencias_ncf WHERE activa;

-- e-CF pendientes de envío, con el tiempo que les queda antes de vencer el plazo
CREATE OR REPLACE VIEW v_ecf_pendientes AS
SELECT id, encf, tipo_ecf, modalidad, estado, intentos, ultimo_error,
       fecha_hora_firma, limite_envio, limite_envio - now() AS tiempo_restante
  FROM facturas_electronicas
 WHERE estado IN ('pendiente', 'firmado', 'enviado', 'rechazado')
 ORDER BY limite_envio NULLS LAST;

COMMIT;
