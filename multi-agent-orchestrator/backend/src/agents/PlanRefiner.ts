import { BaseCLIAgent, AgentConfig } from './BaseCLIAgent';
import { Plan, Phase, SubTask } from '../../shared/types';
import { socketManager } from '../websocket/socketManager';

export interface PlanImprovement {
  type: 'added' | 'modified' | 'removed' | 'reordered';
  target: 'phase' | 'subtask' | 'dependency' | 'validation' | 'context';
  targetId?: string;
  description: string;
  rationale: string;
  impact: 'high' | 'medium' | 'low';
}

export interface RefinementResult {
  success: boolean;
  iteration: number;
  originalScore: number;
  finalScore: number;
  improvements: PlanImprovement[];
  refinedPlan: Plan;
  agentContributions: Array<{
    agentType: string;
    improvementsCount: number;
    focusAreas: string[];
  }>;
  converged: boolean;
  reasoning: string;
}

export interface PlanScore {
  overall: number;
  completeness: number;
  feasibility: number;
  clarity: number;
  riskManagement: number;
  efficiency: number;
  details: string[];
}

const PLAN_REFINER_PROMPT = (plan: string, userTask: string, context: string, focusArea: string) => `
Eres un REFINADOR DE PLANES especializado en ${focusArea}.

## TU ROL
Analizar el plan existente y proponer MEJORAS CONCRETAS basadas en tu especialidad.

## TAREA ORIGINAL
${userTask}

## CONTEXTO DEL PROYECTO
${context || 'Sin contexto adicional'}

## PLAN ACTUAL
${plan}

## TU ESPECIALIDAD: ${focusArea}

${getFocusAreaInstructions(focusArea)}

## PROCESO DE ANALISIS

### PASO 1: EVALUACION
Evalua el plan actual en una escala de 1-10 para:
- Completeness: Cubre todos los aspectos necesarios?
- Feasibility: Es realizable con los recursos disponibles?
- Clarity: Las instrucciones son claras y sin ambiguedad?
- Risk Management: Se manejan los posibles fallos?
- Efficiency: Es la forma mas eficiente de lograr el objetivo?

### PASO 2: IDENTIFICACION DE MEJORAS
Lista las mejoras especificas que propones:
- Que agregar?
- Que modificar?
- Que eliminar?
- Que reordenar?

### PASO 3: JUSTIFICACION
Para cada mejora, explica:
- Por que es necesaria
- Que problema resuelve
- Cual es el impacto esperado

## EJEMPLO DE OUTPUT

\`\`\`json
{
  "evaluation": {
    "completeness": 7,
    "feasibility": 8,
    "clarity": 6,
    "riskManagement": 5,
    "efficiency": 7,
    "overall": 6.6,
    "criticalGaps": [
      "No hay manejo de errores en la fase 2",
      "Falta validacion de datos de entrada"
    ]
  },
  "improvements": [
    {
      "type": "added",
      "target": "subtask",
      "targetId": "1.5",
      "description": "Agregar subtask para validar datos de entrada antes de procesar",
      "rationale": "Previene errores en fases posteriores y mejora la robustez",
      "impact": "high",
      "insertAfter": "1.4"
    },
    {
      "type": "modified",
      "target": "subtask",
      "targetId": "2.3",
      "description": "Agregar try-catch con rollback en caso de error",
      "rationale": "La operacion actual no tiene manejo de errores, lo que puede dejar datos inconsistentes",
      "impact": "high",
      "newContent": {
        "validation_method": "Operacion exitosa O rollback ejecutado correctamente"
      }
    },
    {
      "type": "added",
      "target": "validation",
      "description": "Agregar checkpoint de validacion entre fase 1 y 2",
      "rationale": "Asegura que la fase 1 se completo correctamente antes de continuar",
      "impact": "medium"
    }
  ],
  "reasoning": "El plan actual carece de manejo de errores robusto y validacion de datos. Las mejoras propuestas aumentan la confiabilidad sin agregar complejidad innecesaria.",
  "newScore": {
    "completeness": 8,
    "feasibility": 8,
    "clarity": 7,
    "riskManagement": 8,
    "efficiency": 7,
    "overall": 7.6
  }
}
\`\`\`

## REGLAS

1. Solo propone mejoras que MEJOREN SIGNIFICATIVAMENTE el plan
2. No agregues complejidad innecesaria
3. Cada mejora debe tener justificacion clara
4. Prioriza las mejoras por impacto
5. Respeta la estructura JSON exacta

## TU RESPUESTA

Genera el analisis y mejoras en JSON estructurado.
`;

