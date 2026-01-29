import { 
  Plan, 
  Phase, 
  SubTask,
  EnhancedPlan,
  PlanMetadata,
  PlanVisualization,
  DependencyNode,
  TimelinePhase,
  TimelineSubtask,
  ParallelGroup,
  RiskMapEntry,
  PlanScore
} from '../../shared/types';

/**
 * Utility class to transform plans into rich visualization data
 */
export class PlanVisualizer {
  
  /**
   * Enhance a plan with metadata and visualization data
   */
  static enhancePlan(
    plan: Plan, 
    score: PlanScore,
    version: number = 1,
    createdBy: string = 'master_planner'
  ): EnhancedPlan {
    const metadata = this.generateMetadata(plan, score, version, createdBy);
    const visualization = this.generateVisualization(plan);
    
    return {
      ...plan,
      metadata,
      visualization
    };
  }

  /**
   * Generate plan metadata
   */
  private static generateMetadata(
    plan: Plan, 
    score: PlanScore,
    version: number,
    createdBy: string
  ): PlanMetadata {
    const now = new Date().toISOString();
    const { totalSubtasks, totalComplexity } = this.calculatePlanStats(plan);
    
    // Estimate duration based on complexity
    const avgTimePerComplexity = 5; // minutes per complexity point
    const estimatedAvg = totalComplexity * avgTimePerComplexity;
    
    return {
      version,
      createdAt: now,
      lastModifiedAt: now,
      createdBy: createdBy as any,
      score,
      complexity: this.determineComplexity(totalSubtasks, totalComplexity),
      estimatedDuration: {
        min: Math.round(estimatedAvg * 0.7),
        max: Math.round(estimatedAvg * 1.5),
        average: Math.round(estimatedAvg)
      },
      tags: this.extractTags(plan)
    };
  }

  /**
   * Generate visualization data for the plan
   */
  static generateVisualization(plan: Plan): PlanVisualization {
    return {
      dependencyGraph: this.buildDependencyGraph(plan),
      timeline: this.buildTimeline(plan),
      criticalPath: this.findCriticalPath(plan),
      parallelGroups: this.identifyParallelGroups(plan),
      riskMap: this.buildRiskMap(plan)
    };
  }

  /**
   * Build dependency graph from plan
   */
  private static buildDependencyGraph(plan: Plan): DependencyNode[] {
    const nodes: DependencyNode[] = [];
    const subtaskMap = new Map<string, SubTask>();
    
    // First pass: create all nodes and build subtask map
    plan.phases.forEach((phase, phaseIndex) => {
      // Phase node
      nodes.push({
        id: `phase-${phaseIndex + 1}`,
        type: 'phase',
        label: phase.name,
        dependencies: phaseIndex > 0 ? [`phase-${phaseIndex}`] : [],
        dependents: phaseIndex < plan.phases.length - 1 ? [`phase-${phaseIndex + 2}`] : [],
        status: 'pending',
        depth: 0
      });
      
      // Subtask nodes
      phase.subtasks.forEach(subtask => {
        subtaskMap.set(subtask.id, subtask);
        nodes.push({
          id: subtask.id,
          type: 'subtask',
          label: subtask.description.substring(0, 50) + (subtask.description.length > 50 ? '...' : ''),
          dependencies: subtask.dependencies || [],
          dependents: [],
          status: 'pending',
          depth: this.calculateDepth(subtask, subtaskMap)
        });
      });
    });
    
    // Second pass: build dependents
    nodes.forEach(node => {
      if (node.type === 'subtask') {
        node.dependencies.forEach(depId => {
          const depNode = nodes.find(n => n.id === depId);
          if (depNode && !depNode.dependents.includes(node.id)) {
            depNode.dependents.push(node.id);
          }
        });
      }
    });
    
    // Calculate positions for rendering
    this.calculateNodePositions(nodes);
    
    return nodes;
  }

