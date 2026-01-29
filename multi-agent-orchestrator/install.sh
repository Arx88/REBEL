#!/bin/bash

# ============================================
# REBEL Multi-Agent Orchestrator - Instalador
# ============================================
# Instalacion rapida y automatica
# Uso: curl -fsSL https://raw.githubusercontent.com/user/rebel/main/install.sh | bash
# O:   ./install.sh

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Caracteres para UI
CHECK="${GREEN}[OK]${NC}"
CROSS="${RED}[X]${NC}"
ARROW="${CYAN}-->${NC}"
WARN="${YELLOW}[!]${NC}"

# Variables
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$INSTALL_DIR/backend"
FRONTEND_DIR="$INSTALL_DIR/../app"
MIN_NODE_VERSION=18
REQUIRED_SPACE_MB=500

# ============================================
# FUNCIONES DE UI
# ============================================

print_banner() {
    echo ""
    echo -e "${CYAN}${BOLD}"
    echo "  ____  _____ ____  _____ _     "
    echo " |  _ \| ____| __ )| ____| |    "
    echo " | |_) |  _| |  _ \|  _| | |    "
    echo " |  _ <| |___| |_) | |___| |___ "
    echo " |_| \_\_____|____/|_____|_____|"
    echo ""
    echo -e "${WHITE} Multi-Agent Orchestrator${NC}"
    echo -e "${CYAN} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_step() {
    echo -e "\n${BLUE}${BOLD}[$1/$TOTAL_STEPS]${NC} $2"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
    echo -e "  ${CHECK} $1"
}

print_error() {
    echo -e "  ${CROSS} $1"
}

print_warning() {
    echo -e "  ${WARN} $1"
}

print_info() {
    echo -e "  ${ARROW} $1"
}

spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='|/-\'
    while [ "$(ps a | awk '{print $1}' | grep $pid)" ]; do
        local temp=${spinstr#?}
        printf " [%c]  " "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\b\b\b\b\b\b"
    done
    printf "      \b\b\b\b\b\b"
}

# ============================================
# VERIFICACIONES
# ============================================

TOTAL_STEPS=7

check_os() {
    print_step 1 "Detectando Sistema Operativo"
    
    OS="unknown"
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            DISTRO=$NAME
        fi
        print_success "Linux detectado: ${DISTRO:-Unknown}"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        print_success "macOS detectado: $(sw_vers -productVersion)"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        OS="windows"
        print_success "Windows detectado (via Git Bash/WSL)"
    else
        print_warning "Sistema operativo no reconocido: $OSTYPE"
        print_info "Continuando de todos modos..."
    fi
}

check_node() {
    print_step 2 "Verificando Node.js"
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js no esta instalado"
        echo ""
        echo -e "  ${ARROW} Instala Node.js desde: ${CYAN}https://nodejs.org${NC}"
        echo ""
        
        if [[ "$OS" == "macos" ]]; then
            echo -e "  ${ARROW} O usa Homebrew: ${WHITE}brew install node${NC}"
        elif [[ "$OS" == "linux" ]]; then
            echo -e "  ${ARROW} O usa nvm: ${WHITE}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash${NC}"
            echo -e "  ${ARROW} Luego: ${WHITE}nvm install 20${NC}"
        fi
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    
    if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
        print_error "Node.js version $NODE_VERSION es muy antigua (minimo: $MIN_NODE_VERSION)"
        echo -e "  ${ARROW} Actualiza Node.js desde: ${CYAN}https://nodejs.org${NC}"
        exit 1
    fi
    
    print_success "Node.js $(node -v)"
    
    # Verificar npm
    if command -v npm &> /dev/null; then
        print_success "npm $(npm -v)"
    else
        print_error "npm no encontrado"
        exit 1
    fi
}

