-- =============================================================================
--  004 · Secuencias de PRUEBA para E44 / E45 en instalaciones que aún no las
--  tienen. Solo en ambientes de prueba (TesteCF / CerteCF), nunca en producción.
-- =============================================================================
SET search_path TO pos, public;

INSERT INTO secuencias_ncf (emisor_id, serie, tipo, desde, hasta, ultimo_usado, fecha_vencimiento)
SELECT e.id, 'E', t.tipo, 1, 1000, 0, (current_date + interval '1 year')::date
  FROM emisor e
 CROSS JOIN (VALUES ('44'), ('45')) AS t(tipo)
 WHERE e.ambiente <> 'eCF'
   AND NOT EXISTS (SELECT 1 FROM secuencias_ncf s WHERE s.emisor_id = e.id AND s.serie = 'E' AND s.tipo = t.tipo);
