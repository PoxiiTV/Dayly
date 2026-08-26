@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  DAYLY — build de produccion -^> deploy-hosting\
echo.

if not exist ".env" (
  echo ERROR: falta .env en la raiz. No se puede empaquetar.
  pause
  exit /b 1
)

echo [1/3] Compilando server + client...
call npm run build
if errorlevel 1 (
  echo ERROR: el build ha fallado.
  pause
  exit /b 1
)

echo [2/3] Limpiando carpeta deploy-hosting...
if exist "deploy-hosting" rmdir /s /q "deploy-hosting"
mkdir "deploy-hosting\server\dist"
mkdir "deploy-hosting\server\prisma"
mkdir "deploy-hosting\client\dist"

echo [3/3] Copiando archivos de produccion...
copy /y "app.mjs" "deploy-hosting\app.mjs" >nul
copy /y "plesk-package.json" "deploy-hosting\package.json" >nul
copy /y ".env" "deploy-hosting\.env" >nul
xcopy /e /i /y /q "server\dist" "deploy-hosting\server\dist" >nul
xcopy /e /i /y /q "server\prisma" "deploy-hosting\server\prisma" >nul
xcopy /e /i /y /q "client\dist" "deploy-hosting\client\dist" >nul

> "deploy-hosting\start.bat" (
  echo @echo off
  echo cd /d "%%~dp0"
  echo echo DAYLY produccion — API + frontend en el puerto del .env ^(por defecto 4000^)
  echo call npm install --omit=dev
  echo if errorlevel 1 pause ^& exit /b 1
  echo call npx prisma generate --schema=server/prisma/schema.prisma
  echo call npm run start
  echo if errorlevel 1 pause
)

echo.
echo  Listo: deploy-hosting\
echo  Incluye .env real. No incluye node_modules, src ni vite.config.
echo  En el hosting: entra en deploy-hosting y ejecuta start.bat
echo  ^(o npm install --omit=dev ^&^& npm start^)
echo.
pause
endlocal
