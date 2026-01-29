@echo off
setlocal enabledelayedexpansion

:: ============================================
:: REBEL Multi-Agent Orchestrator - Windows Installer
:: ============================================

title REBEL Installer

:: Colors via PowerShell wrapper
set "GREEN=[32m"
set "CYAN=[36m"
set "YELLOW=[33m"
set "RED=[31m"
set "WHITE=[97m"
set "NC=[0m"

echo.
echo %CYAN%  ____  _____ ____  _____ _     %NC%
echo %CYAN% ^|  _ \^| ____^| __ )^| ____^| ^|    %NC%
echo %CYAN% ^| ^|_) ^|  _  ^|  _ \^|  _  ^| ^|    %NC%
echo %CYAN% ^|  _ ^<^| ^|___^| ^|_) ^| ^|___^| ^|___ %NC%
echo %CYAN% ^|_^| \_\^_____^|____/^|_____^|_____^|%NC%
echo.
echo %WHITE% Multi-Agent Orchestrator - Windows Installer%NC%
echo %CYAN% ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%NC%
echo.

:: ============================================
:: Check Node.js
:: ============================================

echo %CYAN%[1/5]%NC% Verificando Node.js...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo %RED%[X]%NC% Node.js no encontrado
    echo.
    echo     Descarga Node.js desde: https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo %GREEN%[OK]%NC% Node.js %NODE_VERSION%

for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo %GREEN%[OK]%NC% npm %NPM_VERSION%

:: ============================================
:: Check CLI Tools
:: ============================================

echo.
echo %CYAN%[2/5]%NC% Verificando CLI Tools...

set GEMINI_FOUND=0
set QWEN_FOUND=0

where gemini >nul 2>nul
if %errorlevel% equ 0 (
    set GEMINI_FOUND=1
    echo %GREEN%[OK]%NC% Gemini CLI encontrado
) else (
    echo %YELLOW%[!]%NC% Gemini CLI no encontrado
)

where qwen >nul 2>nul
if %errorlevel% equ 0 (
    set QWEN_FOUND=1
    echo %GREEN%[OK]%NC% Qwen CLI encontrado
) else (
    echo %YELLOW%[!]%NC% Qwen CLI no encontrado
)

if %GEMINI_FOUND% equ 0 if %QWEN_FOUND% equ 0 (
    echo.
    echo %YELLOW%[!]%NC% Ningun CLI de agente encontrado
    echo     El sistema funcionara en modo limitado
    echo.
    set /p CONTINUE="    Continuar de todos modos? [Y/N] "
    if /i not "!CONTINUE!"=="Y" exit /b 1
)

:: ============================================
:: Install Backend
:: ============================================

echo.
echo %CYAN%[3/5]%NC% Instalando Backend...

cd backend

echo     Instalando dependencias...
call npm install --silent >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%[X]%NC% Error instalando dependencias
    cd ..
    pause
    exit /b 1
)
echo %GREEN%[OK]%NC% Dependencias instaladas

:: Create .env if not exists
if not exist ".env" (
    echo     Creando configuracion...
    (
        echo # REBEL Multi-Agent Orchestrator Configuration
        echo PORT=3001
        echo HOST=localhost
        echo GEMINI_CLI_PATH=gemini
        echo QWEN_CLI_PATH=qwen
        echo MAX_GEMINI_AGENTS=10
        echo MAX_QWEN_AGENTS=10
        echo DB_PATH=./data/orchestrator.db
        echo LOG_LEVEL=info
        echo ENABLE_RATE_LIMIT_FALLBACK=true
        echo ENABLE_PLAN_REFINEMENT=true
    ) > .env
    echo %GREEN%[OK]%NC% Configuracion creada
) else (
    echo %GREEN%[OK]%NC% Configuracion existente preservada
)

:: Create data directory
if not exist "data" mkdir data
echo %GREEN%[OK]%NC% Directorio de datos creado

cd ..

:: ============================================
:: Install Frontend
:: ============================================

echo.
echo %CYAN%[4/5]%NC% Instalando Frontend...

if exist "..\app" (
    cd ..\app
    echo     Instalando dependencias...
    call npm install --silent >nul 2>&1
    echo %GREEN%[OK]%NC% Frontend instalado
    cd ..\multi-agent-orchestrator
) else (
    echo %YELLOW%[!]%NC% Directorio frontend no encontrado, saltando
)

:: ============================================
:: Create Start Script
:: ============================================

echo.
echo %CYAN%[5/5]%NC% Creando scripts de inicio...

:: Create start.bat
(
    echo @echo off
    echo title REBEL Multi-Agent Orchestrator
    echo.
    echo echo Starting REBEL Multi-Agent Orchestrator...
    echo echo.
    echo.
    echo cd /d "%%~dp0backend"
    echo start "REBEL Backend" cmd /c "npm run dev"
    echo.
    echo timeout /t 5 /nobreak ^>nul
    echo.
    echo if exist "%%~dp0..\app" ^(
    echo     cd /d "%%~dp0..\app"
    echo     start "REBEL Frontend" cmd /c "npm run dev"
    echo ^)
    echo.
    echo echo.
    echo echo ============================================
    echo echo REBEL is running!
    echo echo.
    echo echo   API:       http://localhost:3001
    echo echo   Dashboard: http://localhost:5173
    echo echo.
    echo echo   Close this window to stop
    echo echo ============================================
    echo.
    echo pause
) > start.bat

echo %GREEN%[OK]%NC% start.bat creado

:: Create rebel.bat CLI helper
(
    echo @echo off
    echo setlocal
    echo.
    echo if "%%1"=="" goto help
    echo if "%%1"=="start" goto start
    echo if "%%1"=="status" goto status
    echo if "%%1"=="agents" goto agents
    echo if "%%1"=="help" goto help
    echo goto help
    echo.
    echo :start
    echo call "%%~dp0start.bat"
    echo goto end
    echo.
    echo :status
    echo curl -s http://localhost:3001/api/status
    echo goto end
    echo.
    echo :agents
    echo curl -s http://localhost:3001/api/agents/status
    echo goto end
    echo.
    echo :help
    echo echo.
    echo echo REBEL CLI Helper
    echo echo ================
    echo echo.
    echo echo Commands:
    echo echo   rebel start   - Start all services
    echo echo   rebel status  - Check system status
    echo echo   rebel agents  - Show agent pool status
    echo echo   rebel help    - Show this help
    echo echo.
    echo goto end
    echo.
    echo :end
    echo endlocal
) > rebel.bat

echo %GREEN%[OK]%NC% rebel.bat creado

:: ============================================
:: Done
:: ============================================

echo.
echo %GREEN%============================================%NC%
echo %GREEN%     INSTALACION COMPLETADA%NC%
echo %GREEN%============================================%NC%
echo.
echo   Para iniciar REBEL:
echo.
echo     %CYAN%start.bat%NC%
echo.
echo   O usa el CLI:
echo.
echo     %CYAN%rebel start%NC%
echo     %CYAN%rebel status%NC%
echo     %CYAN%rebel agents%NC%
echo.

pause
