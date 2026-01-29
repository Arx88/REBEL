import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import dotenv from 'dotenv';
import path from 'path';

import { initializeDatabase, getDatabase, closeDatabase } from './database/db';
import { AgentPool } from './core/AgentPool';
import { MemoryManager } from './core/MemoryManager';
import { socketManager } from './websocket/socketManager';
import { createTaskRouter } from './routes/tasks';
import { createAgentsRouter } from './routes/agents';

dotenv.config();

const PORT = process.env.PORT || 3001;
const GEMINI_CLI_PATH = process.env.GEMINI_CLI_PATH || 'gemini';
const QWEN_CLI_PATH = process.env.QWEN_CLI_PATH || 'qwen';
const MAX_GEMINI_AGENTS = parseInt(process.env.MAX_GEMINI_AGENTS || '10');
const MAX_QWEN_AGENTS = parseInt(process.env.MAX_QWEN_AGENTS || '10');

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  try {
    const db = getDatabase();
    const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
    const activeTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status NOT IN ('completed', 'failed', 'cancelled')").get() as { count: number };

    res.json({ success: true, system: { status: 'running', uptime: process.uptime() }, tasks: { total: taskCount.count, active: activeTasks.count } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

async function initialize(): Promise<void> {
  console.log('🚀 Inicializando Multi-Agent Orchestrator...\n');

  try {
    console.log('📁 Inicializando base de datos...');
    const db = initializeDatabase();
    console.log('✅ Base de datos lista\n');

    console.log('🧠 Inicializando Memory Manager...');
    const memoryManager = new MemoryManager(db);
    console.log('✅ Memory Manager listo\n');

    console.log('🤖 Inicializando Agent Pool...');
    const agentPool = new AgentPool({
      geminiCLIPath: GEMINI_CLI_PATH,
      qwenCLIPath: QWEN_CLI_PATH,
      maxGeminiAgents: MAX_GEMINI_AGENTS,
      maxQwenAgents: MAX_QWEN_AGENTS
    });

    agentPool.on('agent_ready', ({ agentId }) => console.log(`  ✓ ${agentId} listo`));
    agentPool.on('initialized', ({ readyCount, total }) => console.log(`\n✅ Agent Pool: ${readyCount}/${total} agentes\n`));

    await agentPool.initialize();

    console.log('🔌 Inicializando WebSocket...');
    socketManager.initialize(server);
    console.log('✅ WebSocket listo\n');

    console.log('🌐 Configurando rutas...');
    app.use('/api/tasks', createTaskRouter(db, agentPool, memoryManager));
    app.use('/api/agents', createAgentsRouter(agentPool));
    console.log('✅ Rutas configuradas\n');

    socketManager.on('request_task_state', ({ taskId, clientId }) => {
      try {
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (task) socketManager.sendToClient(clientId, { type: 'task_state', payload: task });
      } catch (e) {}
    });

    server.listen(PORT, () => {
      console.log('='.repeat(50));
      console.log('✅ Multi-Agent Orchestrator iniciado');
      console.log('='.repeat(50));
      console.log(`📡 API: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
      console.log('='.repeat(50));
    });

    setInterval(() => {
      socketManager.broadcastAgentPoolStatus({
        total: agentPool.getStats().total,
        ready: agentPool.getStats().ready,
        busy: agentPool.getStats().busy,
        agents: agentPool.getAgentStatuses()
      });
    }, 5000);

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Cerrando...');
      socketManager.close();
      await agentPool.destroy();
      closeDatabase();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('\n🛑 Cerrando...');
      socketManager.close();
      await agentPool.destroy();
      closeDatabase();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

initialize();