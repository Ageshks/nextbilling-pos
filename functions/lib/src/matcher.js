"use strict";
// ---------------------------------------------------------------------------
// Product matching against the LIVE catalog (name/sku/barcode/category).
// Pure + deterministic: highest score wins; ties broken alphabetically by name.
// Barcode/sku exact hits beat fuzzy name matches.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchProduct = matchProduct;
/** Light stemmer so plurals match ("breads" → "bread"); keeps digits untouched. */
function stem(w) {
    if (w.length <= 3 || /[0-9]/.test(w))
        return w;
    if (/(ss|us|is)$/.test(w))
        return w;
    return w.replace(/e?s$/, '');
}
function tokens(s) {
    return s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 1)
        .map(stem);
}
function matchProduct(query, products) {
    const q = query.trim().toLowerCase();
    if (!q || products.length === 0)
        return { product: null, score: 0, matchedBy: 'NONE' };
    // 1) Whole-query exact ids
    const barcode = products.find((p) => p.barcode && p.barcode.toLowerCase() === q);
    if (barcode)
        return { product: barcode, score: 100, matchedBy: 'BARCODE' };
    const sku = products.find((p) => p.sku && p.sku.toLowerCase() === q);
    if (sku)
        return { product: sku, score: 95, matchedBy: 'SKU' };
    // 2) Exact full-name match
    const exact = products.find((p) => p.name.toLowerCase() === q);
    if (exact)
        return { product: exact, score: 90, matchedBy: 'EXACT_NAME' };
    // 3) Token overlap scoring (query ⊆ product info, weighted)
    const qt = tokens(q);
    if (qt.length === 0)
        return { product: null, score: 0, matchedBy: 'NONE' };
    let best = null;
    for (const p of products) {
        const hayName = tokens(`${p.name}`);
        const hayExtra = tokens(`${p.categoryName ?? ''} ${p.brandName ?? ''}`);
        let s = 0;
        let covered = 0;
        for (const tok of qt) {
            if (hayName.includes(tok)) {
                // Longer matching token → stronger signal ("aashirvaad" > "atta").
                s += 20 + Math.min(tok.length * 2, 14);
                covered++;
            }
            else if ([...hayName].some((n) => n.startsWith(tok) && tok.length >= 3)) {
                s += 9;
                covered++;
            }
            else if (hayExtra.includes(tok)) {
                s += 4;
                covered++;
            }
        }
        // Require every query token to appear somewhere; else don't match.
        if (covered < qt.length)
            continue;
        s -= Math.abs(p.name.length - q.length) * 0.05;
        const m = s >= 40 ? 'NAME_PARTIAL' : 'CATEGORY_OR_BRAND';
        if (!best || s > best.s || (s === best.s && p.name < best.p.name))
            best = { p, s, m };
    }
    if (best && best.s >= 12) {
        return { product: best.p, score: Math.round(best.s), matchedBy: best.m };
    }
    return { product: null, score: 0, matchedBy: 'NONE' };
}
//# sourceMappingURL=matcher.js.map