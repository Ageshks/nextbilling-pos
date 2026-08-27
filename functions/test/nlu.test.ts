import { describe, it, expect } from 'vitest'
import {
  parseQuantityPhrase,
  detectIntent,
  normPhone,
  stripPriceNoise,
} from '../src/nlu'

describe('parseQuantityPhrase', () => {
  it('parses natural multi-item sentences', () => {
    const items = parseQuantityPhrase('I want 2 milk and 3 breads')
    expect(items).toEqual([
      { quantity: 2, text: 'milk' },
      { quantity: 3, text: 'breads' },
    ])
  })

  it('keeps product names intact after quantities ("packets of")', () => {
    const items = parseQuantityPhrase('2 packets of Aashirvaad atta')
    expect(items).toEqual([{ quantity: 2, unit: 'packet', text: 'aashirvaad atta' }])
  })

  it('never eats the product into the unit slot', () => {
    // Regression: "2 milk" used to capture unit="mil", text="k".
    expect(parseQuantityPhrase('2 milk')).toEqual([{ quantity: 2, text: 'milk' }])
    expect(parseQuantityPhrase('3 breads')).toEqual([{ quantity: 3, text: 'breads' }])
  })

  it('handles "Add N <product>" style requests', () => {
    expect(parseQuantityPhrase('5 Coca Cola 1L')).toEqual([
      { quantity: 5, text: 'coca cola 1l' },
    ])
  })

  it('supports glued units, word numbers and x-N/trailing forms', () => {
    expect(parseQuantityPhrase('2kg rice')).toEqual([{ quantity: 2, unit: 'kg', text: 'rice' }])
    expect(parseQuantityPhrase('two kg rice')).toEqual([{ quantity: 2, unit: 'kg', text: 'rice' }])
    expect(parseQuantityPhrase('milk x 10')).toEqual([{ quantity: 10, text: 'milk' }])
    expect(parseQuantityPhrase('bread × 2')).toEqual([{ quantity: 2, text: 'bread' }])
    expect(parseQuantityPhrase('bread 2')).toEqual([{ quantity: 2, text: 'bread' }])
  })

  it('strips conversational fillers without touching quantities', () => {
    expect(parseQuantityPhrase('can i get 4 eggs please')).toEqual([
      { quantity: 4, text: 'eggs please' },
    ])
    expect(parseQuantityPhrase('give me some sugar')).toEqual([{ quantity: 1, text: 'sugar' }])
  })

  it('returns [] for empty / pure-number noise', () => {
    expect(parseQuantityPhrase('')).toEqual([])
    expect(parseQuantityPhrase('   ')).toEqual([])
  })
})

describe('detectIntent', () => {
  it('routes greetings and menu numbers', () => {
    expect(detectIntent('Hi')).toBe('GREETING')
    expect(detectIntent('Namaste')).toBe('GREETING')
    expect(detectIntent('1')).toBe('MENU_1_ORDER')
    expect(detectIntent('2️⃣')).toBe('MENU_2_TRACK')
    expect(detectIntent('4')).toBe('MENU_4_CONTACT')
  })

  it('distinguishes cart view, checkout, tracking', () => {
    expect(detectIntent('What do I have in my cart?')).toBe('VIEW_CART')
    expect(detectIntent('I want to checkout')).toBe('CHECKOUT')
    expect(detectIntent('Where is my order?')).toBe('TRACK')
    expect(detectIntent('ORD-10245')).toBe('TRACK')
  })

  it('stock questions win over generic add, but not over explicit orders', () => {
    expect(detectIntent('Do you have milk?')).toBe('STOCK_QUERY')
    expect(detectIntent('is basmati rice available?')).toBe('STOCK_QUERY')
    expect(detectIntent('Add 2 milk')).toBe('ADD_ITEMS')
    expect(detectIntent('I want 2 milk and 3 breads')).toBe('ADD_ITEMS')
  })

  it('price queries are detected and stripped for catalog lookup', () => {
    expect(detectIntent('What is the price of rice?')).toBe('PRICE_QUERY')
    expect(detectIntent('how much is 1kg sugar?')).toBe('PRICE_QUERY')
    expect(stripPriceNoise('how much is 1kg sugar?')).toBe('sugar')
    expect(stripPriceNoise('price of bread')).toBe('bread')
  })

  it('remove / confirm / yes-no / cancel', () => {
    expect(detectIntent('Remove one milk')).toBe('REMOVE_ITEM')
    expect(detectIntent('confirm my order')).toBe('CONFIRM')
    expect(detectIntent('Yes')).toBe('YES')
    expect(detectIntent('Nope')).toBe('NO')
    expect(detectIntent('cancel it')).toBe('CANCEL')
  })
})

describe('normPhone', () => {
  it('reduces any format to digits', () => {
    expect(normPhone('+91 98765 43210')).toBe('919876543210')
    expect(normPhone('WhatsApp:+1 (555) 010-2030')).toBe('15550102030')
  })
})
