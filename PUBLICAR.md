# Cómo se publica una actualización

1. Hacer los cambios y subir `version` en `version.json` (ej. 2.0.0 → 2.1.0).
2. Agregar una entrada al inicio de `historial` con la fecha y la lista de cambios (es lo que ve el usuario).
3. Si hay cambios en la base de datos, crear una migración nueva **idempotente** en `database/migraciones/` (005_..., 006_...). Nunca editar ni borrar migraciones ya publicadas.
4. Hacer commit y `git push` a la rama `main`.

Cada POS revisa cada 6 horas (o al pulsar "Buscar actualizaciones") y muestra el aviso. Al pulsar
"Actualizar ahora": descarga, respalda base de datos y código en `.respaldos/`, instala, recompila
y reinicia. Si la versión nueva no arranca, vuelve sola a la anterior.
