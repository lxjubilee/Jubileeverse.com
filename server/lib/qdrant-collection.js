/**
 * QdrantCollection - Shared Intelligence Layer (PostgreSQL-backed)
 *
 * Centralized knowledge store for the multi-agent workspace:
 * - Shared knowledge base (architecture, conventions, dependencies)
 * - Per-agent persistent contexts (memories, preferences, state)
 * - Trust scores (agent performance tracking)
 * - Inter-agent communication bus
 * - Versioned snapshots with rollback protection
 */

const crypto = require('crypto');

class QdrantCollection {
  constructor(pgPool, projectName) {
    this.pgPool = pgPool;
    this.projectName = projectName;
    this.collectionName = `web_${projectName}_qdrant_collection`;
  }

  // =========== SHARED KNOWLEDGE OPERATIONS ===========

  /**
   * Read shared knowledge by key
   */
  async readSharedKnowledge(key) {
    try {
      const result = await this.pgPool.query(
        `SELECT value FROM jv_qdrant_shared_knowledge WHERE key = $1`,
        [key]
      );
      if (result.rows.length > 0) {
        return result.rows[0].value;
      }
      return null;
    } catch (error) {
      console.error(`[Qdrant] Error reading shared knowledge "${key}":`, error.message);
      return null;
    }
  }