  /**
   * Build timeline data
   */
  private static buildTimeline(plan: Plan): TimelinePhase[] {
    let currentOffset = 0;
    const timeline: TimelinePhase[] = [];
    
    plan.phases.forEach((phase, phaseIndex) => {
      const subtasks: TimelineSubtask[] = [];
      let phaseOffset = currentOffset;
      let maxDuration = 0;
      
      // Group subtasks by dependencies to determine parallel execution
      const groups = this.groupByDependencies(phase.subtasks);
      
      groups.forEach(group => {
        let groupMaxDuration = 0;
        
        group.forEach(subtask => {
          const duration = (subtask.estimated_complexity || 3) * 5; // 5 min per complexity
          
          subtasks.push({
            id: subtask.id,
            description: subtask.description,
            startOffset: phaseOffset,
            duration,
            assignedAgent: subtask.assigned_agent_type,
            model: subtask.assigned_agent_type === 'implementer' ? 'qwen' : 'gemini',
            status: 'pending'
          });
          
          groupMaxDuration = Math.max(groupMaxDuration, duration);
        });
        
        phaseOffset += groupMaxDuration;
        maxDuration += groupMaxDuration;
      });
      
      timeline.push({
        id: `phase-${phaseIndex + 1}`,
        name: phase.name,
        startOffset: currentOffset,
        duration: maxDuration,
        subtasks,
        isParallel: groups.some(g => g.length > 1),
        dependencies: phaseIndex > 0 ? [`phase-${phaseIndex}`] : []
      });
      
      currentOffset += maxDuration;
    });
    
    return timeline;
  }

  /**
   * Find critical path through the plan
   */
  private static findCriticalPath(plan: Plan): string[] {
    const criticalPath: string[] = [];
    const subtaskMap = new Map<string, { subtask: SubTask; phase: string }>();
    
    // Build subtask map
    plan.phases.forEach((phase, i) => {
      phase.subtasks.forEach(subtask => {
        subtaskMap.set(subtask.id, { subtask, phase: `phase-${i + 1}` });
      });
    });
    
    // Find longest path using DFS
    const visited = new Set<string>();
    const memo = new Map<string, { path: string[]; length: number }>();
    
    const findLongestPath = (id: string): { path: string[]; length: number } => {
      if (memo.has(id)) return memo.get(id)!;
      
      const data = subtaskMap.get(id);
      if (!data) return { path: [], length: 0 };
      
      const { subtask } = data;
      let longestPath: string[] = [];
      let maxLength = 0;
      
      // Check all dependent subtasks
      for (const [depId, depData] of subtaskMap) {
        if (depData.subtask.dependencies?.includes(id)) {
          const result = findLongestPath(depId);
          if (result.length > maxLength) {
            maxLength = result.length;
            longestPath = result.path;
          }
        }
      }
      
      const result = {
        path: [id, ...longestPath],
        length: (subtask.estimated_complexity || 3) + maxLength
      };
      
      memo.set(id, result);
      return result;
    };
    
    // Find starting points (subtasks with no dependencies)
    let longestOverall: string[] = [];
    let maxLengthOverall = 0;
    
    for (const [id, data] of subtaskMap) {
      if (!data.subtask.dependencies || data.subtask.dependencies.length === 0) {
        const result = findLongestPath(id);
        if (result.length > maxLengthOverall) {
          maxLengthOverall = result.length;
          longestOverall = result.path;
        }
      }
    }
    
    return longestOverall;
  }

  /**
   * Identify groups of subtasks that can run in parallel
   */
  private static identifyParallelGroups(plan: Plan): ParallelGroup[] {
    const groups: ParallelGroup[] = [];
    
    plan.phases.forEach((phase, phaseIndex) => {
      const subtaskGroups = this.groupByDependencies(phase.subtasks);
      
      subtaskGroups.forEach((group, groupIndex) => {
        if (group.length > 1) {
          groups.push({
            groupId: `${phaseIndex + 1}-${groupIndex + 1}`,
            phase: phase.name,
            subtasks: group.map(s => s.id),
            canRunInParallel: true,
            reason: 'No dependencies between these subtasks'
          });
        }
      });
    });
    
    return groups;
  }

  /**
   * Build risk heat map
   */
  private static buildRiskMap(plan: Plan): RiskMapEntry[] {
    const riskMap: RiskMapEntry[] = [];
    
    plan.phases.forEach(phase => {
      phase.subtasks.forEach(subtask => {
        const riskFactors: string[] = [];
        const mitigations: string[] = [];
        
        // Check complexity
        if ((subtask.estimated_complexity || 0) >= 7) {
          riskFactors.push('Alta complejidad');
          mitigations.push('Dividir en subtareas mas pequenas si es posible');
        }
        
        // Check dependencies
        if ((subtask.dependencies?.length || 0) >= 3) {
          riskFactors.push('Muchas dependencias');
          mitigations.push('Verificar que todas las dependencias se completen correctamente');
        }
        
        // Check if modifying existing code
        if (subtask.files_to_read && subtask.files_to_read.length > 0) {
          riskFactors.push('Modifica archivos existentes');
          mitigations.push('Hacer backup antes de modificar');
        }
        
        // Check validation method
        if (!subtask.validation_method || subtask.validation_method.length < 20) {
          riskFactors.push('Validacion debil');
          mitigations.push('Definir criterios de validacion mas especificos');
        }
        
        // Check failure points from phase
        const phaseFailurePoints = phase.failure_points || [];
        const relevantFailures = phaseFailurePoints.filter(fp => 
          fp.toLowerCase().includes(subtask.id.toLowerCase()) ||
          subtask.description.toLowerCase().includes(fp.toLowerCase().split(' ')[0])
        );
        
        if (relevantFailures.length > 0) {
          riskFactors.push(...relevantFailures.map(f => `Punto de fallo: ${f}`));
        }
        
        // Determine risk level
        let riskLevel: RiskMapEntry['riskLevel'] = 'low';
        if (riskFactors.length >= 4) riskLevel = 'critical';
        else if (riskFactors.length >= 3) riskLevel = 'high';
        else if (riskFactors.length >= 1) riskLevel = 'medium';
        
        riskMap.push({
          subtaskId: subtask.id,
          riskLevel,
          factors: riskFactors,
          mitigations
        });
      });
    });
    
    return riskMap;
  }