function getFocusAreaInstructions(focusArea: string): string {
  const instructions: Record<string, string> = {
    'completeness': `
Tu enfoque es asegurar que el plan cubra TODOS los aspectos necesarios:
- Todas las funcionalidades requeridas estan cubiertas?
- Hay casos edge que no se estan considerando?
- Falta algun prerequisito o dependencia?
- Hay pasos implicitos que deberian ser explicitos?
`,
    'feasibility': `
Tu enfoque es asegurar que el plan sea REALIZABLE:
- Los tiempos estimados son realistas?
- Se tienen todos los recursos necesarios?
- Las dependencias externas estan disponibles?
- Hay bloqueos potenciales no identificados?
`,
    'risk_management': `
Tu enfoque es asegurar que el plan maneje RIESGOS adecuadamente:
- Que puede salir mal en cada fase?
- Hay planes de contingencia?
- Se pueden revertir los cambios si algo falla?
- Los puntos de fallo estan identificados?
`,
    'efficiency': `
Tu enfoque es OPTIMIZAR el plan:
- Hay pasos que pueden ejecutarse en paralelo?
- Hay duplicacion de trabajo?
- Se puede simplificar alguna fase?
- El orden de ejecucion es optimo?
`,
    'clarity': `
Tu enfoque es asegurar que el plan sea CLARO y sin ambiguedad:
- Las instrucciones son especificas y accionables?
- Los deliverables estan bien definidos?
- Los criterios de validacion son medibles?
- Cualquier desarrollador podria ejecutar este plan?
`
  };
  
  return instructions[focusArea] || instructions['completeness'];
}

export class PlanRefiner extends BaseCLIAgent {
  private readonly MAX_ITERATIONS = 3;
  private readonly CONVERGENCE_THRESHOLD = 0.5; // If score improves less than this, stop
  private readonly FOCUS_AREAS = ['completeness', 'risk_management', 'efficiency', 'clarity'];

  constructor(agentPool: any, memoryManager: any, db: any, config?: Partial<AgentConfig>) {
    super(agentPool, memoryManager, db, { 
      agentType: 'plan_refiner', 
      model: 'gemini',
      ...config
    });
  }

