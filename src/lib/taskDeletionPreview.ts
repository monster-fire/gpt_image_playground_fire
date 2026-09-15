import type { TaskRecord } from '../types'

export function taskDeletionSignature(tasks: TaskRecord[]) {
  return JSON.stringify(tasks.map((task) => [task.id, task.inputImageIds, task.outputImages, task.maskImageId, task.transparentOriginalImages]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

export function taskDeletionMessage(tasks: TaskRecord[]) {
  const count = new Set(tasks.flatMap((task) => task.outputImages)).size
  return `将从当前浏览器永久删除 ${tasks.length} 个任务，涉及 ${count} 张输出图片。无其他任务、对话或草稿引用的关联原图及缓存将一并删除；服务器数据不受影响。`
}
