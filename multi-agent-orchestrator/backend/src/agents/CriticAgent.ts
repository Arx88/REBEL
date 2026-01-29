import { BaseCLIAgent } from './BaseCLIAgent';
import { CRITIC_AGENT_PROMPT } from '../prompts';

export type CriticVerdict = 'PASS' | 'FAIL' | 'NEEDS_REVISION';

export interface VerificationCriteria {
  objective: string;
  deliverable: string;
  verificationCriteria: string;
  subtaskId: string;
}

export interface CriticResult {
  verdict: CriticVerdict;
  confidence: number;
  reasoning: string;
  issues: CriticIssue[];
  suggestedFixes: SuggestedFix[];
  passedChecks: string[];
  failedChecks: string[];
  executionTime: number;
  rawResponse: string;
}

export interface CriticIssue {
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  category: 'logic' | 'completeness' | 'correctness' | 'style' | 'security' | 'performance';
  description: string;
  location?: string;
  impact: string;
}

export interface SuggestedFix {
  issue: string;
  fix: string;
  confidence: number;
  codeSnippet?: string;
}

export interface CriticFeedback {
  subtaskId: string;
  verdict: CriticVerdict;
  feedbackForAgent: string;
  requiredChanges: string[];
  iteration: number;
}

/**
 * CriticAgent - Evolved from PlanValidator
 * 
 * Performs post-execution verification (Level 2 - Logical Check)
 * Uses higher capability model (Gemini) to detect logical errors
 * that structural checks cannot catch.
 */
export class CriticAgent extends BaseCLIAgent {
  private maxIterations: number = 3;
  
  constructor(agentPool: any, memoryManager: any, db: any) {
    // Use Gemini for better reasoning capabilities
    super(agentPool, memoryManager, db, { agentType: 'critic', model: 'gemini' });
  }

  /**
   * Main entry point: Verify a subtask result against its contract
   */
  async execute(
    taskId: number, 
    deliverable: string, 
    criteria: VerificationCriteria,
    previousFeedback?: CriticFeedback
  ): Promise<CriticResult> {
    console.log(`[CriticAgent] Verificando subtarea ${criteria.subtaskId}`);
    const startTime = Date.now();

    const context = await this.buildVerificationContext(taskId, criteria);
    const prompt = CRITIC_AGENT_PROMPT(
      criteria.objective,
      criteria.deliverable,
      criteria.verificationCriteria,
      deliverable,
      context,
      previousFeedback
    );

    const result = await this.executePrompt(
      taskId, 
      'critic_verification', 
      prompt, 
      undefined, 
      `Critic: ${criteria.subtaskId}`
    );

    if (!result.success) {
      return this.createFailedResult(result.data, startTime);
    }

    const parsed = this.extractJSON<any>(result.data);
    
    if (parsed) {
      return this.processVerificationResult(parsed, result.data, startTime);
    }

    return this.createFailedResult('Could not parse critic response', startTime);
  }

  /**
   * Build context for verification - uses CMN to get only relevant info
   */
  private async buildVerificationContext(
    taskId: number, 
    criteria: VerificationCriteria
  ): Promise<string> {
    // Use semantic search to find relevant context for this verification
    const query = `${criteria.objective} ${criteria.deliverable} ${criteria.verificationCriteria}`;
    
    try {
      const cmn = await this.memoryManager.buildCMN(taskId, {
        query,
        maxTokens: 2000,
        includeStructure: true,
        priorityBoost: true
      });
      return cmn;
    } catch {
      // Fallback to basic context
      return this.getRelevantContext(taskId, undefined, 2000);
    }
  }

  /**
   * Process and structure the verification result
   */
  private processVerificationResult(
    parsed: any, 
    rawResponse: string, 
    startTime: number
  ): CriticResult {
    const verdict = this.normalizeVerdict(parsed.verdict);
    const confidence = Math.min(100, Math.max(0, parsed.confidence || 50));
    
    const issues: CriticIssue[] = (parsed.issues || []).map((issue: any) => ({
      severity: issue.severity || 'minor',
      category: issue.category || 'logic',
      description: issue.description || issue.issue || 'Unknown issue',
      location: issue.location,
      impact: issue.impact || 'Unknown impact'
    }));

    const suggestedFixes: SuggestedFix[] = (parsed.suggested_fixes || parsed.suggestedFixes || []).map((fix: any) => ({
      issue: fix.issue || fix.for_issue || '',
      fix: fix.fix || fix.suggestion || '',
      confidence: fix.confidence || 70,
      codeSnippet: fix.code_snippet || fix.codeSnippet
    }));

    return {
      verdict,
      confidence,
      reasoning: parsed.reasoning || '',
      issues,
      suggestedFixes,
      passedChecks: parsed.passed_checks || parsed.passedChecks || [],
      failedChecks: parsed.failed_checks || parsed.failedChecks || [],
      executionTime: Date.now() - startTime,
      rawResponse
    };
  }