  /**
   * Run iterative plan refinement with multiple specialized agents
   */
  async execute(
    taskId: number, 
    plan: Plan, 
    userTask: string, 
    context: string = '',
    maxIterations?: number
  ): Promise<RefinementResult> {
    const iterations = maxIterations || this.MAX_ITERATIONS;
    let currentPlan = { ...plan };
    let previousScore = await this.scorePlan(taskId, currentPlan, userTask, context);
    const allImprovements: PlanImprovement[] = [];
    const agentContributions: Map<string, { count: number; areas: Set<string> }> = new Map();
    
    console.log(`[PlanRefiner] Starting iterative refinement. Initial score: ${previousScore.overall}`);
    
    socketManager.notifyPlanIteration(taskId, {
      iteration: 0,
      maxIterations: iterations,
      improverAgent: 'scorer',
      improvements: [],
      overallScore: previousScore.overall
    });

    for (let iteration = 1; iteration <= iterations; iteration++) {
      console.log(`[PlanRefiner] Iteration ${iteration}/${iterations}`);
      
      const iterationImprovements: PlanImprovement[] = [];
      
      // Run each specialized refiner
      for (const focusArea of this.FOCUS_AREAS) {
        const result = await this.runSpecializedRefiner(
          taskId, 
          currentPlan, 
          userTask, 
          context, 
          focusArea,
          iteration
        );
        
        if (result.success && result.improvements.length > 0) {
          iterationImprovements.push(...result.improvements);
          
          // Track agent contributions
          const contribution = agentContributions.get(focusArea) || { count: 0, areas: new Set() };
          contribution.count += result.improvements.length;
          result.improvements.forEach(imp => contribution.areas.add(imp.target));
          agentContributions.set(focusArea, contribution);
          
          // Apply improvements to plan
          currentPlan = this.applyImprovements(currentPlan, result.improvements);
        }
      }
      
      if (iterationImprovements.length === 0) {
        console.log(`[PlanRefiner] No improvements found in iteration ${iteration}. Converged.`);
        break;
      }
      
      allImprovements.push(...iterationImprovements);
      
      // Score the new plan
      const newScore = await this.scorePlan(taskId, currentPlan, userTask, context);
      const scoreImprovement = newScore.overall - previousScore.overall;
      
      console.log(`[PlanRefiner] Iteration ${iteration} complete. Score: ${previousScore.overall} -> ${newScore.overall} (${scoreImprovement > 0 ? '+' : ''}${scoreImprovement.toFixed(2)})`);
      
      socketManager.notifyPlanIteration(taskId, {
        iteration,
        maxIterations: iterations,
        improverAgent: this.FOCUS_AREAS.join(', '),
        improvements: iterationImprovements,
        overallScore: newScore.overall,
        previousScore: previousScore.overall
      });
      
      // Check for convergence
      if (scoreImprovement < this.CONVERGENCE_THRESHOLD) {
        console.log(`[PlanRefiner] Score improvement below threshold (${scoreImprovement.toFixed(2)} < ${this.CONVERGENCE_THRESHOLD}). Converged.`);
        previousScore = newScore;
        break;
      }
      
      previousScore = newScore;
    }
    
    const finalScore = await this.scorePlan(taskId, currentPlan, userTask, context);
    
    return {
      success: true,
      iteration: Math.min(allImprovements.length > 0 ? this.FOCUS_AREAS.length : 1, iterations),
      originalScore: previousScore.overall,
      finalScore: finalScore.overall,
      improvements: allImprovements,
      refinedPlan: currentPlan,
      agentContributions: Array.from(agentContributions.entries()).map(([agent, data]) => ({
        agentType: agent,
        improvementsCount: data.count,
        focusAreas: Array.from(data.areas)
      })),
      converged: true,
      reasoning: `Plan refined through ${allImprovements.length} improvements across ${agentContributions.size} focus areas.`
    };
  }

  /**
   * Run a specialized refiner for a specific focus area
   */
  private async runSpecializedRefiner(
    taskId: number,
    plan: Plan,
    userTask: string,
    context: string,
    focusArea: string,
    iteration: number
  ): Promise<{ success: boolean; improvements: PlanImprovement[]; newScore?: number }> {
    const prompt = PLAN_REFINER_PROMPT(
      JSON.stringify(plan, null, 2),
      userTask,
      context,
      focusArea
    );

    socketManager.notifyAgentThinking(taskId, {
      agentId: `refiner-${focusArea}`,
      agentType: 'plan_refiner',
      phase: 'refinement',
      thinking: `Analizando plan desde perspectiva de ${focusArea}...`
    });

    const result = await this.executePrompt(
      taskId,
      'plan_refinement',
      prompt,
      context,
      `Refinement iteration ${iteration}: ${focusArea}`
    );

    if (!result.success) {
      console.warn(`[PlanRefiner] ${focusArea} refiner failed:`, result.error);
      return { success: false, improvements: [] };
    }

    const parsed = this.extractJSON<{
      evaluation: PlanScore;
      improvements: PlanImprovement[];
      newScore: PlanScore;
    }>(result.data);

    if (!parsed || !parsed.improvements) {
      return { success: false, improvements: [] };
    }

    // Filter out low-impact improvements after first iteration
    const filteredImprovements = iteration > 1
      ? parsed.improvements.filter(imp => imp.impact !== 'low')
      : parsed.improvements;

    return {
      success: true,
      improvements: filteredImprovements,
      newScore: parsed.newScore?.overall
    };
  }

