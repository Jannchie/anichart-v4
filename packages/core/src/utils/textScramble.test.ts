import { describe, expect, it } from 'vitest'
import { DEFAULT_SCRAMBLE_CHARS, scrambleText } from './textScramble'

describe('scrambletext', () => {
  it('returns the endpoints at progress 0 and 1', () => {
    expect(scrambleText('GPT-4', 'GPT-4o', 0, 0, 'openai')).toBe('GPT-4')
    expect(scrambleText('GPT-4', 'GPT-4o', 1, 99, 'openai')).toBe('GPT-4o')
    expect(scrambleText('GPT-4', 'GPT-4o', -0.5, 0, 'openai')).toBe('GPT-4')
    expect(scrambleText('GPT-4', 'GPT-4o', 1.5, 0, 'openai')).toBe('GPT-4o')
  })

  it('is a no-op when from equals to', () => {
    for (let p = 0; p <= 1; p += 0.1) {
      expect(scrambleText('Claude', 'Claude', p, Math.round(p * 10), 'anthropic')).toBe('Claude')
    }
  })

  it('is deterministic in (from, to, progress, tick, key)', () => {
    const a = scrambleText('GPT-4', 'Claude 3.5', 0.42, 7, 'k')
    const b = scrambleText('GPT-4', 'Claude 3.5', 0.42, 7, 'k')
    expect(a).toBe(b)
  })

  it('keeps unchanged character positions stable (hamming feel)', () => {
    const from = 'Lee Sedol(33)'
    const to = 'Lee Sedol(34)'
    // 只有下标 11（'3'→'4'）不同；其余位在整个过渡中都应保持目标字符不变。
    for (let p = 0.05; p < 1; p += 0.05) {
      const out = scrambleText(from, to, p, Math.round(p * 36), 'lee')
      expect(out).toHaveLength(to.length)
      for (let i = 0; i < to.length; i += 1) {
        if (i === 11) {
          continue
        }
        expect(out[i]).toBe(to[i])
      }
    }
  })

  it('reveals an appended character via the scramble pool', () => {
    const from = 'GPT-4'
    const to = 'GPT-4o'
    for (let p = 0.05; p < 1; p += 0.05) {
      const out = scrambleText(from, to, p, Math.round(p * 36), 'openai')
      // 共享前缀始终稳定。
      expect(out.slice(0, 5)).toBe('GPT-4')
      // 末位要么还没出现('')、要么扰动字形、要么已定型为 'o'，不会是别的真实字符。
      const tail = out[5] ?? ''
      expect(tail === '' || tail === 'o' || DEFAULT_SCRAMBLE_CHARS.includes(tail)).toBe(true)
    }
  })
})
