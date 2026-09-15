import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { getInputAdvancedParamChangeCount, getParamDisplayValue } from './inputParamsPanel'

describe('inputParamsPanel', () => {
  it('counts advanced changes against the mode defaults', () => {
    expect(getInputAdvancedParamChangeCount(DEFAULT_PARAMS, 'gallery')).toBe(0)
    expect(getInputAdvancedParamChangeCount({
      ...DEFAULT_PARAMS,
      quality: 'high',
      n: 3,
      transparent_output: true,
    }, 'gallery')).toBe(3)
    expect(getInputAdvancedParamChangeCount({
      ...DEFAULT_PARAMS,
      quality: 'high',
      n: 3,
      transparent_output: true,
    }, 'agent')).toBe(2)
  })

  it('returns Chinese labels for parameter values', () => {
    expect(getParamDisplayValue('auto')).toBe('自动')
    expect(getParamDisplayValue('high')).toBe('高')
    expect(getParamDisplayValue(true)).toBe('开启')
    expect(getParamDisplayValue(false)).toBe('关闭')
    expect(getParamDisplayValue(null)).toBe('默认')
  })
})
