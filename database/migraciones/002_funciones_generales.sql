-- =============================================================================
--  002 · Funciones generales: compras, cuentas por cobrar, notas de crédito E34
--  Idempotente: el servidor la aplica en cada arranque.
-- =============================================================================
SET search_path TO pos, public;

CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------- compras
CREATE TABLE IF NOT EXISTS compras (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor_nombre  VARCHAR(150) NOT NULL,
    proveedor_rnc     VARCHAR(11),
    ncf_proveedor     VARCHAR(19),                 -- comprobante del proveedor (para el 606)
    fecha             DATE NOT NULL DEFAULT current_date,
    total             NUMERIC(18,2) NOT NULL DEFAULT 0,
    itbis_pagado      NUMERIC(18,2) NOT NULL DEFAULT 0,
    notas             TEXT,
    usuario_id        UUID NOT NULL REFERENCES usuarios(id),
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compras_detalle (
    id              BIGSERIAL PRIMARY KEY,
    compra_id       UUID NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    producto_id     UUID NOT NULL REFERENCES productos(id),
    cantidad        NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
    costo_unitario  NUMERIC(18,4) NOT NULL CHECK (costo_unitario >= 0)
);
CREATE INDEX IF NOT EXISTS ix_compras_fecha ON compras (fecha DESC);

-- ---------------------------------------------------------------- cuentas por cobrar
CREATE TABLE IF NOT EXISTS abonos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id  UUID NOT NULL REFERENCES clientes(id),
    monto       NUMERIC(18,2) NOT NULL CHECK (monto > 0),
    metodo      metodo_pago NOT NULL CHECK (metodo <> 'credito'),
    referencia  VARCHAR(100),
    caja_id     UUID REFERENCES cajas(id),          -- si entró efectivo a una caja abierta
    usuario_id  UUID NOT NULL REFERENCES usuarios(id),
    notas       VARCHAR(200),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_abonos_cliente ON abonos (cliente_id, creado_en DESC);

-- Saldo = ventas a crédito vigentes − abonos
CREATE OR REPLACE VIEW v_saldos_clientes AS
SELECT c.id AS cliente_id, c.nombre, c.identificacion, c.limite_credito,
       COALESCE(cr.credito, 0)  AS total_credito,
       COALESCE(ab.abonado, 0)  AS total_abonado,
       COALESCE(cr.credito, 0) - COALESCE(ab.abonado, 0) AS saldo,
       cr.ultima_venta, ab.ultimo_abono
  FROM clientes c
  LEFT JOIN LATERAL (
      SELECT SUM(p.monto) AS credito, MAX(v.creado_en) AS ultima_venta
        FROM pagos_venta p JOIN ventas v ON v.id = p.venta_id
       WHERE v.cliente_id = c.id AND v.estado = 'completada' AND p.metodo = 'credito'
  ) cr ON TRUE
  LEFT JOIN LATERAL (
      SELECT SUM(monto) AS abonado, MAX(creado_en) AS ultimo_abono FROM abonos WHERE cliente_id = c.id
  ) ab ON TRUE
 WHERE cr.credito IS NOT NULL OR ab.abonado IS NOT NULL;

-- ---------------------------------------------------------------- notas de crédito E34
ALTER TABLE facturas_electronicas ADD COLUMN IF NOT EXISTS referencia_fe_id UUID REFERENCES facturas_electronicas(id);
ALTER TABLE facturas_electronicas ADD COLUMN IF NOT EXISTS motivo VARCHAR(200);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fe_una_nc_por_factura ON facturas_electronicas (referencia_fe_id)
    WHERE referencia_fe_id IS NOT NULL AND tipo_ecf = '34';

-- La factura original pasa a 'anulado' a nivel de venta, no de e-CF: el e-CF aceptado no se toca.
-- (fe_inmutable ya impide editarlo)

-- ---------------------------------------------------------------- vistas de reportes
CREATE OR REPLACE VIEW v_ventas_detalle AS
SELECT v.id, v.creado_en, (v.creado_en AT TIME ZONE 'America/Santo_Domingo')::date AS dia,
       extract(hour FROM v.creado_en AT TIME ZONE 'America/Santo_Domingo')::int AS hora,
       v.estado, v.monto_total, v.total_itbis, v.total_itbis1, v.total_itbis2, v.total_descuento,
       v.monto_gravado_i1 + v.monto_gravado_i2 + v.monto_gravado_i3 + v.monto_exento AS monto_sin_itbis,
       v.usuario_id, u.nombre AS cajero, v.cliente_id, c.nombre AS cliente, c.identificacion,
       c.tipo_identificacion, f.encf, f.tipo_ecf, f.estado AS estado_fiscal
  FROM ventas v
  JOIN usuarios u ON u.id = v.usuario_id
  JOIN clientes c ON c.id = v.cliente_id
  LEFT JOIN facturas_electronicas f ON f.venta_id = v.id;
