@echo off
setlocal
cd /d "%~dp0"
set "MDBBIN=C:\Program Files\MariaDB 12.3\bin"
set "DATADIR=%~dp0.mariadb-data"

if not exist "%MDBBIN%\mysqld.exe" (
  echo No encuentro MariaDB en Program Files. Instalalo con:
  echo   winget install --id MariaDB.Server -e
  pause
  exit /b 1
)

if not exist "%DATADIR%\mysql" (
  echo Inicializando datos locales en .mariadb-data ...
  "%MDBBIN%\mariadb-install-db.exe" --datadir="%DATADIR%"
  if errorlevel 1 (
    echo Fallo al inicializar MariaDB.
    pause
    exit /b 1
  )
)

echo Arrancando MariaDB en 127.0.0.1:3306 ...
start "DAYLY-MariaDB" /MIN "%MDBBIN%\mysqld.exe" --datadir="%DATADIR%" --port=3306 --bind-address=127.0.0.1 --console

timeout /t 4 /nobreak >nul

"%MDBBIN%\mariadb.exe" -u root -e "CREATE DATABASE IF NOT EXISTS dayly CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS 'dayly'@'localhost' IDENTIFIED BY 'dayly_dev_62965dda866d'; GRANT ALL PRIVILEGES ON dayly.* TO 'dayly'@'localhost'; FLUSH PRIVILEGES;"
if errorlevel 1 (
  echo No pude crear el usuario dayly. Si MariaDB pide clave de root, configurala a mano.
  pause
  exit /b 1
)

echo.
echo MariaDB listo. Base: dayly  usuario: dayly
echo Siguiente:  npm run db:migrate   y   npm run db:seed
echo.
endlocal
