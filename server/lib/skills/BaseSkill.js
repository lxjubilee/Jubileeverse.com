/**
 * Base Skill Class - Foundation for all 15 modular skills
 *
 * Every skill inherits:
 * - Execution framework with error handling
 * - Input validation
 * - Performance tracking (execution time, success rate)
 * - Composable skill chaining
 * - Integration with agent context
 */

class BaseSkill {
  constructor(skillId, category = 'general', config = {}) {
    this.skillId = skillId;
    this.category = category;
    this.name = config.name || skillId;
    this.description = config.description || '';

    // In-memory execution tracking (in production, persist to DB)
    this.executions = [];
    this.totalExecutions = 0;
    this.totalSuccesses = 0;
    this.successRate = 0;
    this.avgExecutionTime = 0;
  }

  /**
   * Execute skill with validation, execution, and tracking
   */
  async execute(input, context = {}) {
    const startTime = Date.now();

    try {
      // Validate input
      this.validateInput(input);

      // Execute skill logic
      const result = await this.performSkill(input, context);

      // Track successful execution
      const execution = {
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        status: 'success',
        success: true,
        error: null
      };

      this._recordExecution(execution);

      return {
        success: true,
        data: result,
        duration: execution.duration,
        skillId: this.skillId
      };
    } catch (error) {
      // Track failed execution
      const execution = {
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        status: 'failed',
        success: false,
        error: error.message
      };

      this._recordExecution(execution);

      return {
        success: false,
        error: error.message,
        duration: execution.duration,
        skillId: this.skillId
      };
    }
  }

  /**
   * Validate input — override in subclasses
   */
  validateInput(input) {
    // Default: input is required
    if (!input) {
      throw new Error(`${this.skillId} skill: input is required`);
    }
  }

  /**
   * Perform skill logic — MUST be overridden in subclasses
   */
  async performSkill(input, context) {
    throw new Error(`${this.skillId} skill: performSkill() must be implemented in subclass`);
  }

  /**
   * Compose skills: chain this skill with another
   * Output of this skill becomes input to next skill
   */
  async composeWith(nextSkill, input, context = {}) {
    // Execute this skill first
    const result1 = await this.execute(input, context);

    if (!result1.success) {
      return result1;
    }

    // Execute next skill with our output
    const result2 = await nextSkill.execute(result1.data, context);

    return result2;
  }

  /**
   * Get skill metadata
   */
  getMetadata() {
    return {
      skillId: this.skillId,
      name: this.name,
      category: this.category,
      description: this.description,
      metrics: {
        totalExecutions: this.totalExecutions,
        successCount: this.totalSuccesses,
        failureCount: this.totalExecutions - this.totalSuccesses,
        successRate: this.successRate,
        avgExecutionTime: this.avgExecutionTime
      }
    };
  }

  /**
   * Get recent execution history
   */
  getExecutionHistory(limit = 10) {
    return this.executions.slice(-limit);
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics() {
    this.executions = [];
    this.totalExecutions = 0;
    this.totalSuccesses = 0;
    this.successRate = 0;
    this.avgExecutionTime = 0;
  }

  // ========== PRIVATE METHODS ==========

  _recordExecution(execution) {
    this.executions.push(execution);
    this.totalExecutions++;
    if (execution.success) {
      this.totalSuccesses++;
    }
    this._updateMetrics();
  }

  _updateMetrics() {
    // Success rate
    this.successRate = this.totalExecutions > 0
      ? Math.round((this.totalSuccesses / this.totalExecutions) * 100)
      : 0;

    // Average execution time
    if (this.executions.length > 0) {
      const totalDuration = this.executions.reduce((sum, e) => sum + (e.duration || 0), 0);
      this.avgExecutionTime = Math.round(totalDuration / this.executions.length);
    }

    // Keep only recent executions in memory (last 100)
    if (this.executions.length > 100) {
      this.executions = this.executions.slice(-100);
    }
  }
}

module.exports = BaseSkill;
