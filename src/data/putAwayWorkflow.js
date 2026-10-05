export const PUT_AWAY_STATUSES = {
  WAITING_MOVE: 'WAITING_MOVE',
  WAITING_LIFT: 'WAITING_LIFT',
  LIFTING: 'LIFTING_ACTIVE',
  COMPLETED: 'COMPLETED',
}

export const PUT_AWAY_STATUS_LABELS = {
  [PUT_AWAY_STATUSES.WAITING_MOVE]: 'Chờ di chuyển',
  [PUT_AWAY_STATUSES.WAITING_LIFT]: 'Chờ nâng hạ',
  [PUT_AWAY_STATUSES.LIFTING]: 'Đang nâng hạ',
  [PUT_AWAY_STATUSES.COMPLETED]: 'Hoàn thành',
}

const NEXT_STEPS = {
  WAITING_MOVE: {
    role: 'MOVER',
    next: PUT_AWAY_STATUSES.WAITING_LIFT,
    label: 'Đã chuyển hàng đến vị trí',
  },
  WAITING_LIFT: {
    role: 'LIFTER',
    next: PUT_AWAY_STATUSES.LIFTING,
    label: 'Bắt đầu nâng hạ',
  },
  LIFTING_ACTIVE: {
    role: 'LIFTER',
    next: PUT_AWAY_STATUSES.COMPLETED,
    label: 'Đã nâng hàng lên kệ',
  },
}

export function normalizePutAwayTasks(tasks = []) {
  return tasks.map((task) => ({
    ...task,
    status: task.status === 'MOVING'
      ? PUT_AWAY_STATUSES.WAITING_MOVE
      : task.status === 'LIFTING'
        ? PUT_AWAY_STATUSES.WAITING_LIFT
        : task.status,
    events: (task.events || []).filter(
      (event) => !['Đã nhận việc di chuyển', 'Đã nhận việc nâng hạ'].includes(event.label)
    ),
  }))
}

export function getActivePutAwayTasks(tasks = []) {
  return tasks.filter((task) => task.status !== PUT_AWAY_STATUSES.COMPLETED)
}

export function advancePutAwayTask(task, role, actor, now = new Date()) {
  const step = NEXT_STEPS[task?.status]
  if (!step || step.role !== role) return null

  const timestamp = now.toISOString()
  return {
    ...task,
    status: step.next,
    events: [
      ...(task.events || []),
      {
        status: step.next,
        label: step.label,
        actorName: actor.name || actor.username,
        actorUsername: actor.username,
        occurredAt: timestamp,
      },
    ],
    updatedAt: timestamp,
  }
}