  /**
   * Normalize verdict string to expected values
   */
  private normalizeVerdict(verdict: string): CriticVerdict {
    const upper = (verdict || '').toUpperCase();
    if (upper.includes('PASS') && !upper.includes('FAIL')) return 'PASS';
    if (upper.includes('FAIL')) return 'FAIL';
    if (upper.includes('REVISION') || upper.includes('IMPROVE')) return 'NEEDS_REVISION';
    return 'FAIL';
  }

  /**
   * Create a failed result for error cases
   */
  private createFailedResult(error: string, startTime: number): CriticResult {
    return {
      verdict: 'FAIL',
      confidence: 0,
      reasoning: `Verification failed: ${error}`,
      issues: [{
        severity: 'critical',
        category: 'logic',
        description: error,
        impact: 'Cannot verify result'
      }],
      suggestedFixes: [],
      passedChecks: [],
      failedChecks: ['Verification process failed'],
      executionTime: Date.now() - startTime,
      rawResponse: error
    };
  }

  /**
   * Generate feedback for the executing agent based on critic results
   */
  generateFeedback(
    subtaskId: string, 
    result: CriticResult, 
    iteration: number
  ): CriticFeedback {
    const requiredChanges: string[] = [];
    
    // Add high-priority issues as required changes
    for (const issue of result.issues) {
      if (issue.severity === 'critical' || issue.severity === 'major') {
        requiredChanges.push(`[${issue.category.toUpperCase()}] ${issue.description}`);
      }
    }
    
    // Add suggested fixes
    for (const fix of result.suggestedFixes) {
      if (fix.confidence >= 70) {
        requiredChanges.push(`FIX: ${fix.fix}`);
      }
    }

    const feedbackForAgent = this.buildAgentFeedback(result);

    return {
      subtaskId,
      verdict: result.verdict,
      feedbackForAgent,
      requiredChanges,
      iteration
    };
  }

  /**
   * Build human-readable feedback for the executing agent
   */
  private buildAgentFeedback(result: CriticResult): string {
    const lines: string[] = [];
    
    lines.push(`## Verification Result: ${result.verdict}`);
    lines.push(`Confidence: ${result.confidence}%\n`);
    
    if (result.reasoning) {
      lines.push(`### Reasoning`);
      lines.push(result.reasoning + '\n');
    }
    
    if (result.failedChecks.length > 0) {
      lines.push(`### Failed Checks`);
      result.failedChecks.forEach(check => lines.push(`- ${check}`));
      lines.push('');
    }
    
    if (result.issues.length > 0) {
      lines.push(`### Issues Found`);
      result.issues.forEach(issue => {
        lines.push(`- [${issue.severity.toUpperCase()}/${issue.category}] ${issue.description}`);
        if (issue.location) lines.push(`  Location: ${issue.location}`);
      });
      lines.push('');
    }
    
    if (result.suggestedFixes.length > 0) {
      lines.push(`### Suggested Fixes`);
      result.suggestedFixes.forEach(fix => {
        lines.push(`- ${fix.fix}`);
        if (fix.codeSnippet) {
          lines.push('```');
          lines.push(fix.codeSnippet);
          lines.push('```');
        }
      });
    }
    
    return lines.join('\n');
  }

  /**
   * Check if we should retry based on critic result
   */
  shouldRetry(result: CriticResult, currentIteration: number): boolean {
    if (result.verdict === 'PASS') return false;
    if (currentIteration >= this.maxIterations) return false;
    if (result.confidence < 30) return false; // Too uncertain to guide improvement
    
    // Only retry if there are actionable fixes
    const hasActionableFixes = result.suggestedFixes.some(f => f.confidence >= 50);
    const hasCriticalIssues = result.issues.some(i => i.severity === 'critical');
    
    return hasActionableFixes || hasCriticalIssues;
  }

  /**
   * Get maximum allowed iterations
   */
  getMaxIterations(): number {
    return this.maxIterations;
  }

  /**
   * Set maximum allowed iterations
   */
  setMaxIterations(max: number): void {
    this.maxIterations = Math.max(1, Math.min(10, max));
  }
}
