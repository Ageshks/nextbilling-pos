"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const nlu_1 = require("../src/nlu");
(0, vitest_1.describe)('parseQuantityPhrase', () => {
    (0, vitest_1.it)('parses natural multi-item sentences', () => {
        const items = (0, nlu_1.parseQuantityPhrase)('I want 2 milk and 3 breads');
        (0, vitest_1.expect)(items).toEqual([
            { quantity: 2, text: 'milk' },
            { quantity: 3, text: 'breads' },
        ]);
    });
    (0, vitest_1.it)('keeps product names intact after quantities ("packets of")', () => {
        const items = (0, nlu_1.parseQuantityPhrase)('2 packets of Aashirvaad atta');
        (0, vitest_1.expect)(items).toEqual([{ quantity: 2, unit: 'packet', text: 'aashirvaad atta' }]);
    });
    (0, vitest_1.it)('never eats the product into the unit slot', () => {
        // Regression: "2 milk" used to capture unit="mil", text="k".
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('2 milk')).toEqual([{ quantity: 2, text: 'milk' }]);
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('3 breads')).toEqual([{ quantity: 3, text: 'breads' }]);
    });
    (0, vitest_1.it)('handles "Add N <product>" style requests', () => {
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('5 Coca Cola 1L')).toEqual([
            { quantity: 5, text: 'coca cola 1l' },
        ]);
    });
    (0, vitest_1.it)('supports glued units, word numbers and x-N/trailing forms', () => {
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('2kg rice')).toEqual([{ quantity: 2, unit: 'kg', text: 'rice' }]);
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('two kg rice')).toEqual([{ quantity: 2, unit: 'kg', text: 'rice' }]);
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('milk x 10')).toEqual([{ quantity: 10, text: 'milk' }]);
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('bread × 2')).toEqual([{ quantity: 2, text: 'bread' }]);
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('bread 2')).toEqual([{ quantity: 2, text: 'bread' }]);
    });
    (0, vitest_1.it)('strips conversational fillers without touching quantities', () => {
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('can i get 4 eggs please')).toEqual([
            { quantity: 4, text: 'eggs please' },
        ]);
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('give me some sugar')).toEqual([{ quantity: 1, text: 'sugar' }]);
    });
    (0, vitest_1.it)('returns [] for empty / pure-number noise', () => {
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('')).toEqual([]);
        (0, vitest_1.expect)((0, nlu_1.parseQuantityPhrase)('   ')).toEqual([]);
    });
});
(0, vitest_1.describe)('detectIntent', () => {
    (0, vitest_1.it)('routes greetings and menu numbers', () => {
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('Hi')).toBe('GREETING');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('Namaste')).toBe('GREETING');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('1')).toBe('MENU_1_ORDER');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('2️⃣')).toBe('MENU_2_TRACK');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('4')).toBe('MENU_4_CONTACT');
    });
    (0, vitest_1.it)('distinguishes cart view, checkout, tracking', () => {
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('What do I have in my cart?')).toBe('VIEW_CART');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('I want to checkout')).toBe('CHECKOUT');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('Where is my order?')).toBe('TRACK');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('ORD-10245')).toBe('TRACK');
    });
    (0, vitest_1.it)('stock questions win over generic add, but not over explicit orders', () => {
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('Do you have milk?')).toBe('STOCK_QUERY');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('is basmati rice available?')).toBe('STOCK_QUERY');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('Add 2 milk')).toBe('ADD_ITEMS');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('I want 2 milk and 3 breads')).toBe('ADD_ITEMS');
    });
    (0, vitest_1.it)('price queries are detected and stripped for catalog lookup', () => {
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('What is the price of rice?')).toBe('PRICE_QUERY');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('how much is 1kg sugar?')).toBe('PRICE_QUERY');
        (0, vitest_1.expect)((0, nlu_1.stripPriceNoise)('how much is 1kg sugar?')).toBe('sugar');
        (0, vitest_1.expect)((0, nlu_1.stripPriceNoise)('price of bread')).toBe('bread');
    });
    (0, vitest_1.it)('remove / confirm / yes-no / cancel', () => {
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('Remove one milk')).toBe('REMOVE_ITEM');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('confirm my order')).toBe('CONFIRM');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('Yes')).toBe('YES');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('Nope')).toBe('NO');
        (0, vitest_1.expect)((0, nlu_1.detectIntent)('cancel it')).toBe('CANCEL');
    });
});
(0, vitest_1.describe)('normPhone', () => {
    (0, vitest_1.it)('reduces any format to digits', () => {
        (0, vitest_1.expect)((0, nlu_1.normPhone)('+91 98765 43210')).toBe('919876543210');
        (0, vitest_1.expect)((0, nlu_1.normPhone)('WhatsApp:+1 (555) 010-2030')).toBe('15550102030');
    });
});
//# sourceMappingURL=nlu.test.js.map