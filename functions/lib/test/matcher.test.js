"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const matcher_1 = require("../src/matcher");
const CATALOG = [
    { id: 'p1', name: 'Milk 1L' },
    { id: 'p2', name: 'Bread' },
    { id: 'p3', name: 'Basmati Rice 5kg', sku: 'RICE-BAS-5' },
    { id: 'p4', name: 'Aashirvaad Atta 5kg', barcode: '8901234567890', brandName: 'Aashirvaad' },
];
(0, vitest_1.describe)('matchProduct against the live catalog', () => {
    (0, vitest_1.it)('barcode scan beats everything', () => {
        const r = (0, matcher_1.matchProduct)('8901234567890', CATALOG);
        (0, vitest_1.expect)(r.matchedBy).toBe('BARCODE');
        (0, vitest_1.expect)(r.product?.id).toBe('p4');
        (0, vitest_1.expect)(r.score).toBe(100);
    });
    (0, vitest_1.it)('sku lookup works', () => {
        const r = (0, matcher_1.matchProduct)('RICE-BAS-5', CATALOG);
        (0, vitest_1.expect)(r.matchedBy).toBe('SKU');
        (0, vitest_1.expect)(r.product?.id).toBe('p3');
    });
    (0, vitest_1.it)('exact name is case-insensitive', () => {
        const r = (0, matcher_1.matchProduct)('MILK 1L', CATALOG);
        (0, vitest_1.expect)(r.matchedBy).toBe('EXACT_NAME');
        (0, vitest_1.expect)(r.product?.id).toBe('p1');
    });
    (0, vitest_1.it)('plurals and stems match ("3 breads" → Bread)', () => {
        const r = (0, matcher_1.matchProduct)('breads', CATALOG);
        (0, vitest_1.expect)(r.product?.id).toBe('p2');
        (0, vitest_1.expect)(['NAME_PARTIAL', 'CATEGORY_OR_BRAND']).toContain(r.matchedBy);
        (0, vitest_1.expect)(r.score).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('multi-token names match on subset ("aashirvaad atta")', () => {
        const r = (0, matcher_1.matchProduct)('aashirvaad atta', CATALOG);
        (0, vitest_1.expect)(r.product?.id).toBe('p4');
        (0, vitest_1.expect)(r.matchedBy).toBe('NAME_PARTIAL');
    });
    (0, vitest_1.it)('ties are broken alphabetically for stable UX', () => {
        const juiceCat = [
            { id: 'j1', name: 'Apple Juice' },
            { id: 'j2', name: 'Mango Juice' },
        ];
        const r = (0, matcher_1.matchProduct)('juice', juiceCat);
        (0, vitest_1.expect)(r.product?.id).toBe('j1');
    });
    (0, vitest_1.it)('unknown products return NONE instead of guessing', () => {
        (0, vitest_1.expect)((0, matcher_1.matchProduct)('quantum flux capacitor', CATALOG).matchedBy).toBe('NONE');
        (0, vitest_1.expect)((0, matcher_1.matchProduct)('', CATALOG).matchedBy).toBe('NONE');
        (0, vitest_1.expect)((0, matcher_1.matchProduct)('milk', []).matchedBy).toBe('NONE');
    });
});
//# sourceMappingURL=matcher.test.js.map