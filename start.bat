@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo  DAYLY - modo desarrollo
echo  =======================
echo  Web:  http://localhost:5173
echo  API:  http://localhost:4000
echo.
echo  Cuentas seed (si ya corriste npm run db:seed):
echo    Admin  admin@dayly.dev   /  Admin123456
echo    Demo   alexis@dayly.dev  /  Demo123456
echo.
echo  MariaDB debe estar en marcha (puerto 3306).
echo  Si no arranca: ejecuta setup-mariadb.bat
echo.

call npm run dev
if errorlevel 1 pause
endlocal
