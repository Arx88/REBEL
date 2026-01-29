#!/bin/bash

# ============================================
# REBEL Health Check Script
# ============================================
# Verifica que todos los componentes estan funcionando

set -e

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

CHECK="${GREEN}[PASS]${NC}"
FAIL="${RED}[FAIL]${NC}"
WARN="${YELLOW}[WARN]${NC}"

echo ""
echo -e "${CYAN}REBEL Health Check${NC}"
echo -e "${CYAN}==================${NC}"
echo ""

ISSUES=0

# Check Node.js
echo -n "Node.js.............. "
if command -v node &> /dev/null; then
    VERSION=$(node -v)
    MAJOR=$(echo $VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR" -ge 18 ]; then
        echo -e "${CHECK} ${VERSION}"
    else
        echo -e "${WARN} ${VERSION} (v18+ recomendado)"
    fi
else
    echo -e "${FAIL} No instalado"
    ((ISSUES++))
fi

# Check npm
echo -n "npm.................. "
if command -v npm &> /dev/null; then
    echo -e "${CHECK} $(npm -v)"
else
    echo -e "${FAIL} No instalado"
    ((ISSUES++))
fi

# Check Gemini CLI
echo -n "Gemini CLI........... "
if command -v gemini &> /dev/null; then
    echo -e "${CHECK} Disponible"
else
    echo -e "${WARN} No encontrado"
fi

# Check Qwen CLI
echo -n "Qwen CLI............. "
if command -v qwen &> /dev/null; then
    echo -e "${CHECK} Disponible"
else
    echo -e "${WARN} No encontrado"
fi

# Check Backend
echo -n "Backend API.......... "
if curl -s http://localhost:3001/api/status > /dev/null 2>&1; then
    STATUS=$(curl -s http://localhost:3001/api/status | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    echo -e "${CHECK} Running (${STATUS})"
else
    echo -e "${FAIL} Not running"
    ((ISSUES++))
fi

# Check WebSocket
echo -n "WebSocket............ "
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/status | grep -q "200"; then
    echo -e "${CHECK} Available"
else
    echo -e "${WARN} Unknown"
fi

# Check Frontend
echo -n "Frontend............. "
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo -e "${CHECK} Running"
else
    echo -e "${WARN} Not running"
fi

# Check Agent Pool
echo -n "Agent Pool........... "
POOL_STATUS=$(curl -s http://localhost:3001/api/agents/status 2>/dev/null)
if [ ! -z "$POOL_STATUS" ]; then
    GEMINI_COUNT=$(echo $POOL_STATUS | grep -o '"gemini":[0-9]*' | cut -d':' -f2)
    QWEN_COUNT=$(echo $POOL_STATUS | grep -o '"qwen":[0-9]*' | cut -d':' -f2)
    echo -e "${CHECK} Gemini: ${GEMINI_COUNT:-0}, Qwen: ${QWEN_COUNT:-0}"
else
    echo -e "${WARN} Cannot check"
fi

# Check Database
echo -n "Database............. "
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_PATH="$SCRIPT_DIR/backend/data/orchestrator.db"
if [ -f "$DB_PATH" ]; then
    SIZE=$(du -h "$DB_PATH" | cut -f1)
    echo -e "${CHECK} ${SIZE}"
else
    echo -e "${WARN} Not initialized"
fi

# Check .env
echo -n "Configuration........ "
if [ -f "$SCRIPT_DIR/backend/.env" ]; then
    echo -e "${CHECK} .env exists"
else
    echo -e "${WARN} .env missing (using defaults)"
fi

# Summary
echo ""
echo -e "${CYAN}==================${NC}"
if [ $ISSUES -eq 0 ]; then
    echo -e "${GREEN}All critical checks passed!${NC}"
else
    echo -e "${RED}${ISSUES} critical issue(s) found${NC}"
fi
echo ""

exit $ISSUES
