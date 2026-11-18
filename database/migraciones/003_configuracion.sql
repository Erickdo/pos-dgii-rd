-- =============================================================================
--  003 · Configuración general (impresora, preferencias) · idempotente
-- =============================================================================
SET search_path TO pos, public;

CREATE TABLE IF NOT EXISTS configuracion (
    clave           VARCHAR(60) PRIMARY KEY,
    valor           JSONB NOT NULL,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO configuracion (clave, valor) VALUES
    ('impresora', '{"ancho": "80", "copias": 1, "mensajePie": "¡Gracias por su compra!", "imprimirAutomatico": false}')
ON CONFLICT (clave) DO NOTHING;
