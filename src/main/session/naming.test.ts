import { describe, expect, it } from 'vitest'
import { dedupeName, sanitizeTitle, sessionFolderName } from './naming'

describe('sanitizeTitle', () => {
  it('strips filesystem-hostile characters', () => {
    expect(sanitizeTitle('Q3: plan/review <v2>?')).toBe('Q3 plan review v2')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitizeTitle('  weekly   sync  ')).toBe('weekly sync')
  })

  it('falls back when nothing survives', () => {
    expect(sanitizeTitle('???')).toBe('Meeting')
    expect(sanitizeTitle('')).toBe('Meeting')
  })

  it('truncates long titles and drops trailing dots/spaces', () => {
    const long = 'a'.repeat(100)
    expect(sanitizeTitle(long)).toHaveLength(60)
    expect(sanitizeTitle('ends with dots...')).toBe('ends with dots')
  })
})

describe('sessionFolderName', () => {
  it('formats local date + time + title', () => {
    const date = new Date(2026, 9, 30, 9, 5)
    expect(sessionFolderName(date, 'Standup')).toBe('2026-10-30 0905 Standup')
  })
})

describe('dedupeName', () => {
  it('returns the name when free', () => {
    expect(dedupeName('a', () => false)).toBe('a')
  })

  it('appends (2), (3), ... until free', () => {
    const taken = new Set(['a', 'a (2)', 'a (3)'])
    expect(dedupeName('a', (n) => taken.has(n))).toBe('a (4)')
  })
})