  // Helper methods

  private static calculatePlanStats(plan: Plan): { totalSubtasks: number; totalComplexity: number } {
    let totalSubtasks = 0;
    let totalComplexity = 0;
    
    plan.phases.forEach(phase => {
      totalSubtasks += phase.subtasks.length;
      phase.subtasks.forEach(subtask => {
        totalComplexity += subtask.estimated_complexity || 3;
      });
    });
    
    return { totalSubtasks, totalComplexity };
  }

  private static determineComplexity(
    subtasks: number, 
    complexity: number
  ): PlanMetadata['complexity'] {
    const avgComplexity = complexity / Math.max(subtasks, 1);
    
    if (subtasks > 20 || avgComplexity > 7) return 'very_complex';
    if (subtasks > 10 || avgComplexity > 5) return 'complex';
    if (subtasks > 5 || avgComplexity > 3) return 'moderate';
    return 'simple';
  }

  private static extractTags(plan: Plan): string[] {
    const tags = new Set<string>();
    
    // Extract from objective
    const keywords = ['api', 'auth', 'database', 'ui', 'frontend', 'backend', 
                      'test', 'deploy', 'refactor', 'feature', 'bug', 'security'];
    
    const text = `${plan.objective} ${plan.phases.map(p => p.name).join(' ')}`.toLowerCase();
    
    keywords.forEach(keyword => {
      if (text.includes(keyword)) tags.add(keyword);
    });
    
    return Array.from(tags);
  }

  private static calculateDepth(subtask: SubTask, subtaskMap: Map<string, SubTask>): number {
    if (!subtask.dependencies || subtask.dependencies.length === 0) return 0;
    
    let maxDepth = 0;
    for (const depId of subtask.dependencies) {
      const dep = subtaskMap.get(depId);
      if (dep) {
        maxDepth = Math.max(maxDepth, this.calculateDepth(dep, subtaskMap) + 1);
      }
    }
    
    return maxDepth;
  }

  private static calculateNodePositions(nodes: DependencyNode[]): void {
    // Simple layered layout algorithm
    const layers = new Map<number, DependencyNode[]>();
    
    nodes.forEach(node => {
      const layer = node.depth;
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer)!.push(node);
    });
    
    const layerWidth = 200;
    const nodeHeight = 60;
    const padding = 20;
    
    for (const [layer, layerNodes] of layers) {
      layerNodes.forEach((node, index) => {
        node.position = {
          x: layer * layerWidth + padding,
          y: index * nodeHeight + padding
        };
      });
    }
  }

  private static groupByDependencies(subtasks: SubTask[]): SubTask[][] {
    const groups: SubTask[][] = [];
    const processed = new Set<string>();
    
    // Sort by dependencies count (fewer deps first)
    const sorted = [...subtasks].sort((a, b) => 
      (a.dependencies?.length || 0) - (b.dependencies?.length || 0)
    );
    
    while (processed.size < subtasks.length) {
      const group: SubTask[] = [];
      
      for (const subtask of sorted) {
        if (processed.has(subtask.id)) continue;
        
        // Check if all dependencies are already processed
        const allDepsProcessed = (subtask.dependencies || [])
          .every(depId => processed.has(depId));
        
        if (allDepsProcessed) {
          group.push(subtask);
          processed.add(subtask.id);
        }
      }
      
      if (group.length === 0) {
        // Circular dependency or missing dep - add remaining
        for (const subtask of sorted) {
          if (!processed.has(subtask.id)) {
            group.push(subtask);
            processed.add(subtask.id);
          }
        }
      }
      
      if (group.length > 0) groups.push(group);
    }
    
    return groups;
  }
}
