"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const stateMachine_1 = require("../src/stateMachine");
(0, vitest_1.describe)('order state machine (server-side authority)', () => {
    const HAPPY_PATH = [
        ['PENDING', 'AWAITING_PAYMENT'],
        ['AWAITING_PAYMENT', 'PAID'],
        ['PAID', 'PACKING'],
        ['PACKING', 'READY_FOR_PICKUP'],
        ['READY_FOR_PICKUP', 'COMPLETED'],
    ];
    vitest_1.it.each(HAPPY_PATH)('%s → %s is allowed', (from, to) => {
        (0, vitest_1.expect)((0, stateMachine_1.canTransition)(from, to)).toBe(true);
    });
    (0, vitest_1.it)('refunds only from cancelled orders', () => {
        (0, vitest_1.expect)((0, stateMachine_1.canTransition)('CANCELLED', 'REFUNDED')).toBe(true);
        (0, vitest_1.expect)((0, stateMachine_1.canTransition)('PAID', 'REFUNDED')).toBe(false);
        (0, vitest_1.expect)((0, stateMachine_1.canTransition)('COMPLETED', 'REFUNDED')).toBe(false);
    });
    vitest_1.it.each([
        ['PENDING', 'PAID'], // must go through payment link state
        ['AWAITING_PAYMENT', 'PACKING'],
        ['AWAITING_PAYMENT', 'READY_FOR_PICKUP'],
        ['PACKING', 'COMPLETED'],
        ['EXPIRED', 'PAID'],
        ['COMPLETED', 'CANCELLED'],
        ['CANCELLED', 'PAID'],
        ['REFUNDED', 'PACKING'],
    ])('%s → %s is rejected', (from, to) => {
        (0, vitest_1.expect)((0, stateMachine_1.canTransition)(from, to)).toBe(false);
    });
    (0, vitest_1.it)('assertTransition throws on illegal edges', () => {
        (0, vitest_1.expect)(() => (0, stateMachine_1.assertTransition)('PENDING', 'COMPLETED')).toThrow(/Illegal transition/);
        (0, vitest_1.expect)(() => (0, stateMachine_1.assertTransition)('PAID', 'PACKING')).not.toThrow();
    });
});
(0, vitest_1.describe)('inventory reservation arithmetic', () => {
    (0, vitest_1.it)('RESERVE holds stock without touching it', () => {
        (0, vitest_1.expect)((0, stateMachine_1.reservationDeltas)('RESERVE', 5)).toEqual({ stockDelta: 0, reservedDelta: 5 });
    });
    (0, vitest_1.it)('RELEASE gives reserved units back (cancel/expiry)', () => {
        (0, vitest_1.expect)((0, stateMachine_1.reservationDeltas)('RELEASE', 5)).toEqual({ stockDelta: 0, reservedDelta: -5 });
    });
    (0, vitest_1.it)('CONSUME decrements stock AND reservation at pickup', () => {
        (0, vitest_1.expect)((0, stateMachine_1.reservationDeltas)('CONSUME', 3)).toEqual({ stockDelta: -3, reservedDelta: -3 });
        (0, vitest_1.expect)((0, stateMachine_1.reservationDeltas)('SELL_THROUGH', 3)).toEqual({ stockDelta: -3, reservedDelta: -3 });
    });
    (0, vitest_1.it)('clamps negative/odd quantities safely', () => {
        (0, vitest_1.expect)((0, stateMachine_1.reservationDeltas)('RESERVE', -3)).toEqual({ stockDelta: 0, reservedDelta: 0 });
        (0, vitest_1.expect)((0, stateMachine_1.reservationDeltas)('CONSUME', 2.7)).toEqual({ stockDelta: -3, reservedDelta: -3 });
    });
});
//# sourceMappingURL=stateMachine.test.js.map