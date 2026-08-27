import { describe, it, expect } from 'vitest'
import {
  canTransition,
  assertTransition,
  reservationDeltas,
  type WaStatus,
} from '../src/stateMachine'

describe('order state machine (server-side authority)', () => {
  const HAPPY_PATH: Array<[WaStatus, WaStatus]> = [
    ['PENDING', 'AWAITING_PAYMENT'],
    ['AWAITING_PAYMENT', 'PAID'],
    ['PAID', 'PACKING'],
    ['PACKING', 'READY_FOR_PICKUP'],
    ['READY_FOR_PICKUP', 'COMPLETED'],
  ]

  it.each(HAPPY_PATH)('%s → %s is allowed', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it('refunds only from cancelled orders', () => {
    expect(canTransition('CANCELLED', 'REFUNDED')).toBe(true)
    expect(canTransition('PAID', 'REFUNDED')).toBe(false)
    expect(canTransition('COMPLETED', 'REFUNDED')).toBe(false)
  })

  it.each<[WaStatus, WaStatus]>([
    ['PENDING', 'PAID'], // must go through payment link state
    ['AWAITING_PAYMENT', 'PACKING'],
    ['AWAITING_PAYMENT', 'READY_FOR_PICKUP'],
    ['PACKING', 'COMPLETED'],
    ['EXPIRED', 'PAID'],
    ['COMPLETED', 'CANCELLED'],
    ['CANCELLED', 'PAID'],
    ['REFUNDED', 'PACKING'],
  ])('%s → %s is rejected', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })

  it('assertTransition throws on illegal edges', () => {
    expect(() => assertTransition('PENDING', 'COMPLETED')).toThrow(/Illegal transition/)
    expect(() => assertTransition('PAID', 'PACKING')).not.toThrow()
  })
})

describe('inventory reservation arithmetic', () => {
  it('RESERVE holds stock without touching it', () => {
    expect(reservationDeltas('RESERVE', 5)).toEqual({ stockDelta: 0, reservedDelta: 5 })
  })

  it('RELEASE gives reserved units back (cancel/expiry)', () => {
    expect(reservationDeltas('RELEASE', 5)).toEqual({ stockDelta: 0, reservedDelta: -5 })
  })

  it('CONSUME decrements stock AND reservation at pickup', () => {
    expect(reservationDeltas('CONSUME', 3)).toEqual({ stockDelta: -3, reservedDelta: -3 })
    expect(reservationDeltas('SELL_THROUGH', 3)).toEqual({ stockDelta: -3, reservedDelta: -3 })
  })

  it('clamps negative/odd quantities safely', () => {
    expect(reservationDeltas('RESERVE', -3)).toEqual({ stockDelta: 0, reservedDelta: 0 })
    expect(reservationDeltas('CONSUME', 2.7)).toEqual({ stockDelta: -3, reservedDelta: -3 })
  })
})
