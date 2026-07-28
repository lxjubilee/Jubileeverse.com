/**
 * TaskPanel.tsx — Phase 5 task assignment panel
 */
import * as React from 'react'
import { CheckSquare, Square, Plus, X, Loader2 } from 'lucide-react'
import { useContentTasks, useCreateTask, useUpdateTask, useDeleteTask } from '../../hooks/useTasks'
import type { TaskStatus } from '../../types/content-objects'

interface TaskPanelProps {
  objectId: string
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Done',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
}

export function TaskPanel({ objectId }: TaskPanelProps) {
  const { data: tasks = [], isLoading } = useContentTasks(objectId)
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  const [showForm, setShowForm] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [assignee, setAssignee] = React.useState('')
  const [description, setDescription] = React.useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !assignee.trim()) return
    createTask.mutate(
      { objectId, data: { title: title.trim(), assignee_id: assignee.trim(), description: description.trim() || undefined } },
      {
        onSuccess: () => {
          setTitle('')
          setAssignee('')
          setDescription('')
          setShowForm(false)
        },
      }
    )
  }

  function toggleComplete(id: number, currentStatus: TaskStatus) {
    const next: TaskStatus = currentStatus === 'completed' ? 'open' : 'completed'
    updateTask.mutate({ id, objectId, data: { status: next } })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 size={14} className="animate-spin mr-1.5" />
        <span className="text-xs">Loading tasks…</span>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {tasks.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground text-center py-4">No tasks assigned.</p>
      )}

      {tasks.map(task => (
        <div key={task.id} className="flex items-start gap-2 px-1 py-1.5 rounded hover:bg-muted/50 group">
          <button
            onClick={() => toggleComplete(task.id, task.status)}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            disabled={updateTask.isPending}
          >
            {task.status === 'completed'
              ? <CheckSquare size={14} className="text-green-600" />
              : <Square size={14} />
            }
          </button>

          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium leading-snug ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
              {task.title}
            </p>
            {task.description && (
              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] bg-muted text-muted-foreground px-1 rounded">
                {task.assignee_id}
              </span>
              <span className={`text-[10px] px-1 rounded ${STATUS_COLORS[task.status]}`}>
                {STATUS_LABEL[task.status]}
              </span>
            </div>
          </div>

          <button
            onClick={() => deleteTask.mutate({ id: task.id, objectId })}
            className="opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-destructive p-0.5 rounded"
            disabled={deleteTask.isPending}
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {showForm ? (
        <form onSubmit={handleSubmit} className="mt-2 border rounded-md p-2.5 space-y-2">
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Task title"
            className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            required
          />
          <input
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            placeholder="Assignee email"
            type="email"
            className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            required
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <div className="flex gap-1.5">
            <button
              type="submit"
              disabled={!title.trim() || !assignee.trim() || createTask.isPending}
              className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
            >
              {createTask.isPending && <Loader2 size={10} className="animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setTitle(''); setAssignee(''); setDescription('') }}
              className="text-xs px-2.5 py-1 rounded hover:bg-muted text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="mt-1 w-full flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-1 py-1.5 rounded hover:bg-muted/50"
        >
          <Plus size={12} />
          Add task
        </button>
      )}
    </div>
  )
}
