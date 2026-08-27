// ---------------------------------------------------------------------------
// Server-side configuration. Values come from functions/.env (loaded by the
// Firebase CLI) / Google Secret-style env params. Never referenced from the
// browser bundle.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Server-side configuration. Values come from functions/.env (loaded by the
// Firebase CLI) / deployment-time env params. Never referenced from the
// browser bundle.
// ---------------------------------------------------------------------------

function val(name: string): string {
  return process.env[name] ?? ''
}

export const cfg = {
  // --- WhatsApp Business Platform (Cloud API) -------------------------------
  waAccessToken: () => val('WA_ACCESS_TOKEN'),
  waAppSecret: () => val('WA_APP_SECRET'),
  waVerifyToken: () => val('WA_VERIFY_TOKEN'),
  waPhoneNumberId: () => val('WA_PHONE_NUMBER_ID'),
  graphApiVersion: (): string => process.env.WA_GRAPH_VERSION || 'v21.0',

  // --- Payments --------------------------------------------------------------
  paymentProvider: (): 'razorpay' | 'none' =>
    (process.env.PAYMENT_PROVIDER as 'razorpay' | 'none') || 'none',
  razorpayKeyId: () => val('RAZORPAY_KEY_ID'),
  razorpayKeySecret: () => val('RAZORPAY_KEY_SECRET'),
  razorpayWebhookSecret: () => val('RAZORPAY_WEBHOOK_SECRET'),

  // --- Optional NLU assist -----------------------------------------------------
  aiGeminiKey: () => val('AI_GEMINI_KEY'),
}

export function isWaConfigured(): boolean {
  return Boolean(cfg.waAccessToken() && cfg.waAppSecret() && cfg.waVerifyToken())
}

