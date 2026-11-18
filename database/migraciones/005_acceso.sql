-- =============================================================================
--  005 · Login por credenciales y solicitudes de acceso · idempotente
-- =============================================================================
SET search_path TO pos, public;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS correo VARCHAR(120);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_correo ON usuarios (lower(correo)) WHERE correo IS NOT NULL;

DO $$ BEGIN
    CREATE TYPE estado_solicitud AS ENUM ('pendiente', 'aprobada', 'rechazada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS solicitudes_acceso (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre          VARCHAR(100) NOT NULL,
    contacto        VARCHAR(120) NOT NULL,          -- correo o teléfono
    rol_solicitado  rol_usuario  NOT NULL,
    nota            VARCHAR(300),
    estado          estado_solicitud NOT NULL DEFAULT 'pendiente',
    ip              INET,
    usuario_id      UUID REFERENCES usuarios(id),   -- usuario creado al aprobar
    resuelta_por    UUID REFERENCES usuarios(id),
    resuelta_en     TIMESTAMPTZ,
    motivo_rechazo  VARCHAR(200),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_solicitudes_pendientes ON solicitudes_acceso (creado_en DESC) WHERE estado = 'pendiente';

-- Marca de la empresa para la pantalla de entrada (logo en data URL)
INSERT INTO configuracion (clave, valor) VALUES ('marca', '{"logo": null}')
ON CONFLICT (clave) DO NOTHING;
