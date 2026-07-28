/**
 * Advanced Task Executor with AI-powered execution
 * Processes task instructions and executes them with heartbeat monitoring
 * Powered by Claude AI for intelligent command generation
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const execAsync = promisify(exec);

class TaskExecutor {
    constructor(anthropicApiKey) {
        this.pgPool = null; // Set from server.js after pgPool is initialized
        this.activeTasks = new Map();
        this.anthropic = new Anthropic({
            apiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY_PRIMARY || process.env.CLAUDE_API_KEY
        });
        this.projectRoot = path.join(__dirname, '..');
    }

    /**
     * Execute a task with heartbeat monitoring
     */
    async executeTask(taskId) {
        if (this.activeTasks.has(taskId)) {
            console.log(`Task #${taskId} is already running`);
            return;
        }

        this.activeTasks.set(taskId, { status: 'running', iteration: 0 });

        console.log(`\n${'='.repeat(80)}`);
        console.log(`💓 HEARTBEAT TASK EXECUTOR - Task #${taskId}`);
        console.log('='.repeat(80));

        try {
            const result = await this.pgPool.query('SELECT * FROM jv_pulse_tasks WHERE id = $1', [taskId]);
            const task = result.rows[0];

            if (!task) {
                throw new Error(`Task #${taskId} not found`);
            }

            // Update status to in-progress
            await this.updateTaskStatus(taskId, 'in-progress', 'Task execution started');

            // Parse and execute the task instructions
            await this.processInstructions(taskId, task);

            // Mark as completed
            await this.updateTaskStatus(taskId, 'completed', 'Task completed successfully');

            console.log(`\n✅ Task #${taskId} completed!`);

        } catch (error) {
            console.error(`❌ Task #${taskId} failed:`, error);
            await this.updateTaskStatus(taskId, 'failed', `Error: ${error.message}`);

        } finally {
            this.activeTasks.delete(taskId);
            console.log('='.repeat(80));
        }
    }

    /**
     * Process task instructions using Claude AI
     */
    async processInstructions(taskId, task) {
        const { instructions, category_location, title } = task;

        console.log(`\n📋 Task: ${title}`);
        console.log(`📋 Instructions: ${instructions}`);
        console.log(`📍 Category: ${category_location}`);

        await this.appendTaskLog(taskId, `\n=== Task Execution Started ===\n`);
        await this.appendTaskLog(taskId, `Task: ${title}\n`);
        await this.appendTaskLog(taskId, `Instructions: ${instructions}\n\n`);

        try {
            // Use Claude AI to generate execution plan
            const actions = await this.generateExecutionPlan(instructions, category_location);

            await this.appendTaskLog(taskId, `\n=== Execution Plan Generated ===\n`);
            await this.appendTaskLog(taskId, `${actions.length} action(s) to execute\n\n`);

            // Execute actions sequentially
            for (let i = 0; i < actions.length; i++) {
                const action = actions[i];
                await this.appendTaskLog(taskId, `\n--- Action ${i + 1}/${actions.length} ---\n`);
                await this.appendTaskLog(taskId, `Type: ${action.type}\n`);
                await this.appendTaskLog(taskId, `${action.description}\n\n`);

                console.log(`\n🔧 Executing: ${action.description} [${action.type}]`);

                try {
                    let result;
                    if (action.type === 'postgres_sql') {
                        result = await this.executePostgresQuery(action.query, action.params || []);
                        await this.appendTaskLog(taskId, `Rows affected: ${result.rowCount}\n`);
                        if (result.rows && result.rows.length > 0) {
                            await this.appendTaskLog(taskId, `Result: ${JSON.stringify(result.rows, null, 2)}\n`);
                        }
                    } else {
                        // bash command
                        await this.appendTaskLog(taskId, `$ ${action.command}\n\n`);
                        console.log(`   Command: ${action.command}`);
                        result = await this.executeCommand(action.command);
                        await this.appendTaskLog(taskId, result.stdout || '(no output)\n');
                        if (result.stderr) {
                            await this.appendTaskLog(taskId, `STDERR: ${result.stderr}\n`);
                        }
                    }

                    console.log(`   ✅ Success`);
                } catch (error) {
                    const errorMsg = `❌ Action failed: ${error.message}\n`;
                    await this.appendTaskLog(taskId, errorMsg);
                    console.error(`   ${errorMsg}`);

                    if (action.critical) {
                        throw error;
                    }
                }
            }

            await this.appendTaskLog(taskId, `\n=== Task Completed Successfully ===\n`);

        } catch (error) {
            const errorMsg = `\n=== Task Failed ===\n${error.message}\n`;
            await this.appendTaskLog(taskId, errorMsg);
            throw error;
        }
    }

    /**
     * Generate execution plan using Claude AI
     * Supports two action types:
     *   - postgres_sql: { type, query, params, description, critical }
     *   - bash: { type, command, description, critical }
     */
    async generateExecutionPlan(instructions, categoryLocation) {
        const systemPrompt = `You are an intelligent task executor for the JubileeVerse content management system.

Project context:
- Working directory: C:\\Websites\\jubileeverse.com
- PostgreSQL database: stores all data (jv_pulse_tasks, jv_newsletter_subscribers, categories, articles, etc.)

PostgreSQL Schema:
- categories: id (serial PK), name (text), slug (text), parent_id (integer, nullable), level (integer), description (text)
- articles: id, title, content, category_id, source, published_at, etc.
- jv_pulse_tasks: id, title, instructions, status, output_log, etc.

Available action types:
1. "postgres_sql" - Execute a PostgreSQL query directly (preferred for any database work)
   {"type": "postgres_sql", "query": "UPDATE categories SET name=$1, slug=$2 WHERE name=$3", "params": ["New Name", "new-slug", "Old Name"], "description": "Rename category", "critical": true}
2. "bash" - Run a bash shell command (use for file operations only)
   {"type": "bash", "command": "echo 'done'", "description": "Log completion", "critical": false}

Rules:
- ALWAYS use "postgres_sql" for any database read/write operations (SELECT, UPDATE, INSERT, DELETE)
- For category renames: UPDATE categories SET name=$1, slug=$2 WHERE name ILIKE $3
- Slugs are lowercase with hyphens: "Let's Celebrate" → "lets-celebrate"
- Use parameterized queries ($1, $2, ...) for safety
- Use ILIKE for case-insensitive matching when searching by name
- Return ONLY the JSON array, no other text or markdown

Example for "rename category X to Y":
[
  {"type": "postgres_sql", "query": "UPDATE categories SET name=$1, slug=$2 WHERE name ILIKE $3 RETURNING id, name, slug", "params": ["Let's Celebrate", "lets-celebrate", "Dream Big"], "description": "Rename category from Dream Big to Let's Celebrate", "critical": true}
]`;

        try {
            const response = await this.anthropic.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 2048,
                system: systemPrompt,
                messages: [{
                    role: 'user',
                    content: `Task instructions: ${instructions}\n\nGenerate the action execution plan as a JSON array.`
                }]
            });

            const content = response.content[0].text.trim();

            // Extract JSON from response (handle markdown code blocks)
            let jsonText = content;
            const jsonMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
            if (jsonMatch) {
                jsonText = jsonMatch[1];
            } else if (content.startsWith('[')) {
                jsonText = content;
            }

            const actions = JSON.parse(jsonText);

            if (!Array.isArray(actions)) {
                throw new Error('Invalid response format from AI');
            }

            return actions;

        } catch (error) {
            console.error('Error generating execution plan:', error);

            // Fallback: log the task
            return [{
                type: 'bash',
                command: `echo "Task could not be planned: ${instructions.replace(/"/g, '\\"')}"`,
                description: 'Log task failure to plan',
                critical: false
            }];
        }
    }

    /**
     * Execute a PostgreSQL query directly
     */
    async executePostgresQuery(query, params) {
        if (!this.pgPool) {
            throw new Error('PostgreSQL pool not available. Ensure taskExecutor.pgPool is set in server.js.');
        }
        console.log(`   SQL: ${query}`);
        console.log(`   Params: ${JSON.stringify(params)}`);
        const result = await this.pgPool.query(query, params);
        return result;
    }

    /**
     * Execute a single bash command
     */
    async executeCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, {
                cwd: this.projectRoot,
                shell: 'bash',
                timeout: 300000, // 5 minute timeout
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({ stdout, stderr });
                }
            });
        });
    }

    /**
     * Update task status in database
     */
    async updateTaskStatus(taskId, status, message) {
        try {
            if (status === 'in-progress') {
                await this.pgPool.query(
                    `UPDATE jv_pulse_tasks SET status=$1, started_at=NOW(), updated_at=NOW() WHERE id=$2`,
                    [status, taskId]
                );
            } else if (status === 'completed') {
                await this.pgPool.query(
                    `UPDATE jv_pulse_tasks SET status=$1, completed_at=NOW(), updated_at=NOW() WHERE id=$2`,
                    [status, taskId]
                );
            } else if (status === 'failed') {
                await this.pgPool.query(
                    `UPDATE jv_pulse_tasks SET status=$1, error_message=$2, updated_at=NOW() WHERE id=$3`,
                    [status, message, taskId]
                );
            } else {
                await this.pgPool.query(
                    `UPDATE jv_pulse_tasks SET status=$1, updated_at=NOW() WHERE id=$2`,
                    [status, taskId]
                );
            }

            console.log(`\n📊 Status updated: ${status}`);
            if (message) {
                console.log(`   Message: ${message}`);
            }

        } catch (error) {
            console.error(`Error updating task status:`, error);
        }
    }

    /**
     * Append to task log
     */
    async appendTaskLog(taskId, logEntry) {
        try {
            const timestamp = new Date().toISOString();
            await this.pgPool.query(
                `UPDATE jv_pulse_tasks SET output_log = COALESCE(output_log, '') || $1, updated_at=NOW() WHERE id=$2`,
                [`[${timestamp}] ${logEntry}`, taskId]
            );
        } catch (error) {
            console.error(`Error appending task log:`, error);
        }
    }

    /**
     * Get task status
     */
    async getTaskStatus(taskId) {
        const result = await this.pgPool.query('SELECT * FROM jv_pulse_tasks WHERE id = $1', [taskId]);
        const task = result.rows[0];
        const isActive = this.activeTasks.has(taskId);

        return {
            ...task,
            is_active: isActive,
            active_iteration: isActive ? this.activeTasks.get(taskId).iteration : null
        };
    }
}

module.exports = TaskExecutor;
