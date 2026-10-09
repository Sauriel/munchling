import type { Activity, ActivityLog } from '../../shared/domain/activities'
import { useMunchlingData } from './useMunchlingData'
export function useActivities() {
  const service = useMunchlingData()
  const activities = useState<Activity[]>('activities', () => [])
  const activityLogs = useState<ActivityLog[]>('activity-logs', () => [])
  async function refreshActivities() {
    const [templates, logs] = await Promise.all([service.activities.listActivities(), service.activityLogs.listActivityLogs()])
    activities.value = templates; activityLogs.value = logs
  }
  return { activities, activityLogs, refreshActivities, ...service.activities, ...service.activityLogs }
}
