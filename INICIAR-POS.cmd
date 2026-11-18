@echo off
chcp 65001 >nul
set "DESTINO=C:\proyectos\pos-dgii-rd"
set "DATABASE_URL=postgres://postgres:pos12345@localhost:5432/pos_rd"
set "DGII_AMBIENTE=TesteCF"
rem --- Cuando tengas tu certificado real, quita "rem" de estas dos lineas:
rem set "CERT_P12_PATH=C:\proyectos\certificado\firma.p12"
rem set "CERT_P12_PASSWORD=tu-clave"

curl.exe -s -o nul http://localhost:3000/api/auth/usuarios
if errorlevel 1 (
  start "POS DGII - servidor (no cierres esta ventana)" /min cmd /k "cd /d %DESTINO%\apps\api && node lanzador.mjs"
  echo Iniciando el servidor del POS ...
  timeout /t 8 /nobreak >nul
)
start "" http://localhost:3000