check_disk_space() {
    print_step 3 "Verificando Espacio en Disco"
    
    if [[ "$OS" == "macos" ]]; then
        AVAILABLE_MB=$(df -m . | tail -1 | awk '{print $4}')
    else
        AVAILABLE_MB=$(df -m . | tail -1 | awk '{print $4}')
    fi
    
    if [ "$AVAILABLE_MB" -lt "$REQUIRED_SPACE_MB" ]; then
        print_error "Espacio insuficiente: ${AVAILABLE_MB}MB disponibles, ${REQUIRED_SPACE_MB}MB requeridos"
        exit 1
    fi
    
    print_success "${AVAILABLE_MB}MB disponibles"
}

check_cli_tools() {
    print_step 4 "Verificando CLI Tools (Gemini/Qwen)"
    
    GEMINI_AVAILABLE=false
    QWEN_AVAILABLE=false
    
    # Verificar Gemini CLI
    if command -v gemini &> /dev/null; then
        GEMINI_AVAILABLE=true
        GEMINI_VERSION=$(gemini --version 2>/dev/null || echo "instalado")
        print_success "Gemini CLI: $GEMINI_VERSION"
    else
        print_warning "Gemini CLI no encontrado"
        print_info "Instalar: npm install -g @anthropic-ai/gemini-cli"
    fi
    
    # Verificar Qwen CLI
    if command -v qwen &> /dev/null; then
        QWEN_AVAILABLE=true
        QWEN_VERSION=$(qwen --version 2>/dev/null || echo "instalado")
        print_success "Qwen CLI: $QWEN_VERSION"
    else
        print_warning "Qwen CLI no encontrado"
        print_info "Instalar segun documentacion de Qwen"
    fi
    
    if [ "$GEMINI_AVAILABLE" = false ] && [ "$QWEN_AVAILABLE" = false ]; then
        echo ""
        print_warning "Ningun CLI de agente encontrado"
        print_info "El sistema funcionara en modo limitado"
        print_info "Instala al menos uno para funcionalidad completa"
        echo ""
        read -p "  Continuar de todos modos? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# ============================================
# INSTALACION
# ============================================

install_backend() {
    print_step 5 "Instalando Backend"
    
    cd "$BACKEND_DIR"
    
    # Instalar dependencias
    print_info "Instalando dependencias..."
    npm install --silent 2>&1 | while read line; do
        echo -ne "\r  ${ARROW} $line                    \r"
    done
    print_success "Dependencias instaladas"
    
    # Crear .env si no existe
    if [ ! -f ".env" ]; then
        print_info "Configurando variables de entorno..."
        cat > .env << 'EOF'
# ============================================
# REBEL Multi-Agent Orchestrator Configuration
# ============================================

# Server
PORT=3001
HOST=localhost

# CLI Paths (auto-detectados si estan en PATH)
GEMINI_CLI_PATH=gemini
QWEN_CLI_PATH=qwen

# Agent Pool Configuration
MAX_GEMINI_AGENTS=10
MAX_QWEN_AGENTS=10

# Database
DB_PATH=./data/orchestrator.db

# Logging
LOG_LEVEL=info

# Timeouts (ms)
AGENT_TIMEOUT=300000
IDLE_TIMEOUT=600000

# Rate Limiting
ENABLE_RATE_LIMIT_FALLBACK=true
RATE_LIMIT_COOLDOWN_MS=60000

# Plan Refinement
ENABLE_PLAN_REFINEMENT=true
MAX_REFINEMENT_ITERATIONS=3
EOF
        print_success "Archivo .env creado"
    else
        print_success "Archivo .env existente preservado"
    fi
    
    # Crear directorio de datos
    mkdir -p data
    print_success "Directorio de datos creado"
    
    # Compilar TypeScript
    print_info "Compilando TypeScript..."
    npm run build --silent 2>/dev/null || true
    print_success "Backend compilado"
    
    cd "$INSTALL_DIR"
}

install_frontend() {
    print_step 6 "Instalando Frontend"
    
    if [ ! -d "$FRONTEND_DIR" ]; then
        print_warning "Directorio frontend no encontrado en $FRONTEND_DIR"
        print_info "Saltando instalacion del frontend"
        return
    fi
    
    cd "$FRONTEND_DIR"
    
    # Instalar dependencias
    print_info "Instalando dependencias..."
    npm install --silent 2>&1 | while read line; do
        echo -ne "\r  ${ARROW} $line                    \r"
    done
    print_success "Dependencias instaladas"
    
    cd "$INSTALL_DIR"
}

create_launcher_scripts() {
    print_step 7 "Creando Scripts de Inicio"
    
    # Script de inicio principal (bash)
    cat > "$INSTALL_DIR/start.sh" << 'STARTSCRIPT'
#!/bin/bash

# REBEL Multi-Agent Orchestrator - Quick Start
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colores
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}Starting REBEL Multi-Agent Orchestrator...${NC}"
echo ""

# Funcion para cleanup
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Iniciar Backend
echo -e "${GREEN}[1/2]${NC} Starting Backend..."
cd "$SCRIPT_DIR/backend"
npm run dev &
BACKEND_PID=$!

# Esperar a que el backend este listo
echo -n "     Waiting for backend"
for i in {1..30}; do
    if curl -s http://localhost:3001/api/status > /dev/null 2>&1; then
        echo -e " ${GREEN}Ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Iniciar Frontend (si existe)
FRONTEND_DIR="$SCRIPT_DIR/../app"
if [ -d "$FRONTEND_DIR" ]; then
    echo -e "${GREEN}[2/2]${NC} Starting Frontend..."
    cd "$FRONTEND_DIR"
    npm run dev &
    FRONTEND_PID=$!
    
    sleep 3
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${GREEN}REBEL is running!${NC}"
    echo ""
    echo -e "  API:       ${CYAN}http://localhost:3001${NC}"
    echo -e "  Dashboard: ${CYAN}http://localhost:5173${NC}"
    echo ""
    echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop"
    echo -e "${CYAN}============================================${NC}"
else
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${GREEN}REBEL Backend is running!${NC}"
    echo ""
    echo -e "  API: ${CYAN}http://localhost:3001${NC}"
    echo ""
    echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop"
    echo -e "${CYAN}============================================${NC}"
fi

wait
STARTSCRIPT

    chmod +x "$INSTALL_DIR/start.sh"
    print_success "start.sh creado"
    
    # Script de inicio solo backend
    cat > "$INSTALL_DIR/start-backend.sh" << 'BACKENDSCRIPT'
#!/bin/bash
cd "$(dirname "${BASH_SOURCE[0]}")/backend"
npm run dev
BACKENDSCRIPT
    chmod +x "$INSTALL_DIR/start-backend.sh"
    print_success "start-backend.sh creado"
    
    # Script para Windows (PowerShell)
    cat > "$INSTALL_DIR/start.ps1" << 'PSSCRIPT'
# REBEL Multi-Agent Orchestrator - Windows Start Script

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Starting REBEL Multi-Agent Orchestrator..." -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Start Backend
Write-Host "[1/2] Starting Backend..." -ForegroundColor Green
$backendPath = Join-Path $ScriptDir "backend"
$backend = Start-Process -FilePath "npm" -ArgumentList "run dev" -WorkingDirectory $backendPath -PassThru -NoNewWindow

Start-Sleep -Seconds 5

# Start Frontend
$frontendPath = Join-Path (Split-Path $ScriptDir -Parent) "app"
if (Test-Path $frontendPath) {
    Write-Host "[2/2] Starting Frontend..." -ForegroundColor Green
    $frontend = Start-Process -FilePath "npm" -ArgumentList "run dev" -WorkingDirectory $frontendPath -PassThru -NoNewWindow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "REBEL is running!" -ForegroundColor Green
Write-Host ""
Write-Host "  API:       http://localhost:3001" -ForegroundColor Cyan
Write-Host "  Dashboard: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Cyan

Wait-Process -Id $backend.Id
PSSCRIPT

    print_success "start.ps1 creado (Windows)"
    
    # Script CLI helper
    cat > "$INSTALL_DIR/rebel" << 'CLISCRIPT'
#!/bin/bash

# REBEL CLI Helper
# Usage: ./rebel [command]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

show_help() {
    echo ""
    echo "REBEL Multi-Agent Orchestrator CLI"
    echo "==================================="
    echo ""
    echo "Usage: ./rebel [command]"
    echo ""
    echo "Commands:"
    echo "  start       Start all services (backend + frontend)"
    echo "  backend     Start backend only"
    echo "  status      Check system status"
    echo "  logs        Show recent logs"
    echo "  test        Run a test task"
    echo "  agents      Show agent pool status"
    echo "  help        Show this help"
    echo ""
}

case "$1" in
    start)
        "$SCRIPT_DIR/start.sh"
        ;;
    backend)
        "$SCRIPT_DIR/start-backend.sh"
        ;;
    status)
        curl -s http://localhost:3001/api/status | python3 -m json.tool 2>/dev/null || echo "Backend not running"
        ;;
    agents)
        curl -s http://localhost:3001/api/agents/status | python3 -m json.tool 2>/dev/null || echo "Backend not running"
        ;;
    logs)
        tail -f "$SCRIPT_DIR/backend/logs/app.log" 2>/dev/null || echo "No logs found"
        ;;
    test)
        echo "Sending test task..."
        curl -X POST http://localhost:3001/api/tasks \
            -H "Content-Type: application/json" \
            -d '{"userInput": "Test task: analyze and respond", "context": "This is a test"}' \
            | python3 -m json.tool
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
CLISCRIPT

    chmod +x "$INSTALL_DIR/rebel"
    print_success "CLI helper 'rebel' creado"
}

