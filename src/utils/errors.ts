const known = new Map<RegExp, string>([
  [/permission-denied/i, "You don't have permission to perform this action."],
  [/not-found|no document|no-document/i, 'The requested record could not be found.'],
  [/already-exists/i, 'A record with this value already exists.'],
  [/unavailable|offline|network/i, 'The network is not available right now. Your data is saved locally and will sync when you are back online.'],
  [/invalid-argument/i, 'The request was invalid. Please check the values you entered.'],
  [/unauthenticated|auth\/.*: (invalid-credential|wrong-password|user-not-found|invalid-login-credentials)/i, 'Incorrect email or password.'],
  [/auth\/user-not-found|auth\/wrong-password|auth\/invalid-credential|auth\/invalid-login-credentials/i, 'Incorrect email or password.'],
  [/auth\/too-many-requests|quota/i, 'Too many attempts. Please wait a moment and try again.'],
  [/auth\/email-already-in-use/i, 'This email is already registered.'],
  [/auth\/invalid-email/i, 'The email address is not valid.'],
  [/auth\/weak-password/i, 'Password must be at least 6 characters.'],
  [/auth\/network-request-failed/i, 'Network error. Check your connection and try again.'],
  [/auth\/user-disabled/i, 'This account has been disabled. Contact the store owner.'],
  [/auth\/operation-not-allowed/i, 'This sign-in method is not enabled in Firebase.'],
  [/deadline-exceeded|aborted/i, 'The operation timed out. Please try again.'],
])

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  for (const [pattern, text] of known.entries()) {
    if (pattern.test(message)) return text
  }
  // Fallback: do not surface raw Firebase internals to normal users.
  if (/firebase|firestore/i.test(message)) {
    return 'Something went wrong. Please try again.'
  }
  return message || 'Something went wrong. Please try again.'
}

export function isOfflineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /unavailable|offline|network/i.test(message)
}