import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database | null = null;

export function initializeDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const finalPath = dbPath || path.join(process.cwd(), 'data', 'orchestrator.db');

  const fs = require('fs');
  const dir = path.dirname(finalPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(finalPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  return db;
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_input TEXT NOT NULL,
      context TEXT,
      status TEXT DEFAULT 'planning',
      current_phase TEXT,
      plan_json TEXT,
      final_result TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      version INTEGER DEFAULT 1,
      plan_json TEXT NOT NULL,
      validation_status TEXT DEFAULT 'pending',
      validator_feedback TEXT,
      confidence_score INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      agent_type TEXT NOT NULL,
      agent_model TEXT NOT NULL,
      agent_index INTEGER,
      phase TEXT NOT NULL,
      subtask_description TEXT,
      prompt_sent TEXT NOT NULL,
      response_received TEXT,
      status TEXT DEFAULT 'queued',
      started_at DATETIME,
      completed_at DATETIME,
      execution_time_ms INTEGER,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS timeline_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_executions_task ON agent_executions(task_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_task ON timeline_events(task_id);
  `);
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('DB no inicializada');
  return db;
}

export function closeDatabase(): void {
  if (db) { db.close(); db = null; }
}

export function createTask(db: Database.Database, userInput: string, context?: string): number {
  const stmt = db.prepare('INSERT INTO tasks (user_input, context, status) VALUES (?, ?, ?)');
  return Number(stmt.run(userInput, context || null, 'planning').lastInsertRowid);
}

export function updateTaskStatus(db: Database.Database, taskId: number, status: string, additionalData?: Record<string, any>): void {
  const updates = ['status = ?'];
  const values: any[] = [status];

  if (additionalData) {
    for (const [key, value] of Object.entries(additionalData)) {
      updates.push(`${key} = ?`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }
  }

  if (status === 'completed' || status === 'failed') {
    updates.push('completed_at = CURRENT_TIMESTAMP');
  }

  values.push(taskId);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

export function getTask(db: Database.Database, taskId: number): any {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

export function getTasks(db: Database.Database, options: { status?: string; limit?: number; offset?: number } = {}): any[] {
  let query = 'SELECT * FROM tasks ORDER BY created_at DESC';
  const params: any[] = [];

  if (options.status) {
    query = 'SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC';
    params.push(options.status);
  }

  if (options.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options.offset) {
    query += ' OFFSET ?';
    params.push(options.offset);
  }

  return db.prepare(query).all(...params);
}

export function addTimelineEvent(db: Database.Database, taskId: number, eventType: string, message: string, details?: any): void {
  db.prepare('INSERT INTO timeline_events (task_id, event_type, message, details) VALUES (?, ?, ?, ?)')
    .run(taskId, eventType, message, details ? JSON.stringify(details) : null);
}

export function getTimelineEvents(db: Database.Database, taskId: number, limit: number = 100): any[] {
  return db.prepare('SELECT * FROM timeline_events WHERE task_id = ? ORDER BY created_at ASC LIMIT ?').all(taskId, limit);
}

export function getTaskExecutions(db: Database.Database, taskId: number): any[] {
  return db.prepare('SELECT * FROM agent_executions WHERE task_id = ? ORDER BY created_at ASC').all(taskId);
}

export function getTaskStats(db: Database.Database, taskId: number): any {
  return db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(execution_time_ms) as avg_time
    FROM agent_executions WHERE task_id = ?
  `).get(taskId);
}