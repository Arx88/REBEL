# REBEL Multi-Agent Orchestrator

Sistema multi-agente avanzado que utiliza Gemini CLI y Qwen CLI trabajando en paralelo para resolver tareas complejas con refinamiento iterativo y fallback automatico.

## Quick Start (30 segundos)

```bash
# Clonar e instalar
git clone https://github.com/user/rebel.git
cd rebel/multi-agent-orchestrator

# Opcion 1: Script de instalacion (recomendado)
./install.sh          # Linux/macOS
install.bat           # Windows

# Opcion 2: Node.js (cross-platform)
node setup.js

# Iniciar
./start.sh            # Linux/macOS
start.bat             # Windows

# O usa el CLI helper
./rebel start
```

Abre http://localhost:5173 para ver el Dashboard.

## Caracteristicas

- **20 Agentes Concurrentes**: 10 Gemini + 10 Qwen
- **Fallback Automatico**: Cambia a modelos Flash cuando hay rate limit
- **Refinamiento Iterativo**: Multiples agentes mejoran el plan
- **Human-in-the-Loop**: Aprobacion de planes antes de ejecutar
- **Ejecucion Paralela**: Multiples tareas simultaneas
- **Validacion Cruzada**: Agentes se verifican mutuamente
- **Memoria Compartida**: Contexto persistente entre agentes
- **WebSocket en Tiempo Real**: Monitoreo detallado de ejecucion
- **Visualizacion de Planes**: Grafos de dependencias, timeline, riesgos

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Dashboard  │  │  Task Input  │  │ Agent Grid   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket / HTTP
┌─────────────────────────────────────────────────────────────┐
│                      BACKEND (Node.js)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              API REST + WebSocket Server             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              TaskController (Orquestador)            │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │
│  │MasterPlanner │ │PlanValidator │ │   Orchestrator   │    │
│  └──────────────┘ └──────────────┘ └──────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              AgentPool (20 Agentes CLI)              │   │
│  │  ┌──────────────┐          ┌──────────────┐         │   │
│  │  │  10 x Gemini │          │  10 x Qwen   │         │   │
│  │  └──────────────┘          └──────────────┘         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              SQLite + Memory Manager                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Instalacion

### Requisitos

- **Node.js 18+** (requerido)
- **Gemini CLI** (recomendado) - [Instrucciones](https://github.com/google/generative-ai-cli)
- **Qwen CLI** (opcional) - Para agentes adicionales

### Instalacion Automatica (Recomendada)

```bash
# Linux/macOS
./install.sh

# Windows
install.bat

# Cross-platform (Node.js)
node setup.js
```

El instalador automaticamente:
1. Verifica Node.js y dependencias
2. Detecta CLI tools disponibles
3. Instala dependencias de backend y frontend
4. Crea configuracion inicial
5. Genera scripts de inicio

### Instalacion Manual

```bash
# Backend
cd backend
npm install
cp .env.example .env
npm run dev

# Frontend (en otra terminal)
cd ../app  
npm install
npm run dev
```

### CLI Helper

Despues de instalar, usa el CLI helper para operaciones comunes:

```bash
./rebel start     # Iniciar todo
./rebel backend   # Solo backend
./rebel status    # Ver estado del sistema
./rebel agents    # Ver pool de agentes
./rebel test      # Enviar tarea de prueba
./rebel help      # Ver todos los comandos
```

## Uso

### Crear una tarea

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "userInput": "Analizar el sistema de misiones del juego y crear nuevas misiones",
    "context": "Ruta del proyecto: /home/user/mygame"
  }'
```

### Ver estado de agentes

```bash
curl http://localhost:3001/api/agents/status
```

### Ver tarea

```bash
curl http://localhost:3001/api/tasks/1
```

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | /api/tasks | Crear nueva tarea |
| GET | /api/tasks | Listar tareas |
| GET | /api/tasks/:id | Ver tarea específica |
| GET | /api/tasks/:id/timeline | Timeline de eventos |
| GET | /api/tasks/:id/executions | Ejecuciones de agentes |
| POST | /api/tasks/:id/cancel | Cancelar tarea |
| GET | /api/agents/status | Estado del pool |
| GET | /api/agents/health | Health check |
| GET | /api/status | Estado del sistema |

## WebSocket Events

### Cliente → Servidor
- `subscribe_task`: Suscribirse a actualizaciones de tarea
- `unsubscribe_task`: Desuscribirse
- `ping`: Health check

### Servidor → Cliente
- `agent_update`: Actualización de estado de agente
- `timeline_update`: Nuevo evento en timeline
- `task_status_change`: Cambio de estado de tarea
- `task_complete`: Tarea completada
- `plan_generated`: Plan generado
- `agent_pool_status`: Estado del pool de agentes

## Flujo de Ejecución

1. **Planning**: MasterPlanner genera plan exhaustivo
2. **Validation**: PlanValidator verifica calidad del plan
3. **Orchestration**: Orchestrator ejecuta fases en paralelo
4. **Synthesis**: Synthesizer consolida resultados

## Configuración

Variables de entorno en `.env`:

```
PORT=3001
GEMINI_CLI_PATH=gemini
QWEN_CLI_PATH=qwen
MAX_GEMINI_AGENTS=10
MAX_QWEN_AGENTS=10
DB_PATH=./data/orchestrator.db
```

## Troubleshooting

### Error: "Gemini CLI not found"

```bash
# Instalar Gemini CLI
npm install -g @google/generative-ai-cli

# Verificar instalacion
gemini --version
```

### Error: "Rate limit exceeded"

El sistema automaticamente cambia a modelos Flash cuando hay rate limit. Si persiste:

1. Espera 1-2 minutos (cooldown automatico)
2. Reduce `MAX_GEMINI_AGENTS` en `.env`
3. Verifica tu cuota de API

### Error: "Cannot connect to backend"

```bash
# Verificar que el backend esta corriendo
curl http://localhost:3001/api/status

# Verificar logs
./rebel logs
```

### El frontend no carga

```bash
# Verificar que ambos servicios estan corriendo
./rebel status

# Reiniciar todo
pkill -f "npm run dev"
./rebel start
```

## Estructura del Proyecto

```
multi-agent-orchestrator/
├── install.sh          # Instalador Linux/macOS
├── install.bat         # Instalador Windows
├── setup.js            # Instalador Node.js (cross-platform)
├── start.sh            # Inicio rapido Linux/macOS
├── start.bat           # Inicio rapido Windows
├── rebel               # CLI helper
├── backend/
│   ├── src/
│   │   ├── agents/     # Agentes especializados
│   │   ├── core/       # Motor de ejecucion
│   │   ├── controllers/
│   │   └── websocket/
│   ├── .env.example    # Configuracion de ejemplo
│   └── package.json
└── README.md
```

## Licencia

MIT
