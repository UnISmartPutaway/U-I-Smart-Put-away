import { normalizePutAwayTasks } from './putAwayWorkflow'
import { supabase } from './supabase'

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function getUserProfile(userId) {
  const { data, error } = await requireSupabase()
    .from('smart_location_users')
    .select('username, display_name, role')
    .eq('user_id', userId)
    .single()

  if (error) throw error
  if (!['ADMIN', 'MOVER', 'LIFTER'].includes(data.role)) {
    throw new Error('Tài khoản chưa được gán vai trò hợp lệ trong Supabase.')
  }

  return {
    username: data.username,
    name: data.display_name,
    role: data.role,
  }
}

export async function loadPutAwaySnapshot() {
  const client = requireSupabase()
  const [taskResult, incidentResult] = await Promise.all([
    client.from('putaway_tasks').select('task').order('created_at'),
    client.from('putaway_incidents').select('incident').order('created_at'),
  ])

  if (taskResult.error) throw taskResult.error
  if (incidentResult.error) throw incidentResult.error

  return {
    tasks: normalizePutAwayTasks(taskResult.data.map(({ task }) => task)),
    incidents: incidentResult.data.map(({ incident }) => incident),
  }
}

export async function createPutAwayTask(task, userId) {
  const { error } = await requireSupabase().from('putaway_tasks').insert({
    id: task.id,
    location_id: task.locationId,
    status: task.status,
    task,
    created_by: userId,
  })
  if (error) throw error
}

export async function advancePutAwayTask(currentTask, nextTask) {
  const { data, error } = await requireSupabase()
    .from('putaway_tasks')
    .update({
      status: nextTask.status,
      task: nextTask,
      updated_at: nextTask.updatedAt,
    })
    .eq('id', currentTask.id)
    .eq('status', currentTask.status)
    .select('id')

  if (error) throw error
  return data.length === 1
}

export async function createPutAwayIncident(incident, userId) {
  const { error } = await requireSupabase().from('putaway_incidents').insert({
    id: incident.id,
    task_id: incident.taskId,
    incident,
    created_by: userId,
  })
  if (error) throw error
}

export function subscribeToPutAwayChanges(onChange, onStatusChange) {
  const channel = requireSupabase()
    .channel('smart-location-putaway')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'putaway_tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'putaway_incidents' }, onChange)
    .subscribe(onStatusChange)

  return () => requireSupabase().removeChannel(channel)
}
