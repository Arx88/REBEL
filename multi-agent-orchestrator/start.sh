#!/bin/bash

# ============================================
# REBEL Multi-Agent Orchestrator - Quick Start
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/../app"

# Colores
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Banner
echo ""
echo -e "${CYAN}"
echo "  ____  _____ ____  _____ _     "
echo " |  _ \| ____| __ )| ____| |    "
echo " | |_) |  _| |  _ \|  _| | |    "
echo " |  _ <| |___| |_) | |___| |___ "
echo " |_| \_\_____|____/|_____|_____|"
echo -e "${NC}"
echo -e "${CYAN}Starting Multi-Agent Orchestrator...${NC}"
echo ""

# Verificar Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[X] Node.js not installed${NC}"
    echo "    Install from: https://nodejs.org"
    exit 1
fi

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    [ ! -z "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null
    [ ! -z "$FRONTEND_PID" ] && kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# ============================================
# Backend
# ============================================

echo -e "${GREEN}[1/2]${NC} Starting Backend..."
cd "$BACKEND_DIR"

# Auto-install if needed
if [ ! -d "node_modules" ]; then
    echo "     Installing dependencies..."
    npm install --silent
fi

# Create .env if missing
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "     ${CYAN}Created .env from example${NC}"
fi

# Create data directory
mkdir -p data

# Start backend
npm run dev 2>&1 | sed 's/^/     /' &
BACKEND_PID=$!

# Wait for backend to be ready
echo -n "     Waiting for API"
for i in {1..30}; do
    if curl -s http://localhost:3001/api/status > /dev/null 2>&1; then
        echo -e " ${GREEN}Ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# ============================================
# Frontend
# ============================================

if [ -d "$FRONTEND_DIR" ]; then
    echo -e "${GREEN}[2/2]${NC} Starting Frontend..."
    cd "$FRONTEND_DIR"
    
    # Auto-install if needed
    if [ ! -d "node_modules" ]; then
        echo "     Installing dependencies..."
        npm install --silent
    fi
    
    npm run dev 2>&1 | sed 's/^/     /' &
    FRONTEND_PID=$!
    
    sleep 3
    
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${GREEN}REBEL is running!${NC}"
    echo ""
    echo -e "  API:       ${CYAN}http://localhost:3001${NC}"
    echo -e "  Dashboard: ${CYAN}http://localhost:5173${NC}"
    echo ""
    echo -e "  Commands:  ${CYAN}./rebel status${NC}  - Check status"
    echo -e "             ${CYAN}./rebel agents${NC}  - View agents"
    echo -e "             ${CYAN}./rebel test${NC}    - Test task"
    echo ""
    echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop"
    echo -e "${CYAN}============================================${NC}"
else
    echo -e "${YELLOW}[2/2]${NC} Frontend not found, skipping"
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${GREEN}REBEL Backend is running!${NC}"
    echo ""
    echo -e "  API: ${CYAN}http://localhost:3001${NC}"
    echo ""
    echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop"
    echo -e "${CYAN}============================================${NC}"
fi

# Keep running
wait
