import { BaseCLIAgent } from './BaseCLIAgent';
import { PLAN_VALIDATOR_PROMPT } from '../prompts';
import { Plan } from '../../../shared/types';
import { scorePlanQuality, validatePlanStrict, PlanQualityScore } from '../core/PlanQuality';

export interface ValidationResult {
  approved: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
  reasoning: string;
  rawResponse: string;
  executionTime: number;
  qualityScore?: PlanQualityScore;
}

export class PlanValidator extends BaseCLIAgent {
  constructor(agentPool: any, memoryManager: any, db: any) {
    super(agentPool, memoryManager, db, { agentType: 'plan_validator', model: 'qwen' });
  }

  async execute(taskId: number, plan: Plan | string, userInput: string, projectContext: string = ''): Promise<ValidationResult> {
    console.log(`[PlanValidator] Validando plan`);
    const startTime = Date.now();

    const planString = typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2);
    const planObject = this.tryParsePlan(plan);
    const strictValidation = planObject ? validatePlanStrict(planObject) : { valid: false, issues: ['Plan structure missing.'] };
    const qualityScore = planObject ? scorePlanQuality(planObject) : undefined;
    const prompt = PLAN_VALIDATOR_PROMPT(planString, userInput);

    const result = await this.executePrompt(taskId, 'plan_validation', prompt, undefined, 'Validación de plan');

    if (!result.success) {
      return { 
        approved: false, 
        confidence: 0, 
        issues: [result.data, ...strictValidation.issues], 
        suggestions: [],
        reasoning: 'Error', 
        rawResponse: result.data, 
        executionTime: result.executionTime,
        qualityScore
      };
    }

    const parsed = this.extractJSON<any>(result.data);

    if (parsed) {
      const parsedIssues = this.extractIssues(parsed);
      const parsedSuggestions = this.extractSuggestions(parsed);
      const approvedByModel = parsed.verdict === 'APPROVED' && (parsed.confidence_score || 0) >= 70;
      const approved = approvedByModel && strictValidation.valid && (qualityScore?.overall ?? 0) >= 6;

      return {
        approved,
        confidence: parsed.confidence_score || 50,
        issues: [...strictValidation.issues, ...parsedIssues],
        suggestions: parsedSuggestions,
        reasoning: parsed.reasoning || '',
        rawResponse: result.data,
        executionTime: Date.now() - startTime,
        qualityScore
      };
    }

    return { 
      approved: false, 
      confidence: 40, 
      issues: ['No parseable', ...strictValidation.issues], 
      suggestions: [],
      reasoning: 'Error de parseo', 
      rawResponse: result.data, 
      executionTime: Date.now() - startTime,
      qualityScore
    };
  }

  private extractIssues(parsed: any): string[] {
    const issues: string[] = [];

    if (Array.isArray(parsed.critical_issues)) {
      parsed.critical_issues.forEach((issue: any) => {
        if (typeof issue === 'string') {
          issues.push(issue);
        } else if (issue?.issue) {
          const subtask = issue.subtask_id ? ` (${issue.subtask_id})` : '';
          issues.push(`${issue.issue}${subtask}`);
        }
      });
    }

    if (Array.isArray(parsed.analysis?.weaknesses)) {
      issues.push(...parsed.analysis.weaknesses.filter((item: unknown) => typeof item === 'string'));
    }

    if (Array.isArray(parsed.missing_context)) {
      parsed.missing_context.forEach((item: unknown) => {
        if (typeof item === 'string') {
          issues.push(`Falta contexto: ${item}`);
        }
      });
    }

    return issues;
  }

  private extractSuggestions(parsed: any): string[] {
    const suggestions: string[] = [];

    if (Array.isArray(parsed.suggestions)) {
      suggestions.push(...parsed.suggestions.filter((item: unknown) => typeof item === 'string'));
    }

    if (Array.isArray(parsed.analysis?.strengths)) {
      suggestions.push(...parsed.analysis.strengths.filter((item: unknown) => typeof item === 'string'));
    }

    return suggestions;
  }

  private tryParsePlan(plan: Plan | string): Plan | null {
    if (typeof plan !== 'string') {
      return plan;
    }
    try {
      return JSON.parse(plan) as Plan;
    } catch {
      return null;
    }
  }
}
