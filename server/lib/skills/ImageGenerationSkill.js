/**
 * ImageGenerationSkill
 *
 * Wraps image generation pipeline (InspireCortex/Leonardo)
 * Category: Multimedia
 */

const BaseSkill = require('./BaseSkill');

class ImageGenerationSkill extends BaseSkill {
  constructor(pgPool) {
    super('image-generation', 'multimedia', {
      name: 'Image Generation',
      description: 'Generate images from text prompts using InspireCortex or Leonardo AI'
    });
    this.pgPool = pgPool;
  }

  validateInput(input) {
    super.validateInput(input);
    if (!input.prompt) {
      throw new Error('image-generation skill: prompt required');
    }
    if (!input.articleId) {
      throw new Error('image-generation skill: articleId required');
    }
  }

  async performSkill(input, context) {
    const {
      prompt,
      articleId,
      articleType = 'article',
      provider = 'inspirecortex',
      width = 1024,
      height = 1024
    } = input;

    try {
      // Insert job record
      const result = await this.pgPool.query(
        `INSERT INTO image_generation_jobs (
          article_id, article_type, prompt, provider,
          width, height, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id, prompt, status, created_at`,
        [articleId, articleType, prompt, provider, width, height, 'pending']
      );

      const job = result.rows[0];

      return {
        success: true,
        jobId: job.id,
        status: job.status,
        prompt: job.prompt,
        provider,
        message: 'Image generation job created',
        timestamp: job.created_at
      };
    } catch (error) {
      throw new Error(`Failed to create image generation job: ${error.message}`);
    }
  }
}

module.exports = ImageGenerationSkill;
