@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul

set "DB_CONTAINER=dayly-demo-db"
set "DB_PORT=3307"

echo.
echo  Kalendiario — local
echo  ===================
echo  Web:  http://localhost:5173
echo  API:  http://localhost:4000
echo.
echo  Admin  admin@dayly.dev  /  Admin123456
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo No encuentro Docker. Instala Docker Desktop o usa setup-mariadb.bat.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker no esta en marcha. Abre Docker Desktop y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

docker inspect "%DB_CONTAINER%" >nul 2>&1
if errorlevel 1 (
  echo No encuentro el contenedor %DB_CONTAINER% ^(MariaDB en el puerto %DB_PORT%^).
  echo Si usas MariaDB instalado en el sistema, ejecuta setup-mariadb.bat.
  pause
  exit /b 1
)

echo Arrancando MariaDB ^(%DB_CONTAINER%^)...
docker start "%DB_CONTAINER%" >nul
if errorlevel 1 (
  echo No pude arrancar el contenedor %DB_CONTAINER%.
  pause
  exit /b 1
)

echo Esperando a que MariaDB acepte conexiones...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 40;$i++){ try { $c=New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1',%DB_PORT%); $c.Close(); $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
  echo MariaDB no respondio en 127.0.0.1:%DB_PORT%.
  pause
  exit /b 1
)

echo Aplicando migraciones...
call npx prisma migrate deploy --schema=server/prisma/schema.prisma
if errorlevel 1 (
  echo Fallo prisma migrate. Revisa el error de arriba.
  pause
  exit /b 1
)

echo.
echo Arrancando API y web. Cierra esta ventana para pararlos.
echo.
call npm run dev
if errorlevel 1 pause
endlocal