  /**
   * Score a plan using a scoring agent
   */
  private async scorePlan(
    taskId: number,
    plan: Plan,
    userTask: string,
    context: string
  ): Promise<PlanScore> {
    const scoringPrompt = `
Evalua el siguiente plan para la tarea: "${userTask}"

PLAN:
${JSON.stringify(plan, null, 2)}

CONTEXTO:
${context || 'Sin contexto adicional'}

Evalua en escala 1-10:
1. completeness: Cubre todos los aspectos necesarios?
2. feasibility: Es realizable?
3. clarity: Es claro y sin ambiguedad?
4. riskManagement: Maneja los riesgos?
5. efficiency: Es eficiente?

Responde SOLO con JSON:
{
  "overall": 7.5,
  "completeness": 8,
  "feasibility": 7,
  "clarity": 8,
  "riskManagement": 6,
  "efficiency": 8,
  "details": ["Punto fuerte 1", "Punto debil 1"]
}
`;

    const result = await this.executePrompt(taskId, 'plan_scoring', scoringPrompt, context, 'Plan scoring');
    
    if (!result.success) {
      // Return default score on failure
      return {
        overall: 5,
        completeness: 5,
        feasibility: 5,
        clarity: 5,
        riskManagement: 5,
        efficiency: 5,
        details: ['Scoring failed']
      };
    }

    const parsed = this.extractJSON<PlanScore>(result.data);
    return parsed || {
      overall: 5,
      completeness: 5,
      feasibility: 5,
      clarity: 5,
      riskManagement: 5,
      efficiency: 5,
      details: ['Failed to parse score']
    };
  }

  /**
   * Apply improvements to a plan
   */
  private applyImprovements(plan: Plan, improvements: PlanImprovement[]): Plan {
    const newPlan = JSON.parse(JSON.stringify(plan)) as Plan;
    
    for (const improvement of improvements) {
      try {
        switch (improvement.type) {
          case 'added':
            this.applyAddition(newPlan, improvement);
            break;
          case 'modified':
            this.applyModification(newPlan, improvement);
            break;
          case 'removed':
            this.applyRemoval(newPlan, improvement);
            break;
          case 'reordered':
            this.applyReorder(newPlan, improvement);
            break;
        }
      } catch (error) {
        console.warn(`[PlanRefiner] Failed to apply improvement:`, improvement, error);
      }
    }
    
    return newPlan;
  }

  private applyAddition(plan: Plan, improvement: PlanImprovement): void {
    if (improvement.target === 'subtask' && improvement.targetId) {
      // Parse the phase and subtask from targetId (e.g., "1.5" -> phase 0, subtask 5)
      const [phaseNum] = improvement.targetId.split('.').map(Number);
      const phaseIndex = phaseNum - 1;
      
      if (plan.phases[phaseIndex]) {
        const newSubtask: SubTask = {
          id: improvement.targetId,
          description: improvement.description,
          assigned_agent_type: 'analyzer',
          required_context: [],
          files_to_read: [],
          deliverable: `Output for: ${improvement.description}`,
          validation_method: 'Completion verified',
          estimated_complexity: 3,
          dependencies: []
        };
        plan.phases[phaseIndex].subtasks.push(newSubtask);
      }
    } else if (improvement.target === 'validation') {
      // Add validation checkpoint
      const lastPhase = plan.phases[plan.phases.length - 1];
      if (lastPhase) {
        lastPhase.validation_checkpoints.push(improvement.description);
      }
    }
  }

  private applyModification(plan: Plan, improvement: PlanImprovement): void {
    if (improvement.target === 'subtask' && improvement.targetId) {
      for (const phase of plan.phases) {
        const subtask = phase.subtasks.find(s => s.id === improvement.targetId);
        if (subtask) {
          // Apply description changes
          if (improvement.description && !improvement.description.startsWith('Agregar')) {
            subtask.description = improvement.description;
          }
          break;
        }
      }
    }
  }

  private applyRemoval(plan: Plan, improvement: PlanImprovement): void {
    if (improvement.target === 'subtask' && improvement.targetId) {
      for (const phase of plan.phases) {
        const index = phase.subtasks.findIndex(s => s.id === improvement.targetId);
        if (index !== -1) {
          phase.subtasks.splice(index, 1);
          break;
        }
      }
    }
  }

  private applyReorder(plan: Plan, improvement: PlanImprovement): void {
    // Reordering logic would go here
    // For now, we'll skip complex reordering
  }
}
