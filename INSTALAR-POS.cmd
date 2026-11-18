@echo off
chcp 65001 >nul
title Instalador POS DGII
echo ============================================
echo   Instalador POS DGII - Republica Dominicana
echo ============================================
echo.

set "ORIGEN=%~dp0"
set "DESTINO=C:\proyectos\pos-dgii-rd"
set "PG=C:\Program Files\PostgreSQL\17\bin"
set "PGPASSWORD=pos12345"
set "PGCLIENTENCODING=UTF8"
set "DATABASE_URL=postgres://postgres:pos12345@localhost:5432/pos_rd"

if not exist "%ORIGEN%database\schema.sql" (
  echo [ERROR] Primero extrae el zip: clic derecho sobre el .zip ^> "Extraer todo".
  goto fin
)
if not exist "%PG%\psql.exe" (
  echo [ERROR] No encuentro PostgreSQL 17 en "%PG%".
  goto fin
)

echo [1/6] Copiando el proyecto a %DESTINO% ...
robocopy "%ORIGEN%." "%DESTINO%" /E /XD node_modules dist .datos /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( echo [ERROR] No se pudo copiar el proyecto. & goto fin )
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%DESTINO%' -Recurse -File | Unblock-File" >nul 2>&1

echo.
echo [2/6] Instalando dependencias del servidor ...
cd /d "%DESTINO%\apps\api" || goto fin
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto fin

echo.
echo [3/6] Instalando y compilando la pantalla del POS ...
cd /d "%DESTINO%\apps\web" || goto fin
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto fin
call npm.cmd run build
if errorlevel 1 goto fin

echo.
echo [4/6] Revisando la base de datos ...
cd /d "%DESTINO%\apps\api"
set "USUARIOS=0"
"%PG%\psql.exe" -U postgres -d pos_rd -tAc "SELECT count(*) FROM usuarios WHERE pin_hash IS NOT NULL" > "%TEMP%\pos_usr.txt" 2>nul
set /p USUARIOS=<"%TEMP%\pos_usr.txt"
if "%USUARIOS%"=="" set "USUARIOS=0"
if "%USUARIOS%"=="0" (
  echo       Base nueva: creando tablas y datos iniciales ...
  "%PG%\dropdb.exe" -U postgres --if-exists pos_rd
  "%PG%\createdb.exe" -U postgres pos_rd || goto fin
  "%PG%\psql.exe" -U postgres -d pos_rd -q -v ON_ERROR_STOP=1 -f "..\..\database\schema.sql" || goto fin
  call npm.cmd run seed || goto fin
) else (
  echo       La base ya tiene datos: se conservan tus ventas.
)

echo.
echo [5/6] Creando acceso directo en el escritorio ...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Punto de Venta.lnk'); $s.TargetPath='%DESTINO%\INICIAR-POS.cmd'; $s.WorkingDirectory='%DESTINO%'; $s.IconLocation='%SystemRoot%\System32\shell32.dll,43'; $s.Save()" >nul 2>&1

echo.
echo [6/6] Iniciando el POS ...
call "%DESTINO%\INICIAR-POS.cmd"
goto :eof

:fin
echo.
pause
