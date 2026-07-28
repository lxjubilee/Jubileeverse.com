/**
 * Workflow Executor - Multi-Agent Workflow Management
 *
 * Executes predefined workflows coordinating multiple agents through phases.
 * Tracks execution, handles failures, and maintains audit trail.
 */

const CrewAIConfig = require('./crew-config');
const crypto = require('crypto');

class WorkflowExecutor {
  constructor(pgPool, qdrant) {
    this.pgPool = pgPool;
    this.qdrant = qdrant;
    this.crew = null;
    this.workflows = new Map();
    this._registerWorkflows();
  }

  /**
   * Initialize executor — sets up CrewAI
   */
  async initialize() {
    try {
      this.crew = new CrewAIConfig('jubileeverse', this.pgPool, this.qdrant);
      await this.crew.initialize();
      console.log('✅ Workflow Executor initialized');
      return true;
    } catch (error) {
      console.error('[WorkflowExecutor] Init error:', error.message);
      return false;
    }
  }

  /**
   * Execute a workflow by name
   */
  async executeWorkflow(workflowName, input = {}) {
    if (!this.crew) {
      throw new Error('Workflow Executor not initialized');
    }

    const workflow = this.workflows.get(workflowName);
    if (!workflow) {
      throw new Error(`Unknown workflow: ${workflowName}`);
    }

    // Prepare workflow with input
    const preparedWorkflow = {
      ...workflow,
      input
    };

    // Execute via CrewAI
    return await this.crew.executeWorkflow(preparedWorkflow);
  }

  /**
   * List available workflows
   */
  listWorkflows() {
    return Array.from(this.workflows.values()).map(w => ({
      name: w.name,
      description: w.description,
      phases: w.phases.length,
      agents: w.phases.flatMap(p =>
        Array.isArray(p.agent) ? p.agent : [p.agent]
      )
    }));
  }

  /**
   * Get workflow definition
   */
  getWorkflow(name) {
    return this.workflows.get(name) || null;
  }

  /**
   * Get crew status
   */
  getCrewStatus() {
    return this.crew ? this.crew.getCrewStatus() : null;
  }

  /**
   * Get detailed crew report
   */
  getCrewReport() {
    return this.crew ? this.crew.getCrewReport() : null;
  }

  // ========== WORKFLOW DEFINITIONS ==========

  _registerWorkflows() {
    // Workflow 1: Content Generation
    this.workflows.set('content-generation', {
      name: 'content-generation',
      description: 'Generate article from topic with multi-phase review',
      phases: [
        {
          name: 'discovery',
          agent: 'jubilee',
          task: 'Analyze topic and gather requirements for content generation',
          input: {}
        },
        {
          name: 'design',
          agent: ['zariah', 'eliana'],
          task: 'Design content outline and structure with doctrinal and technical review',
          input: {}
        },
        {
          name: 'generation',
          agent: 'melody',
          task: 'Generate creative content using web-development skill',
          input: { skill: 'web-development' }
        },
        {
          name: 'review',
          agent: ['zariah', 'nova'],
          task: 'Review content for theological accuracy and visual narrative',
          input: {}
        },
        {
          name: 'publish',
          agent: ['eliana', 'jubilee'],
          task: 'Publish content and notify subscribers',
          input: {}
        }
      ]
    });

    // Workflow 2: Image Generation
    this.workflows.set('image-generation', {
      name: 'image-generation',
      description: 'Generate and approve images for articles',
      phases: [
        {
          name: 'prompt-creation',
          agent: 'nova',
          task: 'Create detailed image prompt from article content',
          input: {}
        },
        {
          name: 'generation',
          agent: 'eliana',
          task: 'Generate image using image-generation skill',
          input: { skill: 'image-generation' }
        },
        {
          name: 'quality-review',
          agent: ['nova', 'santiago'],
          task: 'Review image quality and brand compliance',
          input: {}
        },
        {
          name: 'approval',
          agent: 'jubilee',
          task: 'Final approval and asset tagging',
          input: {}
        }
      ]
    });

    // Workflow 3: Portal Refresh
    this.workflows.set('portal-refresh', {
      name: 'portal-refresh',
      description: 'Regenerate portal layout with latest content',
      phases: [
        {
          name: 'collection',
          agent: 'elias',
          task: 'Gather latest content and popularity metrics',
          input: {}
        },
        {
          name: 'selection',
          agent: 'jubilee',
          task: 'Select featured content for portal slots',
          input: {}
        },
        {
          name: 'generation',
          agent: 'eliana',
          task: 'Generate portal layout using portal-generation skill',
          input: { skill: 'portal-generation' }
        },
        {
          name: 'validation',
          agent: ['santiago', 'nova'],
          task: 'Validate layout and visual consistency',
          input: {}
        },
        {
          name: 'deployment',
          agent: 'jubilee',
          task: 'Deploy portal and monitor metrics',
          input: {}
        }
      ]
    });

    // Workflow 4: Content Audit
    this.workflows.set('content-audit', {
      name: 'content-audit',
      description: 'Run comprehensive audit on content objects',
      phases: [
        {
          name: 'scan',
          agent: 'elias',
          task: 'Scan all content objects for completeness',
          input: {}
        },
        {
          name: 'doctrinal-check',
          agent: 'zariah',
          task: 'Check theological accuracy and alignment',
          input: {}
        },
        {
          name: 'compliance-check',
          agent: 'eliana',
          task: 'Check metadata, tags, and technical compliance',
          input: {}
        },
        {
          name: 'reporting',
          agent: 'jubilee',
          task: 'Generate audit report and recommendations',
          input: {}
        }
      ]
    });

    // Workflow 5: Multi-Language Expansion
    this.workflows.set('multilingual-expansion', {
      name: 'multilingual-expansion',
      description: 'Expand content to multiple languages',
      phases: [
        {
          name: 'source-prep',
          agent: 'elias',
          task: 'Prepare source content for translation',
          input: {}
        },
        {
          name: 'translation',
          agent: 'amir',
          task: 'Translate content maintaining cultural context',
          input: {}
        },
        {
          name: 'linguistic-review',
          agent: 'zev',
          task: 'Review linguistics and cultural accuracy',
          input: {}
        },
        {
          name: 'publication',
          agent: 'jubilee',
          task: 'Publish translated content',
          input: {}
        }
      ]
    });

    // Workflow 6: Evangelistic Campaign
    this.workflows.set('evangelistic-campaign', {
      name: 'evangelistic-campaign',
      description: 'Create persuasive evangelistic content campaign',
      phases: [
        {
          name: 'strategy',
          agent: 'caleb',
          task: 'Develop evangelistic messaging strategy',
          input: {}
        },
        {
          name: 'creation',
          agent: ['imani', 'melody'],
          task: 'Create high-impact content with revival intensity',
          input: { skill: 'web-development' }
        },
        {
          name: 'validation',
          agent: ['zariah', 'santiago'],
          task: 'Validate theological accuracy and edge cases',
          input: {}
        },
        {
          name: 'deployment',
          agent: 'jubilee',
          task: 'Deploy campaign across channels',
          input: {}
        }
      ]
    });

    console.log(`📋 Registered ${this.workflows.size} workflows`);
  }
}

module.exports = WorkflowExecutor;
