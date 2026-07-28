'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { api } from '@/lib/api';
import type { PulseTask } from './types';
import styles from '@/app/(admin)/admin/dashboard.module.css';

/**
 * Pulse Tasks tab — background task monitor. GET /api/pulse-tasks.
 * Exposes a `reload()` method (via ref) so the page can refresh the table
 * after a task is created from the New Task modal or the chat.
 */

export interface PulseTasksHandle {
  reload: () => void;
}

function formatDelivery(task: PulseTask): string {
  const type = task.delivery_type;
  if (!type || type === 'one-time') {
    return task.start_date ? `One-Time: ${new Date(task.start_date).toLocaleString()}` : 'One-Time (Immediate)';
  }
  const map: Record<string, string> = {
    hourly: 'Hourly',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    yearly: 'Yearly',
    custom: 'Custom',
  };
  let info = map[type] || type;
  if (task.start_date) info += ` from ${new Date(task.start_date).toLocaleDateString()}`;
  return info;
}

function statusClass(status: string): string {
  const key = status.toLowerCase().replace(/[\s-]/g, '');
  if (key === 'pending') return styles.pending;
  if (key === 'inprogress') return styles.inprogress;
  if (key === 'completed') return styles.completed;
  if (key === 'cancelled') return styles.cancelled;
  if (key === 'failed') return styles.failed;
  return '';
}

const PulseTasks = forwardRef<PulseTasksHandle>(function PulseTasks(_props, ref) {
  const [tasks, setTasks] = useState<PulseTask[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await api.get<PulseTask[]>('/api/pulse-tasks');
      setTasks(Array.isArray(data) ? data : []);
      setState('ready');
    } catch {
      setTasks([]);
      setState('error');
    }
  }, []);

  useImperativeHandle(ref, () => ({ reload: () => void load() }), [load]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.pulseTasksContainer}>
      <table className={styles.pulseTasksTable}>
        <thead>
          <tr>
            <th>Task Title</th>
            <th>User</th>
            <th>Delivery</th>
            <th>Status</th>
            <th>Done Date</th>
          </tr>
        </thead>
        <tbody>
          {state === 'loading' ? (
            <tr>
              <td colSpan={5} className={styles.pulseEmpty}>
                Loading tasks…
              </td>
            </tr>
          ) : state === 'error' ? (
            <tr>
              <td colSpan={5} className={`${styles.pulseEmpty} ${styles.errorText}`}>
                Error loading tasks
              </td>
            </tr>
          ) : tasks.length === 0 ? (
            <tr>
              <td colSpan={5} className={styles.pulseEmpty}>
                No tasks found
              </td>
            </tr>
          ) : (
            tasks.map((task, i) => (
              <tr key={task.id ?? task.task_id ?? i}>
                <td>{task.title}</td>
                <td>{task.user || '-'}</td>
                <td>{formatDelivery(task)}</td>
                <td>
                  <span className={`${styles.taskStatus} ${statusClass(task.status)}`}>
                    {task.status}
                  </span>
                </td>
                <td>{task.done_date ? new Date(task.done_date).toLocaleString() : '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
});

export default PulseTasks;
