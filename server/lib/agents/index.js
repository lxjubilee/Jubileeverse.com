/**
 * Agent Registry & Factory
 *
 * Central registry for all 12 specialized agents in JubileeVerse.
 * Each agent maps to an existing persona from PersonaRouter.
 */

const JubileeAgent = require('./JubileeAgent');

// Agent definitions mapping to existing personas
const AGENTS = {
  'jubilee': {
    class: JubileeAgent,
    name: 'Jubilee',
    role: 'Chief Orchestrator',
    description: 'Orchestrates all specialists',
    models: { primary: 'grok-2', secondary: 'claude-opus-4.6' }
  },
  'melody': {
    name: 'Melody',
    role: 'Creative Specialist',
    description: 'Music, creative, and artistic content',
    models: { primary: 'minimax-m2.5', secondary: 'claude-opus-4.6' }
  },
  'zariah': {
    name: 'Zariah',
    role: 'Doctrinal Review',
    description: 'Theological accuracy and doctrine verification',
    models: { primary: 'deepseek-chat', secondary: 'claude-opus-4.6' }
  },
  'elias': {
    name: 'Elias',
    role: 'Research Specialist',
    description: 'Long-context research and deep analysis',
    models: { primary: 'kimi-k2.5', secondary: 'claude-opus-4.6' }
  },
  'eliana': {
    name: 'Eliana',
    role: 'Engineering Specialist',
    description: 'Code, technical systems, and engineering',
    models: { primary: 'gpt-4o', secondary: 'kimi-k2.5' }
  },
  'caleb': {
    name: 'Caleb',
    role: 'Evangelistic Messaging',
    description: 'Persuasive, evangelistic, and conversion-focused content',
    models: { primary: 'minimax-m2.5', secondary: 'grok-2' }
  },
  'imani': {
    name: 'Imani',
    role: 'Revival & Emotional',
    description: 'High-intensity revival, emotional awakening, passion',
    models: { primary: 'gpt-4o', secondary: 'grok-2' }
  },
  'zev': {
    name: 'Zev',
    role: 'Linguistics Specialist',
    description: 'Hebrew, Greek, linguistics, word studies',
    models: { primary: 'glm-4', secondary: 'claude-opus-4.6' }
  },
  'amir': {
    name: 'Amir',
    role: 'Multilingual Specialist',
    description: 'Multilingual content, global perspectives',
    models: { primary: 'minimax-m2.5', secondary: 'grok-2' }
  },
  'nova': {
    name: 'Nova',
    role: 'Visual & Narrative',
    description: 'Visual content, storytelling, narrative craft',
    models: { primary: 'gpt-4o', secondary: 'claude-opus-4.6' }
  },
  'santiago': {
    name: 'Santiago',
    role: 'Edge Cases & Testing',
    description: 'Stress testing, edge cases, negative scenarios',
    models: { primary: 'kimi-k2.5', secondary: 'grok-2' }
  },
  'tahoma': {
    name: 'Tahoma',
    role: 'Cultural Context',
    description: 'Cultural sensitivity, diverse perspectives',
    models: { primary: 'grok-2', secondary: 'claude-opus-4.6' }
  }
};

/**
 * Create an agent instance
 * @param {string} agentId - Agent identifier (e.g., 'jubilee', 'melody')
 * @param {QdrantCollection} qdrant - Qdrant Collection instance
 * @param {object} config - Optional config overrides
 * @returns {BaseAgent} - Agent instance
 */
async function createAgent(agentId, qdrant, config = {}) {
  const agentDef = AGENTS[agentId];

  if (!agentDef) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  // If class is defined, use it; otherwise use generic BaseAgent
  let AgentClass = agentDef.class;
  if (!AgentClass) {
    const BaseAgent = require('./BaseAgent');
    AgentClass = BaseAgent;
  }

  const agent = new AgentClass(qdrant, {
    ...agentDef,
    ...config
  });

  // Initialize the agent
  await agent.initialize();

  return agent;
}

/**
 * Get all agent definitions
 */
function getAgentDefinitions() {
  return Object.entries(AGENTS).map(([id, def]) => ({
    id,
    ...def
  }));
}

/**
 * Get a single agent definition
 */
function getAgentDefinition(agentId) {
  return AGENTS[agentId] || null;
}

/**
 * List all agent IDs
 */
function listAgentIds() {
  return Object.keys(AGENTS);
}

module.exports = {
  createAgent,
  getAgentDefinitions,
  getAgentDefinition,
  listAgentIds,
  AGENTS
};
