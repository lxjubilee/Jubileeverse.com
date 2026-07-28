/**
 * Base Agent Class - Foundation for all 12 specialized agents in JubileeVerse
 *
 * Every agent extends this class to inherit:
 * - Qdrant Collection integration (PostgreSQL-backed)
 * - Trust scoring and autonomy levels
 * - Skill loading and composition
 * - Communication with other agents
 * - Context persistence
 * - Multi-LLM persona routing via PersonaRouter
 */

class BaseAgent {
  constructor(agentId, qdrant, config = {}) {
    this.agentId = agentId;
    this.qdrant = qdrant;
    this.config = config; // Contains role, backstory, primaryModel, secondaryModel, etc.

    // State
    this.context = null;
    this.trustScore = 50;
    this.autonomyLevel = 'standard';
    this.skills = [];
    this.currentTask = null;
    this.taskHistory = [];
    this.messageQueue = [];
    this.status = 'idle';

    // Initialize empty context
    this.context = {
      agentId,
      persistentMemory: {},
      previousSessions: [],
      skillsUsed: [],
      performanceMetrics: {},
      lastTask: null
    };
  }

  /**
   * Initialize agent with Qdrant context and trust score
   */
  async initialize() {
    if (!this.qdrant) {
      console.error(`[Agent ${this.agentId}] No Qdrant Collection provided`);
      return false;
    }

    try {
      // Load persistent context from Qdrant
      const context = await this.qdrant.readAgentContext(this.agentId);
      if (context) {
        this.context = context;
      }

      // Load trust score
      this.trustScore = await this.qdrant.getTrustScore(this.agentId);
      this.autonomyLevel = this.qdrant.getAutonomyLevel(this.trustScore);

      // Load pending messages
      this.messageQueue = await this.qdrant.readMessages(this.agentId);

      this.status = 'ready';
      console.log(`✅ Agent ${this.agentId} initialized (Trust: ${this.trustScore}/100, Autonomy: ${this.autonomyLevel})`);
      return true;
    } catch (error) {
      console.error(`[Agent ${this.agentId}] Initialization error:`, error.message);
      return false;
    }
  }

  /**
   * Load skills for this agent
   */
  loadSkills(skillNames) {
    this.skills = skillNames || [];
    console.log(`📦 ${this.agentId} loaded skills: ${this.skills.join(', ')}`);
  }

  /**
   * Validate skills are available
   */
  composeSkills(skillChain) {
    const missing = skillChain.filter(s => !this.skills.includes(s));
    if (missing.length > 0) {
      console.warn(`⚠️  ${this.agentId} missing skills: ${missing.join(', ')}`);
      return false;
    }
    return true;
  }

  /**
   * Execute a task via the agent's persona/LLM
   *
   * This base implementation queues the task.
   * Subclasses override with actual persona invocation.
   */
  async executeTask(task) {
    if (this.status === 'executing') {
      console.warn(`${this.agentId} is busy, queueing task`);
      return { success: false, error: 'Agent busy' };
    }

    this.status = 'executing';
    this.currentTask = task;

    try {
      console.log(`🔄 ${this.agentId} executing task: ${task.description || task.name}`);

      // Record task start
      const taskRecord = {
        name: task.description || task.name,
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: 'executing',
        input: task.input
      };

      // Subclasses override this method to invoke actual LLM
      const result = await this._performTask(task);

      taskRecord.completedAt = new Date().toISOString();
      taskRecord.status = 'completed';
      taskRecord.output = result;

      // Track in context
      this.context.lastTask = taskRecord.name;
      if (!this.context.previousSessions) this.context.previousSessions = [];
      this.context.previousSessions.push(taskRecord);

      // Keep only recent sessions
      if (this.context.previousSessions.length > 20) {
        this.context.previousSessions = this.context.previousSessions.slice(-20);
      }

      // Update trust score
      const success = result?.success !== false;
      await this._updateTrustScore(success);

      // Save context
      await this.saveContext();

      this.status = 'idle';
      this.currentTask = null;

      return result;
    } catch (error) {
      console.error(`[Agent ${this.agentId}] Task execution error:`, error.message);

      // Record failure
      this.context.lastTask = `FAILED: ${task.description || task.name}`;
      await this._updateTrustScore(false);
      await this.saveContext();

      this.status = 'idle';
      this.currentTask = null;

      return { success: false, error: error.message };
    }
  }

  /**
   * Perform the actual task — overridden by subclasses
   * This base implementation just echoes back the task
   */
  async _performTask(task) {
    // Subclasses override this to call actual persona/LLM
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
    return { success: true, message: `Task completed by ${this.agentId}` };
  }

  /**
   * Send message to another agent
   */
  async sendMessage(toAgent, message) {
    try {
      await this.qdrant.sendMessage(this.agentId, toAgent, message, 'task');
      console.log(`📨 ${this.agentId} → ${toAgent}`);
      return true;
    } catch (error) {
      console.error(`[Agent ${this.agentId}] Send message error:`, error.message);
      return false;
    }
  }

  /**
   * Read pending messages
   */
  async readMessages() {
    try {
      this.messageQueue = await this.qdrant.readMessages(this.agentId);
      return this.messageQueue;
    } catch (error) {
      console.error(`[Agent ${this.agentId}] Read messages error:`, error.message);
      return [];
    }
  }

  /**
   * Update trust score based on task outcome
   * Formula: success(50%) + testPass(30%) + peerReview(20%)
   */
  async _updateTrustScore(success, testPassRate = 1.0, peerReviewScore = 1.0) {
    try {
      const successComponent = success ? 50 : 0;
      const testComponent = Math.round(testPassRate * 30);
      const reviewComponent = Math.round(peerReviewScore * 20);

      const newScore = Math.min(100, successComponent + testComponent + reviewComponent);

      // Smooth update — exponential moving average
      this.trustScore = Math.round((this.trustScore * 0.7 + newScore * 0.3));
      this.autonomyLevel = this.qdrant.getAutonomyLevel(this.trustScore);

      // Persist
      await this.qdrant.updateTrustScore(this.agentId, this.trustScore, testPassRate, testPassRate, peerReviewScore);

      console.log(`📊 ${this.agentId} trust: ${this.trustScore}/100 (${this.autonomyLevel})`);
    } catch (error) {
      console.error(`[Agent ${this.agentId}] Trust score update error:`, error.message);
    }
  }

  /**
   * Persist context to Qdrant
   */
  async saveContext() {
    try {
      this.context._lastSaved = new Date().toISOString();
      await this.qdrant.writeAgentContext(this.agentId, this.context);
      console.log(`💾 ${this.agentId} context saved`);
    } catch (error) {
      console.error(`[Agent ${this.agentId}] Save context error:`, error.message);
    }
  }

  /**
   * Create a checkpoint for snapshots
   */
  async checkpoint() {
    await this.saveContext();
    return {
      agentId: this.agentId,
      trustScore: this.trustScore,
      autonomyLevel: this.autonomyLevel,
      status: this.status,
      taskCount: this.context.previousSessions?.length || 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      agentId: this.agentId,
      role: this.config?.role || 'Unknown',
      status: this.status,
      trustScore: this.trustScore,
      autonomyLevel: this.autonomyLevel,
      skillCount: this.skills.length,
      pendingMessages: this.messageQueue.length,
      tasksCompleted: this.context.previousSessions?.length || 0,
      lastTask: this.context.lastTask || null
    };
  }
}

module.exports = BaseAgent;
