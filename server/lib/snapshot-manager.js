/**
 * Snapshot Manager - Versioning and Rollback System
 *
 * Creates deployment snapshots for safe rollback in case of failures.
 * Snapshots capture Qdrant state and can be restored on-demand.
 */

const crypto = require('crypto');

class SnapshotManager {
  constructor(pgPool, qdrant) {
    this.pgPool = pgPool;
    this.qdrant = qdrant;
  }

  /**
   * Create a deployment snapshot before deploy
   */
  async createSnapshot(version, reason = 'pre-deployment', creator = 'system') {
    try {
      const snapshotId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      // Capture Qdrant state
      const qdrantSnapshot = await this.qdrant.createSnapshot(reason);

      // Capture critical database state
      const dbSnapshot = await this._captureDBSnapshot();

      // Hash for integrity check
      const snapshotData = {
        version,
        reason,
        timestamp,
        qdrantSnapshotId: qdrantSnapshot,
        dbSnapshot,
        creator
      };

      const dataHash = this._hashContent(JSON.stringify(snapshotData));

      // Store in database
      await this.pgPool.query(
        `INSERT INTO jv_deployment_snapshots (
          id, version, reason, snapshot_data, data_hash, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [snapshotId, version, reason, snapshotData, dataHash, creator]
      );

      console.log(`📸 Deployment snapshot created: ${snapshotId} (v${version})`);

      return {
        snapshotId,
        version,
        timestamp,
        dataHash
      };
    } catch (error) {
      console.error('[SnapshotManager] Create snapshot error:', error.message);
      throw error;
    }
  }

  /**
   * Rollback to a specific snapshot
   */
  async rollback(snapshotId, reason = 'manual rollback') {
    try {
      const result = await this.pgPool.query(
        `SELECT snapshot_data FROM jv_deployment_snapshots WHERE id = $1`,
        [snapshotId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      const snapshot = result.rows[0].snapshot_data;

      // Restore Qdrant state
      if (snapshot.qdrantSnapshotId) {
        await this.qdrant.rollbackSnapshot(snapshot.qdrantSnapshotId);
      }

      // Log rollback event
      await this._logRollback(snapshotId, snapshot.version, reason);

      console.log(`✅ Rolled back to snapshot ${snapshotId} (v${snapshot.version})`);

      return {
        success: true,
        snapshotId,
        version: snapshot.version,
        rolledBackAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[SnapshotManager] Rollback error:', error.message);
      throw error;
    }
  }

  /**
   * Get snapshot details
   */
  async getSnapshot(snapshotId) {
    try {
      const result = await this.pgPool.query(
        `SELECT id, version, reason, created_by, created_at, data_hash
         FROM jv_deployment_snapshots WHERE id = $1`,
        [snapshotId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error('[SnapshotManager] Get snapshot error:', error.message);
      return null;
    }
  }

  /**
   * List recent snapshots
   */
  async listSnapshots(limit = 20) {
    try {
      const result = await this.pgPool.query(
        `SELECT id, version, reason, created_by, created_at
         FROM jv_deployment_snapshots
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows;
    } catch (error) {
      console.error('[SnapshotManager] List snapshots error:', error.message);
      return [];
    }
  }

  /**
   * Delete old snapshots (keep only recent N)
   */
  async cleanupOldSnapshots(keepCount = 30) {
    try {
      const result = await this.pgPool.query(
        `DELETE FROM jv_deployment_snapshots
         WHERE id NOT IN (
           SELECT id FROM jv_deployment_snapshots
           ORDER BY created_at DESC
           LIMIT $1
         )`,
        [keepCount]
      );

      console.log(`🧹 Cleaned up ${result.rowCount} old snapshots`);
      return result.rowCount;
    } catch (error) {
      console.error('[SnapshotManager] Cleanup snapshots error:', error.message);
      return 0;
    }
  }

  // ========== PRIVATE METHODS ==========

  async _captureDBSnapshot() {
    try {
      // Capture summary stats from key tables
      const stats = await Promise.all([
        this._getTableCount('jv_content_objects'),
        this._getTableCount('jv_taxonomy'),
        this._getTableCount('jv_audit_log')
      ]);

      return {
        capturedAt: new Date().toISOString(),
        contentObjects: stats[0],
        taxonomyNodes: stats[1],
        auditLogs: stats[2]
      };
    } catch (error) {
      console.error('[SnapshotManager] Capture DB snapshot error:', error.message);
      return {};
    }
  }

  async _getTableCount(tableName) {
    try {
      const result = await this.pgPool.query(`SELECT COUNT(*) FROM ${tableName}`);
      return parseInt(result.rows[0].count);
    } catch (error) {
      return 0;
    }
  }

  async _logRollback(snapshotId, version, reason) {
    try {
      const { logAuditEvent } = require('./audit');
      await logAuditEvent(this.pgPool, {
        event_type: 'governance.auto_rollback_triggered',
        actor_id: 'system',
        target_type: 'deployment',
        target_id: snapshotId,
        details: {
          snapshotId,
          version,
          reason
        },
        ip_address: null,
        user_agent: null
      });
    } catch (error) {
      console.error('[SnapshotManager] Log rollback error:', error.message);
    }
  }

  _hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

module.exports = SnapshotManager;
