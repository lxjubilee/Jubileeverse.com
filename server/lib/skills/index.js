/**
 * Skills Registry & Factory
 *
 * Central registry for all 15 modular, composable skills.
 * Skills wrap existing JubileeVerse services and can be chained together.
 */

const BaseSkill = require('./BaseSkill');
const WebDevelopmentSkill = require('./WebDevelopmentSkill');
const ImageGenerationSkill = require('./ImageGenerationSkill');

/**
 * Skill definitions with metadata
 */
const SKILLS = {
  'web-development': {
    name: 'Web Development & Content Generation',
    category: 'development',
    description: 'Generate articles, copy, and content using Claude API',
    class: WebDevelopmentSkill
  },
  'image-generation': {
    name: 'Image Generation',
    category: 'multimedia',
    description: 'Generate images from text prompts',
    class: ImageGenerationSkill
  },
  'testing': {
    name: 'Testing & QA',
    category: 'quality-assurance',
    description: 'Test execution and regression prevention'
  },
  'content-os': {
    name: 'Content Objects',
    category: 'data-management',
    description: 'CRUD operations on polymorphic content objects'
  },
  'taxonomy': {
    name: 'Taxonomy Management',
    category: 'organization',
    description: 'Manage hierarchical taxonomy trees and categorization'
  },
  'audit-logging': {
    name: 'Audit Logging',
    category: 'governance',
    description: 'Track events and maintain audit trails'
  },
  'storage': {
    name: 'Storage & S3',
    category: 'infrastructure',
    description: 'File storage and presigned URL generation'
  },
  'portal-generation': {
    name: 'Portal Generation',
    category: 'publishing',
    description: 'Generate portal layouts and card placements'
  },
  'author-management': {
    name: 'Author Management',
    category: 'content-management',
    description: 'Create and manage author profiles and bios'
  },
  'site-management': {
    name: 'Site Management',
    category: 'administration',
    description: 'Multi-site registry and site configuration'
  },
  'analytics': {
    name: 'Advanced Analytics',
    category: 'reporting',
    description: 'Portal analytics and performance tracking'
  },
  'security-compliance': {
    name: 'Security & Compliance',
    category: 'governance',
    description: 'Authentication, authorization, and compliance checks'
  },
  'notification-system': {
    name: 'Notification System',
    category: 'communication',
    description: 'Send notifications via email and in-app messages'
  },
  'data-migration': {
    name: 'Data Migration',
    category: 'data-management',
    description: 'Import/export and bulk data operations'
  },
  'deployment': {
    name: 'Deployment & DevOps',
    category: 'infrastructure',
    description: 'Server deployment and health monitoring'
  }
};

/**
 * Create a skill instance
 * @param {string} skillId - Skill identifier
 * @param {object} deps - Dependencies (pgPool, apiKey, etc.)
 * @returns {BaseSkill} - Skill instance
 */
function createSkill(skillId, deps = {}) {
  const skillDef = SKILLS[skillId];

  if (!skillDef) {
    throw new Error(`Unknown skill: ${skillId}`);
  }

  // If class is defined, use it; otherwise use generic BaseSkill
  const SkillClass = skillDef.class || BaseSkill;

  const skill = new SkillClass(skillId, skillDef.category, {
    name: skillDef.name,
    description: skillDef.description,
    ...deps
  });

  return skill;
}

/**
 * Create multiple skills
 */
function createSkills(skillIds, deps = {}) {
  return skillIds.map(id => createSkill(id, deps));
}

/**
 * Get skill definition
 */
function getSkillDefinition(skillId) {
  return SKILLS[skillId] || null;
}

/**
 * Get all skill definitions
 */
function getAllSkills() {
  return Object.entries(SKILLS).map(([id, def]) => ({
    id,
    ...def
  }));
}

/**
 * Get skills by category
 */
function getSkillsByCategory(category) {
  return Object.entries(SKILLS)
    .filter(([_, def]) => def.category === category)
    .map(([id, def]) => ({ id, ...def }));
}

/**
 * List all skill IDs
 */
function listSkillIds() {
  return Object.keys(SKILLS);
}

/**
 * Get all unique categories
 */
function getAllCategories() {
  return [...new Set(Object.values(SKILLS).map(s => s.category))].sort();
}

/**
 * Compose multiple skills into a chain
 * @param {string[]} skillIds - Ordered list of skill IDs
 * @param {object} deps - Dependencies for skill creation
 * @returns {object} - Chainable object with execute method
 */
function composeSkills(skillIds, deps = {}) {
  const skills = createSkills(skillIds, deps);

  return {
    skillIds,
    skills,
    async execute(input, context = {}) {
      let result = input;

      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        const executionResult = await skill.execute(result, context);

        if (!executionResult.success) {
          return {
            success: false,
            failedAt: skill.skillId,
            failedAtIndex: i,
            error: executionResult.error
          };
        }

        // Output of this skill becomes input to next
        result = executionResult.data;
      }

      return {
        success: true,
        finalResult: result,
        skillsExecuted: skillIds.length
      };
    },

    getMetrics() {
      return skills.map(s => s.getMetadata());
    }
  };
}

/**
 * Get registry report
 */
function getRegistryReport() {
  const categories = getAllCategories();
  const skillsByCategory = {};

  for (const cat of categories) {
    skillsByCategory[cat] = getSkillsByCategory(cat).length;
  }

  return {
    totalSkills: listSkillIds().length,
    categories: categories.length,
    skillsByCategory,
    skills: getAllSkills()
  };
}

module.exports = {
  createSkill,
  createSkills,
  getSkillDefinition,
  getAllSkills,
  getSkillsByCategory,
  listSkillIds,
  getAllCategories,
  composeSkills,
  getRegistryReport,
  SKILLS
};
