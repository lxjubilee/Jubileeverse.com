/**
 * Qdrant Initialization Module
 *
 * Initializes the Qdrant Collection (shared intelligence layer) on server startup.
 * Bootstraps the knowledge base with JubileeVerse site configuration and agent trust scores.
 */

const QdrantCollection = require('./qdrant-collection');

let globalQdrant = null;

/**
 * Initialize Qdrant Collection with JubileeVerse configuration
 */
async function initializeQdrant(pgPool) {
  try {
    globalQdrant = new QdrantCollection(pgPool, 'jubileeverse');

    // Seed initial shared knowledge from JubileeVerse config
    const initialKnowledge = {
      site_name: 'JubileeVerse',
      root_category_ids: [332],
      topics: [
        'christian-watch-us',
        'church-us',
        'church-global',
        'faith',
        'finance',
        'technology',
        'health',
        'social',
        'entertainment'
      ],
      features_enabled: [
        'content-generation',
        'image-generation',
        'portal-layout',
        'multi-agent-orchestration',
        'workflow-automation',
        'governance-gates'
      ],
      version: '1.0.0',
      initialized_at: new Date().toISOString()
    };

    await globalQdrant.writeSharedKnowledge(
      'site-config',
      initialKnowledge,
      'system',
      new Date()
    );

    // Initialize trust scores for all 12 agents
    const agents = [
      'jubilee',  // Chief Orchestrator
      'melody',   // Creative
      'zariah',   // Doctrinal Review
      'elias',    // Research
      'eliana',   // Engineering
      'caleb',    // Evangelistic
      'imani',    // Revival/Emotional
      'zev',      // Linguistics
      'amir',     // Multilingual
      'nova',     // Visual/Narrative
      'santiago', // Testing/Edge Cases
      'tahoma'    // Cultural Context
    ];

    for (const agentId of agents) {
      await globalQdrant.initializeTrustScore(agentId, 50); // Start all at 50
    }

    // Log health check
    const health = await globalQdrant.getHealth();
    console.log('✅ Qdrant Collection initialized for jubileeverse', health);

    return globalQdrant;
  } catch (error) {
    console.error('[Qdrant Init] Failed to initialize Qdrant Collection:', error.message);
    throw error;
  }
}

/**
 * Get the global Qdrant instance
 */
function getQdrant() {
  if (!globalQdrant) {
    throw new Error('[Qdrant] Collection not initialized. Call initializeQdrant() first.');
  }
  return globalQdrant;
}

module.exports = { initializeQdrant, getQdrant };
