@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

set "MDBBIN=C:\Program Files\MariaDB 12.3\bin"
set "DATADIR=%~dp0.mariadb-data"

echo.
echo  DAYLY - modo desarrollo
echo  =======================
echo  Web:  http://localhost:5173
echo  API:  http://localhost:4000
echo.
echo  Cuentas seed (si ya corriste npm run db:seed con SEED_DEMO=true):
echo    Admin  admin@dayly.dev   /  Admin123456
echo    Demo   demo@dayly.dev    /  Demo123456
echo.

rem MariaDB local: si no escucha en 3306 y existe la carpeta de datos, se arranca sola.
powershell -NoProfile -Command "try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',3306); $c.Close(); exit 0 } catch { exit 1 }"
if not errorlevel 1 goto run
if not exist "%DATADIR%\mysql" goto nodb
if not exist "%MDBBIN%\mysqld.exe" goto nodb

echo Arrancando MariaDB local...
start "DAYLY-MariaDB" /MIN "%MDBBIN%\mysqld.exe" --datadir="%DATADIR%" --port=3306 --bind-address=127.0.0.1 --console
powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){ try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',3306); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (
  echo MariaDB no respondio en 127.0.0.1:3306.
  pause
  exit /b 1
)
goto run

:nodb
echo MariaDB no esta en marcha en el puerto 3306.
echo Ejecuta setup-mariadb.bat la primera vez.
pause
exit /b 1

:run
call npm run dev
if errorlevel 1 pause
endlocal
