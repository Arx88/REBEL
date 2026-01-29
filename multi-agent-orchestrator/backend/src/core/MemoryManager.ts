import { Database } from 'better-sqlite3';

export interface MemoryEntry {
  key: string;
  value: any;
  priority: 'critical' | 'high' | 'medium' | 'low';
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  accessCount: number;
  lastAccessed: string;
  size: number;
  summary?: string;
  embedding?: number[];
}

export interface SemanticSearchResult {
  key: string;
  value: any;
  score: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  summary?: string;
}

export interface CMNOptions {
  query: string;
  maxTokens: number;
  includeStructure?: boolean;
  priorityBoost?: boolean;
}

export interface MemoryQueryOptions {
  includeKeys?: string[];
  excludeKeys?: string[];
  maxLength?: number;
  format?: 'json' | 'markdown' | 'text' | 'compressed';
  priorityThreshold?: 'critical' | 'high' | 'medium' | 'low';
  maxResults?: number;
  sortBy?: 'priority' | 'recency' | 'accessCount' | 'size';
}

interface CacheEntry {
  value: any;
  priority: MemoryEntry['priority'];
  accessCount: number;
  lastAccessed: number;
  size: number;
  summary?: string;
}

const PRIORITY_WEIGHTS: Record<MemoryEntry['priority'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

export class MemoryManager {
  private db: Database;
  private cache: Map<number, Map<string, CacheEntry>> = new Map();
  private readonly MAX_CACHE_SIZE = 100; // Max entries per task
  private readonly DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(db: Database) {
    this.db = db;
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shared_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        memory_key TEXT NOT NULL,
        memory_value TEXT NOT NULL,
        priority TEXT DEFAULT 'medium',
        summary TEXT,
        size_bytes INTEGER DEFAULT 0,
        access_count INTEGER DEFAULT 0,
        created_by_agent INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        embedding TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        UNIQUE(task_id, memory_key)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_task_priority 
        ON shared_memory(task_id, priority);
      CREATE INDEX IF NOT EXISTS idx_memory_expires 
        ON shared_memory(expires_at);
      CREATE INDEX IF NOT EXISTS idx_memory_embedding
        ON shared_memory(task_id, embedding);
    `);
  }

  /**
   * Store a value in memory with priority and optional TTL
   */
  set(
    taskId: number, 
    key: string, 
    value: any, 
    options: {
      createdByAgent?: number;
      priority?: MemoryEntry['priority'];
      ttlMs?: number;
      summary?: string;
      generateEmbedding?: boolean;
    } = {}
  ): void {
    const { 
      createdByAgent, 
      priority = 'medium', 
      ttlMs,
      summary,
      generateEmbedding = true
    } = options;

    const valueJson = JSON.stringify(value);
    const sizeBytes = Buffer.byteLength(valueJson, 'utf8');
    const expiresAt = ttlMs 
      ? new Date(Date.now() + ttlMs).toISOString() 
      : null;

    // Generate summary for large values
    const autoSummary = summary || this.generateSummary(key, value);
    
    // Generate embedding for semantic search (lightweight TF-IDF style)
    const embeddingText = `${key} ${autoSummary} ${typeof value === 'string' ? value.substring(0, 500) : ''}`;
    const embedding = generateEmbedding ? this.generateSimpleEmbedding(embeddingText) : null;
    const embeddingJson = embedding ? JSON.stringify(embedding) : null;

    const stmt = this.db.prepare(`
      INSERT INTO shared_memory (
        task_id, memory_key, memory_value, priority, summary, 
        size_bytes, created_by_agent, expires_at, embedding
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, memory_key) DO UPDATE SET
        memory_value = excluded.memory_value,
        priority = excluded.priority,
        summary = excluded.summary,
        size_bytes = excluded.size_bytes,
        created_by_agent = excluded.created_by_agent,
        embedding = excluded.embedding,
        updated_at = CURRENT_TIMESTAMP,
        access_count = access_count + 1
    `);

    stmt.run(
      taskId, 
      key, 
      valueJson, 
      priority, 
      autoSummary,
      sizeBytes, 
      createdByAgent || null,
      expiresAt,
      embeddingJson
    );

    // Update cache
    this.updateCache(taskId, key, {
      value,
      priority,
      accessCount: 1,
      lastAccessed: Date.now(),
      size: sizeBytes,
      summary: autoSummary
    });
  }
  
  /**
   * Generate a simple TF-IDF style embedding for semantic search
   * This is a lightweight alternative to heavy ML models
   */
  private generateSimpleEmbedding(text: string): number[] {
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);
    
    // Use a fixed vocabulary of common programming/development terms
    const vocabulary = [
      'function', 'class', 'method', 'variable', 'const', 'let', 'return',
      'import', 'export', 'async', 'await', 'promise', 'error', 'try', 'catch',
      'api', 'endpoint', 'route', 'request', 'response', 'data', 'json',
      'database', 'query', 'table', 'schema', 'model', 'type', 'interface',
      'component', 'props', 'state', 'hook', 'effect', 'render', 'dom',
      'test', 'spec', 'mock', 'assert', 'expect', 'describe', 'it',
      'config', 'env', 'secret', 'key', 'token', 'auth', 'user', 'session',
      'file', 'path', 'read', 'write', 'create', 'update', 'delete',
      'server', 'client', 'middleware', 'handler', 'controller', 'service',
      'plan', 'task', 'phase', 'subtask', 'result', 'output', 'input',
      'implement', 'analyze', 'validate', 'verify', 'check', 'fix', 'refactor',
      'structure', 'architecture', 'pattern', 'design', 'system', 'module'
    ];
    
    // Create embedding as word frequency vector
    const embedding = vocabulary.map(vocabWord => {
      const count = words.filter(w => w.includes(vocabWord) || vocabWord.includes(w)).length;
      return count / Math.max(words.length, 1);
    });
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? embedding.map(val => val / magnitude) : embedding;
  }
  
  /**
   * Calculate cosine similarity between two embeddings
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }
    
    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }
  
  /**
   * Semantic search using embeddings - Core of RAG/CMN
   */
  async semanticSearch(
    taskId: number, 
    query: string, 
    maxResults: number = 5,
    minScore: number = 0.1
  ): Promise<SemanticSearchResult[]> {
    const queryEmbedding = this.generateSimpleEmbedding(query);
    
    const rows = this.db.prepare(`
      SELECT memory_key, memory_value, priority, summary, embedding
      FROM shared_memory
      WHERE task_id = ?
      AND embedding IS NOT NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).all(taskId) as Array<{
      memory_key: string;
      memory_value: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
      summary: string;
      embedding: string;
    }>;
    
    const results: SemanticSearchResult[] = [];
    
    for (const row of rows) {
      try {
        const embedding = JSON.parse(row.embedding) as number[];
        const score = this.cosineSimilarity(queryEmbedding, embedding);
        
        // Boost score based on priority
        const priorityBoost = PRIORITY_WEIGHTS[row.priority] * 0.1;
        const finalScore = score + priorityBoost;
        
        if (finalScore >= minScore) {
          results.push({
            key: row.memory_key,
            value: JSON.parse(row.memory_value),
            score: finalScore,
            priority: row.priority,
            summary: row.summary
          });
        }
      } catch {
        // Skip entries with invalid embeddings
      }
    }
    
    // Sort by score descending and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }
  
  /**
   * Build Contexto Minimo Necesario (CMN) for a specific query
   * This is the core function for reducing context to only what's relevant
   */
  async buildCMN(taskId: number, options: CMNOptions): Promise<string> {
    const { query, maxTokens, includeStructure = false, priorityBoost = true } = options;
    
    // Get semantically relevant entries
    const semanticResults = await this.semanticSearch(taskId, query, 10, 0.05);
    
    // Estimate tokens (rough approximation: 1 token ~= 4 chars)
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    
    let context = '';
    let usedTokens = 0;
    
    // Add structure skeleton first if requested
    if (includeStructure) {
      const structureKey = this.db.prepare(`
        SELECT memory_key, summary 
        FROM shared_memory 
        WHERE task_id = ? AND memory_key LIKE '%structure%'
        LIMIT 1
      `).get(taskId) as { memory_key: string; summary: string } | undefined;
      
      if (structureKey) {
        const structureHeader = `## Project Structure\n${structureKey.summary}\n\n`;
        const structureTokens = estimateTokens(structureHeader);
        if (usedTokens + structureTokens <= maxTokens * 0.2) {
          context += structureHeader;
          usedTokens += structureTokens;
        }
      }
    }
    
    // Add semantically relevant entries
    for (const result of semanticResults) {
      const valueStr = typeof result.value === 'string' 
        ? result.value 
        : JSON.stringify(result.value, null, 2);
      
      // Truncate large values intelligently
      const maxValueLength = Math.min(2000, (maxTokens - usedTokens) * 4);
      const truncatedValue = valueStr.length > maxValueLength 
        ? valueStr.substring(0, maxValueLength) + '\n... [truncated]'
        : valueStr;
      
      const entry = `## ${result.key} (relevance: ${(result.score * 100).toFixed(0)}%)\n${truncatedValue}\n\n`;
      const entryTokens = estimateTokens(entry);
      
      if (usedTokens + entryTokens <= maxTokens) {
        context += entry;
        usedTokens += entryTokens;
      } else {
        // Try to add just the summary
        if (result.summary) {
          const summaryEntry = `## ${result.key} (summary)\n${result.summary}\n\n`;
          const summaryTokens = estimateTokens(summaryEntry);
          if (usedTokens + summaryTokens <= maxTokens) {
            context += summaryEntry;
            usedTokens += summaryTokens;
          }
        }
      }
    }
    
    if (!context) {
      return '## No relevant context found\nNo matching entries for the given query.';
    }
    
    return context.trim();
  }
  
  /**
   * Index code file for RAG - extracts structure and key elements
   */
  indexCodeFile(taskId: number, filePath: string, content: string, options: {
    priority?: MemoryEntry['priority'];
  } = {}): void {
    const { priority = 'medium' } = options;
    
    // Extract code structure (classes, functions, exports)
    const structure = this.extractCodeStructure(content);
    
    // Store full content
    this.set(taskId, `file:${filePath}`, content, {
      priority,
      summary: `File: ${filePath}\n${structure.summary}`,
      generateEmbedding: true
    });
    
    // Store structure separately for quick lookups
    this.set(taskId, `structure:${filePath}`, structure, {
      priority: 'high',
      summary: structure.summary,
      generateEmbedding: true
    });
  }
  
  /**
   * Extract code structure from file content
   */
  private extractCodeStructure(content: string): {
    classes: string[];
    functions: string[];
    exports: string[];
    imports: string[];
    summary: string;
  } {
    const classes = (content.match(/class\s+(\w+)/g) || []).map(m => m.replace('class ', ''));
    const functions = (content.match(/(?:function\s+|const\s+|let\s+|var\s+)(\w+)\s*(?:=\s*(?:async\s*)?\(|[\(:])/g) || [])
      .map(m => m.match(/(?:function\s+|const\s+|let\s+|var\s+)(\w+)/)?.[1] || '')
      .filter(Boolean);
    const exports = (content.match(/export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+(\w+)/g) || [])
      .map(m => m.match(/(\w+)$/)?.[1] || '')
      .filter(Boolean);
    const imports = (content.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g) || [])
      .map(m => m.match(/from\s+['"]([^'"]+)['"]/)?.[1] || '')
      .filter(Boolean);
    
    const summary = [
      classes.length ? `Classes: ${classes.join(', ')}` : '',
      functions.length ? `Functions: ${functions.slice(0, 10).join(', ')}${functions.length > 10 ? '...' : ''}` : '',
      exports.length ? `Exports: ${exports.join(', ')}` : '',
      imports.length ? `Imports: ${imports.slice(0, 5).join(', ')}${imports.length > 5 ? '...' : ''}` : ''
    ].filter(Boolean).join('\n');
    
    return { classes, functions, exports, imports, summary };
  }

  /**
   * Generate a summary for large values to use when truncating
   */
  private generateSummary(key: string, value: any): string {
    if (typeof value === 'string') {
      return value.substring(0, 200) + (value.length > 200 ? '...' : '');
    }
    
    if (Array.isArray(value)) {
      return `Array with ${value.length} items`;
    }
    
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value);
      return `Object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`;
    }
    
    return String(value).substring(0, 200);
  }

  /**
   * Get a value from memory, updating access statistics
   */
  get(taskId: number, key: string): any | undefined {
    // Check cache first
    const taskCache = this.cache.get(taskId);
    if (taskCache?.has(key)) {
      const cached = taskCache.get(key)!;
      cached.accessCount++;
      cached.lastAccessed = Date.now();
      return cached.value;
    }

    // Query database
    const stmt = this.db.prepare(`
      UPDATE shared_memory 
      SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP
      WHERE task_id = ? AND memory_key = ?
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      RETURNING memory_value, priority, access_count, size_bytes, summary
    `);

    const row = stmt.get(taskId, key) as {
      memory_value: string;
      priority: MemoryEntry['priority'];
      access_count: number;
      size_bytes: number;
      summary: string;
    } | undefined;

    if (row) {
      const value = JSON.parse(row.memory_value);
      
      this.updateCache(taskId, key, {
        value,
        priority: row.priority,
        accessCount: row.access_count,
        lastAccessed: Date.now(),
        size: row.size_bytes,
        summary: row.summary
      });
      
      return value;
    }

    return undefined;
  }

  /**
   * Get all memory entries for a task
   */
  getAll(taskId: number, options: MemoryQueryOptions = {}): Record<string, any> {
    const { priorityThreshold, maxResults } = options;
    
    let query = `
      SELECT memory_key, memory_value, priority
      FROM shared_memory
      WHERE task_id = ?
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `;
    
    const params: any[] = [taskId];
    
    if (priorityThreshold) {
      const minWeight = PRIORITY_WEIGHTS[priorityThreshold];
      const validPriorities = Object.entries(PRIORITY_WEIGHTS)
        .filter(([_, weight]) => weight >= minWeight)
        .map(([p]) => `'${p}'`);
      query += ` AND priority IN (${validPriorities.join(', ')})`;
    }
    
    query += ` ORDER BY 
      CASE priority 
        WHEN 'critical' THEN 4 
        WHEN 'high' THEN 3 
        WHEN 'medium' THEN 2 
        ELSE 1 
      END DESC, 
      access_count DESC
    `;
    
    if (maxResults) {
      query += ` LIMIT ?`;
      params.push(maxResults);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{ 
      memory_key: string; 
      memory_value: string;
      priority: string;
    }>;
    
    const result: Record<string, any> = {};
    for (const row of rows) {
      result[row.memory_key] = JSON.parse(row.memory_value);
    }

    return result;
  }

  /**
   * Build context string with intelligent truncation
   */
  buildContext(taskId: number, options: MemoryQueryOptions = {}): string {
    const { 
      includeKeys, 
      excludeKeys,
      maxLength = 6000, 
      format = 'markdown',
      priorityThreshold = 'low',
      sortBy = 'priority'
    } = options;

    // Get entries with metadata
    const entries = this.getEntriesWithMetadata(taskId, {
      includeKeys,
      excludeKeys,
      priorityThreshold,
      sortBy
    });

    if (entries.length === 0) {
      return '';
    }

    // Build context with intelligent truncation
    return this.buildContextWithTruncation(entries, maxLength, format);
  }

  private getEntriesWithMetadata(
    taskId: number, 
    options: {
      includeKeys?: string[];
      excludeKeys?: string[];
      priorityThreshold?: MemoryEntry['priority'];
      sortBy?: 'priority' | 'recency' | 'accessCount' | 'size';
    }
  ): MemoryEntry[] {
    const { includeKeys, excludeKeys, priorityThreshold = 'low', sortBy = 'priority' } = options;

    let query = `
      SELECT 
        memory_key, memory_value, priority, summary,
        access_count, size_bytes,
        created_at, updated_at, last_accessed, expires_at
      FROM shared_memory
      WHERE task_id = ?
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `;
    
    const params: any[] = [taskId];

    // Filter by keys
    if (includeKeys && includeKeys.length > 0) {
      query += ` AND memory_key IN (${includeKeys.map(() => '?').join(', ')})`;
      params.push(...includeKeys);
    }
    
    if (excludeKeys && excludeKeys.length > 0) {
      query += ` AND memory_key NOT IN (${excludeKeys.map(() => '?').join(', ')})`;
      params.push(...excludeKeys);
    }

    // Filter by priority
    const minWeight = PRIORITY_WEIGHTS[priorityThreshold];
    const validPriorities = Object.entries(PRIORITY_WEIGHTS)
      .filter(([_, weight]) => weight >= minWeight)
      .map(([p]) => `'${p}'`);
    query += ` AND priority IN (${validPriorities.join(', ')})`;

    // Sort
    const orderBy = {
      priority: `CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC`,
      recency: 'last_accessed DESC',
      accessCount: 'access_count DESC',
      size: 'size_bytes DESC'
    };
    query += ` ORDER BY ${orderBy[sortBy]}`;

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map(row => ({
      key: row.memory_key,
      value: JSON.parse(row.memory_value),
      priority: row.priority,
      summary: row.summary,
      accessCount: row.access_count,
      size: row.size_bytes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessed: row.last_accessed,
      expiresAt: row.expires_at
    }));
  }

  private buildContextWithTruncation(
    entries: MemoryEntry[],
    maxLength: number,
    format: 'json' | 'markdown' | 'text' | 'compressed'
  ): string {
    let context = '';
    let currentLength = 0;
    const includedEntries: Array<{ key: string; content: string }> = [];
    const truncatedEntries: Array<{ key: string; summary: string }> = [];

    // First pass: include what fits
    for (const entry of entries) {
      const content = this.formatEntry(entry, format);
      const entryLength = content.length;

      if (currentLength + entryLength <= maxLength * 0.8) {
        // Include full entry
        includedEntries.push({ key: entry.key, content });
        currentLength += entryLength;
      } else if (currentLength < maxLength * 0.9) {
        // Include summary
        const summary = entry.summary || this.generateSummary(entry.key, entry.value);
        truncatedEntries.push({ key: entry.key, summary });
        currentLength += summary.length + 50; // Approximate header length
      }
    }

    // Build final context
    if (format === 'markdown') {
      context = includedEntries.map(e => e.content).join('\n\n---\n\n');
      
      if (truncatedEntries.length > 0) {
        context += '\n\n---\n\n## Resumen de contexto adicional\n\n';
        context += truncatedEntries.map(e => `- **${e.key}**: ${e.summary}`).join('\n');
      }
    } else if (format === 'json') {
      const fullData = Object.fromEntries(
        includedEntries.map(e => [e.key, JSON.parse(e.content)])
      );
      if (truncatedEntries.length > 0) {
        fullData['_truncated_summaries'] = Object.fromEntries(
          truncatedEntries.map(e => [e.key, e.summary])
        );
      }
      context = JSON.stringify(fullData, null, 2);
    } else if (format === 'compressed') {
      // Compressed format: key=value pairs, one per line
      context = includedEntries.map(e => {
        const value = JSON.stringify(JSON.parse(e.content));
        return `${e.key}=${value.substring(0, 500)}`;
      }).join('\n');
    } else {
      context = includedEntries.map(e => `${e.key}:\n${e.content}`).join('\n\n');
    }

    // Final length check
    if (context.length > maxLength) {
      // Smart truncation at a natural boundary
      const truncateAt = this.findTruncationPoint(context, maxLength - 50);
      context = context.substring(0, truncateAt) + '\n\n[... Contexto truncado por limite de longitud]';
    }

    return context;
  }

  private formatEntry(entry: MemoryEntry, format: string): string {
    const value = entry.value;
    
    if (format === 'markdown') {
      return `## ${entry.key}\n\n${typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}`;
    } else if (format === 'json') {
      return JSON.stringify(value);
    } else {
      return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    }
  }

  private findTruncationPoint(text: string, maxPosition: number): number {
    // Try to find a natural break point
    const breakPoints = ['\n\n---', '\n\n##', '\n\n', '\n', '. ', ', '];
    
    for (const breakPoint of breakPoints) {
      const pos = text.lastIndexOf(breakPoint, maxPosition);
      if (pos > maxPosition * 0.7) {
        return pos;
      }
    }
    
    return maxPosition;
  }

  private updateCache(taskId: number, key: string, entry: CacheEntry): void {
    if (!this.cache.has(taskId)) {
      this.cache.set(taskId, new Map());
    }
    
    const taskCache = this.cache.get(taskId)!;
    
    // Evict if cache is full
    if (taskCache.size >= this.MAX_CACHE_SIZE && !taskCache.has(key)) {
      // Find lowest priority, least accessed entry
      let lowestKey: string | null = null;
      let lowestScore = Infinity;
      
      for (const [k, v] of taskCache) {
        const score = PRIORITY_WEIGHTS[v.priority] * 1000 + v.accessCount;
        if (score < lowestScore) {
          lowestScore = score;
          lowestKey = k;
        }
      }
      
      if (lowestKey) {
        taskCache.delete(lowestKey);
      }
    }
    
    taskCache.set(key, entry);
  }

  /**
   * Delete a specific memory entry
   */
  delete(taskId: number, key: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM shared_memory WHERE task_id = ? AND memory_key = ?
    `);
    const result = stmt.run(taskId, key);
    
    this.cache.get(taskId)?.delete(key);
    
    return result.changes > 0;
  }

  /**
   * Clear all memory for a task
   */
  clearTask(taskId: number): void {
    const stmt = this.db.prepare(`DELETE FROM shared_memory WHERE task_id = ?`);
    stmt.run(taskId);
    this.cache.delete(taskId);
  }

  /**
   * Clean up expired entries
   */
  cleanupExpired(): number {
    const stmt = this.db.prepare(`
      DELETE FROM shared_memory 
      WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
    `);
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Get memory statistics for a task
   */
  getStats(taskId: number): {
    totalEntries: number;
    totalSize: number;
    byPriority: Record<string, number>;
    averageAccessCount: number;
  } {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total_entries,
        SUM(size_bytes) as total_size,
        AVG(access_count) as avg_access
      FROM shared_memory
      WHERE task_id = ?
    `).get(taskId) as any;

    const priorityCounts = this.db.prepare(`
      SELECT priority, COUNT(*) as count
      FROM shared_memory
      WHERE task_id = ?
      GROUP BY priority
    `).all(taskId) as Array<{ priority: string; count: number }>;

    return {
      totalEntries: stats.total_entries || 0,
      totalSize: stats.total_size || 0,
      byPriority: Object.fromEntries(priorityCounts.map(p => [p.priority, p.count])),
      averageAccessCount: stats.avg_access || 0
    };
  }
}
