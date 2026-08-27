"use strict";
// ---------------------------------------------------------------------------
// Server-side configuration. Values come from functions/.env (loaded by the
// Firebase CLI) / Google Secret-style env params. Never referenced from the
// browser bundle.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.cfg = void 0;
exports.isWaConfigured = isWaConfigured;
// ---------------------------------------------------------------------------
// Server-side configuration. Values come from functions/.env (loaded by the
// Firebase CLI) / deployment-time env params. Never referenced from the
// browser bundle.
// ---------------------------------------------------------------------------
function val(name) {
    return process.env[name] ?? '';
}
exports.cfg = {
    // --- WhatsApp Business Platform (Cloud API) -------------------------------
    waAccessToken: () => val('WA_ACCESS_TOKEN'),
    waAppSecret: () => val('WA_APP_SECRET'),
    waVerifyToken: () => val('WA_VERIFY_TOKEN'),
    waPhoneNumberId: () => val('WA_PHONE_NUMBER_ID'),
    graphApiVersion: () => process.env.WA_GRAPH_VERSION || 'v21.0',
    // --- Payments --------------------------------------------------------------
    paymentProvider: () => process.env.PAYMENT_PROVIDER || 'none',
    razorpayKeyId: () => val('RAZORPAY_KEY_ID'),
    razorpayKeySecret: () => val('RAZORPAY_KEY_SECRET'),
    razorpayWebhookSecret: () => val('RAZORPAY_WEBHOOK_SECRET'),
    // --- Optional NLU assist -----------------------------------------------------
    aiGeminiKey: () => val('AI_GEMINI_KEY'),
};
function isWaConfigured() {
    return Boolean(exports.cfg.waAccessToken() && exports.cfg.waAppSecret() && exports.cfg.waVerifyToken());
}
//# sourceMappingURL=config.js.map