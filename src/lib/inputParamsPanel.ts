import { DEFAULT_PARAMS, type AppMode, type TaskParams } from '../types'

export function getInputAdvancedParamChangeCount(params: TaskParams, appMode: AppMode) {
  const keys: Array<keyof TaskParams> = [
    'quality',
    'output_format',
    'output_compression',
    'moderation',
    'transparent_output',
  ]
  if (appMode !== 'agent') keys.push('n')
  return keys.filter((key) => params[key] !== DEFAULT_PARAMS[key]).length
}

export function getParamDisplayValue(value: string | number | null | boolean) {
  if (value === 'auto') return '自动'
  if (value === 'low') return '低'
  if (value === 'medium') return '中'
  if (value === 'high') return '高'
  if (value === 'xhigh') return '极高'
  if (value === 'max') return '最高'
  if (value === true) return '开启'
  if (value === false) return '关闭'
  if (value == null || value === '') return '默认'
  return String(value)
}
