/**
 * WebDevelopmentSkill
 *
 * Wraps GenerationService for content generation using Claude API
 * Category: Development
 */

const BaseSkill = require('./BaseSkill');
const GenerationService = require('../generation-service');

class WebDevelopmentSkill extends BaseSkill {
  constructor(apiKey) {
    super('web-development', 'development', {
      name: 'Web Development & Content Generation',
      description: 'Generate content, articles, and marketing copy using Claude API'
    });
    this.generationService = new GenerationService(apiKey);
  }

  validateInput(input) {
    super.validateInput(input);
    if (!input.prompt) {
      throw new Error('web-development skill: prompt required');
    }
    if (!input.authorId) {
      throw new Error('web-development skill: authorId required');
    }
  }

  async performSkill(input, context) {
    const {
      prompt,
      authorId,
      type = 'article',
      tone = 'professional',
      maxTokens = 2000,
      temperature = 0.7
    } = input;

    const result = await this.generationService._create({
      prompt,
      author_id: authorId,
      type,
      tone,
      max_tokens: maxTokens,
      temperature
    });

    return {
      success: true,
      content: result.content,
      tokenUsage: result.tokenUsage,
      model: result.model,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = WebDevelopmentSkill;