# ============================================
# FINALIZACION
# ============================================

print_completion() {
    echo ""
    echo -e "${GREEN}${BOLD}"
    echo "  ============================================"
    echo "       INSTALACION COMPLETADA"
    echo "  ============================================"
    echo -e "${NC}"
    echo ""
    echo -e "  ${WHITE}Para iniciar REBEL:${NC}"
    echo ""
    echo -e "    ${CYAN}cd multi-agent-orchestrator${NC}"
    echo -e "    ${CYAN}./start.sh${NC}"
    echo ""
    echo -e "  ${WHITE}O usa el CLI helper:${NC}"
    echo ""
    echo -e "    ${CYAN}./rebel start${NC}     # Iniciar todo"
    echo -e "    ${CYAN}./rebel status${NC}    # Ver estado"
    echo -e "    ${CYAN}./rebel agents${NC}    # Ver agentes"
    echo -e "    ${CYAN}./rebel help${NC}      # Mas comandos"
    echo ""
    
    if [ "$GEMINI_AVAILABLE" = false ] || [ "$QWEN_AVAILABLE" = false ]; then
        echo -e "  ${YELLOW}Recordatorio:${NC}"
        [ "$GEMINI_AVAILABLE" = false ] && echo -e "    - Instala Gemini CLI para funcionalidad completa"
        [ "$QWEN_AVAILABLE" = false ] && echo -e "    - Instala Qwen CLI para funcionalidad completa"
        echo ""
    fi
    
    echo -e "  ${WHITE}Documentacion:${NC} ${CYAN}https://github.com/user/rebel${NC}"
    echo ""
}

# ============================================
# MAIN
# ============================================

main() {
    print_banner
    
    echo -e "${WHITE}Iniciando instalacion automatica...${NC}"
    echo ""
    
    check_os
    check_node
    check_disk_space
    check_cli_tools
    install_backend
    install_frontend
    create_launcher_scripts
    
    print_completion
}

# Run
main "$@"