  /**
   * Write shared knowledge by key
   */
  async writeSharedKnowledge(key, value, author = 'system', timestamp = null) {
    try {
      const data = {
        content: value,
        author,
        timestamp: timestamp || new Date().toISOString(),
        version: 1,
        _metadata: {
          lastModified: new Date().toISOString(),
          hash: this._hashContent(JSON.stringify(value))
        }
      };

      await this.pgPool.query(
        `INSERT INTO jv_qdrant_shared_knowledge (key, value, author, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, data]
      );
      return true;
    } catch (error) {
      console.error(`[Qdrant] Error writing shared knowledge "${key}":`, error.message);
      return false;
    }
  }

  // =========== AGENT CONTEXT OPERATIONS ===========

  /**
   * Read agent's persistent context
   */
  async readAgentContext(agentId) {
    try {
      const result = await this.pgPool.query(
        `SELECT context_data FROM jv_qdrant_agent_contexts WHERE agent_id = $1`,
        [agentId]
      );

      if (result.rows.length > 0) {
        return result.rows[0].context_data;
      }

      // Return default context if not found
      return {
        agentId,
        persistentMemory: {},
        previousSessions: [],
        skillsUsed: [],
        performanceMetrics: {}
      };
    } catch (error) {
      console.error(`[Qdrant] Error reading agent context "${agentId}":`, error.message);
      return null;
    }
  }

  /**
   * Write agent's persistent context
   */
  async writeAgentContext(agentId, context, timestamp = null) {
    try {
      const contextData = {
        ...context,
        _metadata: {
          lastModified: timestamp || new Date().toISOString(),
          agentId,
          version: 1
        }
      };

      await this.pgPool.query(
        `INSERT INTO jv_qdrant_agent_contexts (agent_id, context_data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT(agent_id) DO UPDATE SET context_data = $2, updated_at = NOW()`,
        [agentId, contextData]
      );
      return true;
    } catch (error) {
      console.error(`[Qdrant] Error writing agent context "${agentId}":`, error.message);
      return false;
    }
  }

  // =========== TRUST SCORE OPERATIONS ===========

  /**
   * Initialize trust score for an agent
   */
  async initializeTrustScore(agentId, initialScore = 50) {
    try {
      await this.pgPool.query(
        `INSERT INTO jv_qdrant_trust_scores (agent_id, trust_score)
         VALUES ($1, $2)
         ON CONFLICT(agent_id) DO NOTHING`,
        [agentId, initialScore]
      );
      return true;
    } catch (error) {
      console.error(`[Qdrant] Error initializing trust score for "${agentId}":`, error.message);
      return false;
    }
  }

  /**
   * Get all trust scores
   */
  async getTrustScores() {
    try {
      const result = await this.pgPool.query(
        `SELECT agent_id, trust_score FROM jv_qdrant_trust_scores ORDER BY agent_id`
      );
      const scores = {};
      result.rows.forEach(row => {
        scores[row.agent_id] = parseFloat(row.trust_score);
      });
      return scores;
    } catch (error) {
      console.error('[Qdrant] Error reading trust scores:', error.message);
      return {};
    }
  }

  /**
   * Get single agent's trust score
   */
  async getTrustScore(agentId) {
    try {
      const result = await this.pgPool.query(
        `SELECT trust_score FROM jv_qdrant_trust_scores WHERE agent_id = $1`,
        [agentId]
      );
      if (result.rows.length > 0) {
        return parseFloat(result.rows[0].trust_score);
      }
      return 50; // Default score
    } catch (error) {
      console.error(`[Qdrant] Error reading trust score for "${agentId}":`, error.message);
      return 50;
    }
  }

  /**
   * Update agent's trust score
   */
  async updateTrustScore(agentId, score, successRate = null, testPassRate = null, peerReviewScore = null) {
    if (score < 0 || score > 100) {
      console.error('[Qdrant] Trust score must be between 0 and 100');
      return false;
    }

    try {
      await this.pgPool.query(
        `UPDATE jv_qdrant_trust_scores
         SET trust_score = $1,
             success_rate = COALESCE($2, success_rate),
             test_pass_rate = COALESCE($3, test_pass_rate),
             peer_review_score = COALESCE($4, peer_review_score),
             updated_at = NOW()
         WHERE agent_id = $5`,
        [score, successRate, testPassRate, peerReviewScore, agentId]
      );
      return true;
    } catch (error) {
      console.error(`[Qdrant] Error updating trust score for "${agentId}":`, error.message);
      return false;
    }
  }

  /**
   * Get agent autonomy level based on trust score
   */
  getAutonomyLevel(trustScore) {
    if (trustScore >= 90) return 'high'; // Can act independently
    if (trustScore >= 70) return 'standard'; // Needs pre-approval
    return 'low'; // Full supervision required
  }

  // =========== COMMUNICATION OPERATIONS ===========

  /**
   * Send message between agents
   */
  async sendMessage(fromAgent, toAgent, message, messageType = 'task') {
    try {
      await this.pgPool.query(
        `INSERT INTO jv_qdrant_messages (from_agent, to_agent, message_type, content, status, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [fromAgent, toAgent, messageType, { content: message }, 'pending']
      );
      return true;
    } catch (error) {
      console.error('[Qdrant] Error sending message:', error.message);
      return false;
    }
  }

  /**
   * Read pending messages for an agent
   */
  async readMessages(agentId) {
    try {
      const result = await this.pgPool.query(
        `SELECT id, from_agent, to_agent, message_type, content, created_at
         FROM jv_qdrant_messages
         WHERE to_agent = $1 AND status = 'pending'
         ORDER BY created_at ASC`,
        [agentId]
      );
      return result.rows.map(row => ({
        id: row.id,
        from: row.from_agent,
        to: row.to_agent,
        type: row.message_type,
        content: row.content,
        timestamp: row.created_at,
        status: 'pending'
      }));
    } catch (error) {
      console.error(`[Qdrant] Error reading messages for "${agentId}":`, error.message);
      return [];
    }
  }

  /**
   * Mark message as read
   */
  async markMessageAsRead(messageId) {
    try {
      await this.pgPool.query(
        `UPDATE jv_qdrant_messages SET status = 'read', read_at = NOW() WHERE id = $1`,
        [messageId]
      );
      return true;
    } catch (error) {
      console.error('[Qdrant] Error marking message as read:', error.message);
      return false;
    }
  }

  // =========== SNAPSHOT OPERATIONS ===========

  /**
   * Create versioned snapshot
   */
  async createSnapshot(reason = 'manual') {
    try {
      const snapshotId = crypto.randomUUID();

      // Capture current state
      const sharedKnowledge = await this.pgPool.query(`SELECT * FROM jv_qdrant_shared_knowledge`);
      const agentContexts = await this.pgPool.query(`SELECT * FROM jv_qdrant_agent_contexts`);
      const trustScores = await this.pgPool.query(`SELECT * FROM jv_qdrant_trust_scores`);
      const messages = await this.pgPool.query(`SELECT * FROM jv_qdrant_messages`);

      const snapshotData = {
        timestamp: new Date().toISOString(),
        projectName: this.projectName,
        sharedKnowledge: sharedKnowledge.rows,
        agentContexts: agentContexts.rows,
        trustScores: trustScores.rows,
        messages: messages.rows
      };

      const dataHash = this._hashContent(JSON.stringify(snapshotData));

      await this.pgPool.query(
        `INSERT INTO jv_qdrant_snapshots (id, reason, snapshot_data, data_hash, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [snapshotId, reason, snapshotData, dataHash, 'system']
      );

      console.log(`📸 Snapshot created: ${snapshotId}`);
      return snapshotId;
    } catch (error) {
      console.error('[Qdrant] Error creating snapshot:', error.message);
      return null;
    }
  }

  /**
   * Rollback to specific snapshot
   */
  async rollbackSnapshot(snapshotId, agentId = null) {
    try {
      const result = await this.pgPool.query(
        `SELECT snapshot_data FROM jv_qdrant_snapshots WHERE id = $1`,
        [snapshotId]
      );

      if (result.rows.length === 0) {
        console.error(`[Qdrant] Snapshot not found: ${snapshotId}`);
        return false;
      }

      const snapshot = result.rows[0].snapshot_data;

      if (agentId) {
        // Rollback single agent context
        const agentData = snapshot.agentContexts.find(ac => ac.agent_id === agentId);
        if (agentData) {
          await this.pgPool.query(
            `UPDATE jv_qdrant_agent_contexts SET context_data = $1 WHERE agent_id = $2`,
            [agentData.context_data, agentId]
          );
          console.log(`✅ Rolled back agent "${agentId}" to snapshot ${snapshotId}`);
          return true;
        }
      } else {
        // Full rollback - restore all collections
        await this.pgPool.query(`DELETE FROM jv_qdrant_messages`);
        await this.pgPool.query(`DELETE FROM jv_qdrant_agent_contexts`);
        await this.pgPool.query(`DELETE FROM jv_qdrant_trust_scores`);
        await this.pgPool.query(`DELETE FROM jv_qdrant_shared_knowledge`);

        // Restore from snapshot
        for (const sk of snapshot.sharedKnowledge) {
          await this.pgPool.query(
            `INSERT INTO jv_qdrant_shared_knowledge (id, key, value, author, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [sk.id, sk.key, sk.value, sk.author, sk.created_at, sk.updated_at]
          );
        }

        for (const ac of snapshot.agentContexts) {
          await this.pgPool.query(
            `INSERT INTO jv_qdrant_agent_contexts (id, agent_id, context_data, updated_at)
             VALUES ($1, $2, $3, $4)`,
            [ac.id, ac.agent_id, ac.context_data, ac.updated_at]
          );
        }

        for (const ts of snapshot.trustScores) {
          await this.pgPool.query(
            `INSERT INTO jv_qdrant_trust_scores (id, agent_id, trust_score, success_rate, test_pass_rate, peer_review_score, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [ts.id, ts.agent_id, ts.trust_score, ts.success_rate, ts.test_pass_rate, ts.peer_review_score, ts.updated_at]
          );
        }

        console.log(`✅ Rolled back entire collection to snapshot ${snapshotId}`);
        return true;
      }
    } catch (error) {
      console.error('[Qdrant] Error rolling back snapshot:', error.message);
      return false;
    }
  }

  // =========== UTILITY OPERATIONS ===========

  /**
   * Get collection health status
   */
  async getHealth() {
    try {
      const sharedKnowledge = await this.pgPool.query(`SELECT COUNT(*) FROM jv_qdrant_shared_knowledge`);
      const agentContexts = await this.pgPool.query(`SELECT COUNT(*) FROM jv_qdrant_agent_contexts`);
      const snapshots = await this.pgPool.query(`SELECT COUNT(*) FROM jv_qdrant_snapshots`);

      return {
        status: 'healthy',
        projectName: this.projectName,
        collectionName: this.collectionName,
        sharedKnowledgeCount: parseInt(sharedKnowledge.rows[0].count),
        agentContextsCount: parseInt(agentContexts.rows[0].count),
        snapshotsCount: parseInt(snapshots.rows[0].count),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // =========== PRIVATE UTILITY METHODS ===========

  _hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

module.exports = QdrantCollection;
