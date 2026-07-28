'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { CreateTaskResponse, NewTaskPayload } from './types';
import styles from '@/app/(admin)/admin/dashboard.module.css';

/**
 * "Create New Task" modal — ported from dashboard.html's newTaskModal /
 * submitNewTask. Builds a delivery payload (one-time vs recurring) and POSTs to
 * /api/pulse-tasks, then (on success) starts the task heartbeat.
 */

type DeliveryType = 'one-time' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

const DAYS = [
  { v: 0, l: 'Sun' },
  { v: 1, l: 'Mon' },
  { v: 2, l: 'Tue' },
  { v: 3, l: 'Wed' },
  { v: 4, l: 'Thu' },
  { v: 5, l: 'Fri' },
  { v: 6, l: 'Sat' },
];

const FREQ_UNIT: Record<Exclude<DeliveryType, 'one-time'>, string> = {
  hourly: 'hours',
  daily: 'days',
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
  custom: 'days',
};

interface NewTaskModalProps {
  categoryLocation: string;
  onClose: () => void;
  /** Called after a task is created so the parent can refresh + start heartbeat. */
  onCreated: (taskId: number | string | undefined) => void;
  onToast: (msg: string, type: 'success' | 'error') => void;
}

export default function NewTaskModal({
  categoryLocation,
  onClose,
  onCreated,
  onToast,
}: NewTaskModalProps) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('one-time');
  const [scheduleForLater, setScheduleForLater] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [startDateTime, setStartDateTime] = useState('');
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDateTime, setEndDateTime] = useState('');
  const [interval, setIntervalValue] = useState(1);
  const [frequencyUnit, setFrequencyUnit] = useState('days');
  const [days, setDays] = useState<Set<number>>(new Set());
  const [execTimes, setExecTimes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const isOneTime = deliveryType === 'one-time';
  const isWeekly = deliveryType === 'weekly' || deliveryType === 'custom';

  const onDeliveryChange = (val: DeliveryType) => {
    setDeliveryType(val);
    if (val !== 'one-time') setFrequencyUnit(FREQ_UNIT[val]);
  };

  const toggleDay = (d: number) => {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      onToast('Please enter a task title', 'error');
      return;
    }
    if (!instructions.trim()) {
      onToast('Please enter task instructions', 'error');
      return;
    }

    const payload: NewTaskPayload = {
      title,
      instructions,
      category_location: categoryLocation,
      status: 'pending',
      user: 'Admin User',
      delivery_type: deliveryType,
      immediate_execution: 1,
    };

    if (isOneTime) {
      if (scheduleForLater) {
        payload.immediate_execution = 0;
        payload.start_date = scheduledDateTime;
      }
    } else {
      payload.immediate_execution = 0;
      payload.start_date = startDateTime;
      payload.interval_value = interval;
      payload.frequency_type = frequencyUnit;
      if (hasEndDate) payload.end_date = endDateTime;
      if (isWeekly && days.size > 0) payload.days_of_week = [...days];
      const times = execTimes.filter(Boolean);
      if (times.length > 0) payload.execution_times = times;
    }

    setSubmitting(true);
    try {
      const result = await api.post<CreateTaskResponse>('/api/pulse-tasks', payload);
      onToast('Task created successfully! Heartbeat will begin execution.', 'success');
      onCreated(result.task_id);
      onClose();
    } catch {
      onToast('Error creating task. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modal} onClick={onClose}>
      <div
        className={`${styles.modalContent} ${styles.modalContentNarrow}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2>Create New Task</h2>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <form onSubmit={submit}>
            <div className={styles.formGroup}>
              <label>Category Location</label>
              <input className={styles.formInput} value={categoryLocation} readOnly />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="taskTitle">Task Title</label>
              <input
                id="taskTitle"
                className={styles.formInput}
                placeholder="Enter a descriptive title for this task..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="taskInstructions">Task Instructions</label>
              <textarea
                id="taskInstructions"
                className={styles.formTextarea}
                rows={6}
                placeholder="Enter your task instructions here..."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="deliveryType">Delivery</label>
              <select
                id="deliveryType"
                className={styles.formInput}
                value={deliveryType}
                onChange={(e) => onDeliveryChange(e.target.value as DeliveryType)}
              >
                <option value="one-time">One-Time (Immediate)</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="custom">Custom Recurring</option>
              </select>
            </div>

            {isOneTime ? (
              <div className={styles.deliveryOptions}>
                <div className={styles.formGroup}>
                  <label className={styles.inlineLabel}>
                    <input
                      type="checkbox"
                      checked={scheduleForLater}
                      onChange={(e) => setScheduleForLater(e.target.checked)}
                    />
                    Schedule for a specific date/time
                  </label>
                </div>
                {scheduleForLater ? (
                  <div className={styles.formGroup}>
                    <label htmlFor="scheduledDateTime">Date &amp; Time</label>
                    <input
                      id="scheduledDateTime"
                      type="datetime-local"
                      className={styles.formInput}
                      value={scheduledDateTime}
                      onChange={(e) => setScheduledDateTime(e.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.deliveryOptions}>
                <div className={styles.formGroup}>
                  <label htmlFor="startDateTime">Start Date &amp; Time</label>
                  <input
                    id="startDateTime"
                    type="datetime-local"
                    className={styles.formInput}
                    value={startDateTime}
                    onChange={(e) => setStartDateTime(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.inlineLabel}>
                    <input
                      type="checkbox"
                      checked={hasEndDate}
                      onChange={(e) => setHasEndDate(e.target.checked)}
                    />
                    Set end date
                  </label>
                </div>
                {hasEndDate ? (
                  <div className={styles.formGroup}>
                    <label htmlFor="endDateTime">End Date &amp; Time</label>
                    <input
                      id="endDateTime"
                      type="datetime-local"
                      className={styles.formInput}
                      value={endDateTime}
                      onChange={(e) => setEndDateTime(e.target.value)}
                    />
                  </div>
                ) : null}

                <div className={styles.formGroup}>
                  <label htmlFor="frequencyInterval">Repeat every</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      id="frequencyInterval"
                      type="number"
                      min={1}
                      className={styles.formInput}
                      style={{ width: 80 }}
                      value={interval}
                      onChange={(e) => setIntervalValue(parseInt(e.target.value, 10) || 1)}
                    />
                    <select
                      className={styles.formInput}
                      style={{ flex: 1 }}
                      value={frequencyUnit}
                      onChange={(e) => setFrequencyUnit(e.target.value)}
                    >
                      <option value="hours">Hour(s)</option>
                      <option value="days">Day(s)</option>
                      <option value="weeks">Week(s)</option>
                      <option value="months">Month(s)</option>
                      <option value="years">Year(s)</option>
                    </select>
                  </div>
                </div>

                {isWeekly ? (
                  <div className={styles.formGroup}>
                    <label>Days of the Week</label>
                    <div className={styles.daysSelector}>
                      {DAYS.map((d) => (
                        <label key={d.v}>
                          <input
                            type="checkbox"
                            checked={days.has(d.v)}
                            onChange={() => toggleDay(d.v)}
                          />{' '}
                          {d.l}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className={styles.formGroup}>
                  <label>Execution Times (optional - leave empty for once per interval)</label>
                  {execTimes.map((t, i) => (
                    <div key={i} className={styles.executionTimeItem}>
                      <input
                        type="time"
                        className={styles.formInput}
                        value={t}
                        onChange={(e) =>
                          setExecTimes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                        }
                      />
                      <button
                        type="button"
                        className={styles.btnRemove}
                        onClick={() => setExecTimes((prev) => prev.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    style={{ marginTop: 5 }}
                    onClick={() => setExecTimes((prev) => [...prev, ''])}
                  >
                    + Add Time
                  </button>
                </div>
              </div>
            )}

            <div className={styles.formActions}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={styles.btnPrimary} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Task'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
