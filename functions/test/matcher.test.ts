import { describe, it, expect } from 'vitest'
import { matchProduct } from '../src/matcher'
import type { MatchCandidate } from '../src/matcher'

const CATALOG: MatchCandidate[] = [
  { id: 'p1', name: 'Milk 1L' },
  { id: 'p2', name: 'Bread' },
  { id: 'p3', name: 'Basmati Rice 5kg', sku: 'RICE-BAS-5' },
  { id: 'p4', name: 'Aashirvaad Atta 5kg', barcode: '8901234567890', brandName: 'Aashirvaad' },
]

describe('matchProduct against the live catalog', () => {
  it('barcode scan beats everything', () => {
    const r = matchProduct('8901234567890', CATALOG)
    expect(r.matchedBy).toBe('BARCODE')
    expect(r.product?.id).toBe('p4')
    expect(r.score).toBe(100)
  })

  it('sku lookup works', () => {
    const r = matchProduct('RICE-BAS-5', CATALOG)
    expect(r.matchedBy).toBe('SKU')
    expect(r.product?.id).toBe('p3')
  })

  it('exact name is case-insensitive', () => {
    const r = matchProduct('MILK 1L', CATALOG)
    expect(r.matchedBy).toBe('EXACT_NAME')
    expect(r.product?.id).toBe('p1')
  })

  it('plurals and stems match ("3 breads" → Bread)', () => {
    const r = matchProduct('breads', CATALOG)
    expect(r.product?.id).toBe('p2')
    expect(['NAME_PARTIAL', 'CATEGORY_OR_BRAND']).toContain(r.matchedBy)
    expect(r.score).toBeGreaterThan(0)
  })

  it('multi-token names match on subset ("aashirvaad atta")', () => {
    const r = matchProduct('aashirvaad atta', CATALOG)
    expect(r.product?.id).toBe('p4')
    expect(r.matchedBy).toBe('NAME_PARTIAL')
  })

  it('ties are broken alphabetically for stable UX', () => {
    const juiceCat = [
      { id: 'j1', name: 'Apple Juice' },
      { id: 'j2', name: 'Mango Juice' },
    ]
    const r = matchProduct('juice', juiceCat)
    expect(r.product?.id).toBe('j1')
  })

  it('unknown products return NONE instead of guessing', () => {
    expect(matchProduct('quantum flux capacitor', CATALOG).matchedBy).toBe('NONE')
    expect(matchProduct('', CATALOG).matchedBy).toBe('NONE')
    expect(matchProduct('milk', []).matchedBy).toBe('NONE')
  })
})
