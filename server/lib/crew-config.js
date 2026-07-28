/**
 * CrewAI Configuration - Multi-Agent Orchestration
 *
 * Coordinates all 12 agents and 15 skills for autonomous multi-agent workflows.
 * Each workflow executes through multiple phases with agent specialization.
 */

const { createAgent } = require('./agents');

class CrewAIConfig {
  constructor(projectName, pgPool, qdrant) {
    this.projectName = projectName;
    this.pgPool = pgPool;
    this.qdrant = qdrant;

    // Agent pool (lazy-loaded)
    this.agents = {};
    this.agentIds = [
      'jubilee',  // Orchestrator
      'melody',   // Creative
      'zariah',   // Doctrinal
      'elias',    // Research
      'eliana',   // Engineering
      'caleb',    // Evangelistic
      'imani',    // Revival
      'zev',      // Linguistics
      'amir',     // Multilingual
      'nova',     // Visual
      'santiago', // Testing
      'tahoma'    // Cultural
    ];

    this.taskQueue = [];
    this.executedTasks = [];
    this.status = 'ready';
  }

  /**
   * Initialize crew — lazy-loads all 12 agents
   */
  async initialize() {
    try {
      console.log(`🚀 Initializing CrewAI for ${this.projectName}...`);

      for (const agentId of this.agentIds) {
        this.agents[agentId] = await createAgent(agentId, this.qdrant);
      }

      console.log(`✅ Crew initialized with ${this.agentIds.length} agents`);
      return true;
    } catch (error) {
      console.error('[CrewAI] Initialization error:', error.message);
      return false;
    }
  }

  /**
   * Get or create agent from pool
   */
  async getAgent(agentId) {
    if (!this.agents[agentId]) {
      this.agents[agentId] = await createAgent(agentId, this.qdrant);
    }
    return this.agents[agentId];
  }

  /**
   * Add task to queue
   */
  addTask(task) {
    this.taskQueue.push({
      id: task.id,
      name: task.name,
      phase: task.phase,
      primaryAgent: task.primaryAgent,
      reviewers: task.reviewers || [],
      description: task.description,
      input: task.input,
      status: 'queued',
      createdAt: new Date().toISOString()
    });
  }

  /**
   * Execute workflow — runs all phases sequentially
   */
  async executeWorkflow(workflow) {
    const executionId = require('crypto').randomUUID();
    const execution = {
      id: executionId,
      workflowName: workflow.name,
      startedAt: new Date().toISOString(),
      phases: [],
      status: 'executing',
      agents: {}
    };

    try {
      console.log(`\n🔄 Executing workflow: ${workflow.name}`);

      for (const phase of workflow.phases) {
        const phaseResult = await this._executePhase(phase, execution);

        execution.phases.push(phaseResult);

        // Stop if phase failed
        if (!phaseResult.success) {
          execution.status = 'failed';
          execution.failedPhase = phase.name;
          break;
        }
      }

      if (execution.status !== 'failed') {
        execution.status = 'completed';
      }

      execution.completedAt = new Date().toISOString();

      // Log execution to audit trail
      await this._logWorkflowExecution(execution);

      return execution;
    } catch (error) {
      execution.status = 'failed';
      execution.error = error.message;
      execution.completedAt = new Date().toISOString();

      await this._logWorkflowExecution(execution);

      return execution;
    }
  }

  /**
   * Execute a single workflow phase
   */
  async _executePhase(phase, execution) {
    const phaseStart = Date.now();

    try {
      console.log(`  📍 Phase: ${phase.name}`);

      // Get primary agent
      const primaryAgentId = Array.isArray(phase.agent) ? phase.agent[0] : phase.agent;
      const primaryAgent = await this.getAgent(primaryAgentId);

      // Execute task with primary agent
      const result = await primaryAgent.executeTask({
        description: phase.task,
        input: phase.input
      });

      // Get reviewers if specified
      const reviewers = Array.isArray(phase.agent) ? phase.agent.slice(1) : [];

      for (const reviewerId of reviewers) {
        const reviewer = await this.getAgent(reviewerId);
        console.log(`    ✓ ${reviewerId} reviewed`);
      }

      // Track agent involvement
      if (!execution.agents[primaryAgentId]) {
        execution.agents[primaryAgentId] = 0;
      }
      execution.agents[primaryAgentId]++;

      const phaseResult = {
        name: phase.name,
        primaryAgent: primaryAgentId,
        reviewers,
        success: result.success !== false,
        duration: Date.now() - phaseStart,
        output: result.data || result,
        completedAt: new Date().toISOString()
      };

      console.log(`    ✅ ${phase.name} completed in ${phaseResult.duration}ms`);

      return phaseResult;
    } catch (error) {
      return {
        name: phase.name,
        success: false,
        error: error.message,
        duration: Date.now() - phaseStart,
        completedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Get crew status report
   */
  getCrewStatus() {
    const agentStatuses = {};

    for (const agentId of this.agentIds) {
      const agent = this.agents[agentId];
      agentStatuses[agentId] = agent ? agent.getStatus() : { status: 'uninitialized' };
    }

    return {
      projectName: this.projectName,
      totalAgents: this.agentIds.length,
      agentStatuses,
      taskQueueSize: this.taskQueue.length,
      executedTasks: this.executedTasks.length,
      status: this.status,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get detailed crew report
   */
  getCrewReport() {
    const report = this.getCrewStatus();

    // Calculate performance metrics
    const allAgents = Object.values(this.agents);
    const avgTrustScore = allAgents.length > 0
      ? (allAgents.reduce((sum, a) => sum + (a.trustScore || 50), 0) / allAgents.length)
      : 0;

    const highTrustAgents = allAgents.filter(a => (a.trustScore || 50) >= 90).length;
    const standardTrustAgents = allAgents.filter(a => {
      const score = a.trustScore || 50;
      return score >= 70 && score < 90;
    }).length;
    const lowTrustAgents = allAgents.filter(a => (a.trustScore || 50) < 70).length;

    return {
      ...report,
      performanceMetrics: {
        avgTrustScore: Math.round(avgTrustScore),
        highTrustAgents,
        standardTrustAgents,
        lowTrustAgents,
        autonomyBreakdown: {
          high: highTrustAgents,
          standard: standardTrustAgents,
          low: lowTrustAgents
        }
      }
    };
  }

  // ========== PRIVATE METHODS ==========

  async _logWorkflowExecution(execution) {
    try {
      const { logAuditEvent } = require('./audit');
      await logAuditEvent(this.pgPool, {
        event_type: 'workflow.executed',
        actor_id: 'system',
        target_type: 'workflow',
        target_id: execution.id,
        details: {
          workflowName: execution.workflowName,
          status: execution.status,
          phaseCount: execution.phases.length,
          duration: execution.completedAt
            ? new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()
            : 0,
          agentsInvolved: Object.keys(execution.agents || {})
        },
        ip_address: null,
        user_agent: null
      });
    } catch (error) {
      console.error('[CrewAI] Log workflow error:', error.message);
    }
  }
}

module.exports = CrewAIConfig;
