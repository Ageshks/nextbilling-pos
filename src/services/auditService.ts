import { collection, addDoc, getDocs, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore'
import { getDb, COLLECTIONS, unwrapDocs } from '../firebase/firestore'
import type { AuditLog } from '../types'

export interface AuditActionInput {
  storeId: string
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  metadata?: Record<string, string | number | boolean>
}

/** Writes an audit log entry. One small write per audited action. */
export async function logAudit(input: AuditActionInput): Promise<void> {
  try {
    const db = getDb()
    await addDoc(collection(db, COLLECTIONS.auditLogs), {
      storeId: input.storeId,
      userId: input.userId,
      userName: input.userName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    })
  } catch {
    // Never fail the primary operation because audit logging failed.
  }
}

export async function listAuditLogs(
  storeId: string,
  max = 100,
): Promise<AuditLog[]> {
  const db = getDb()
  const q = query(
    collection(db, COLLECTIONS.auditLogs),
    where('storeId', '==', storeId),
    orderBy('timestamp', 'desc'),
    limit(max),
  )
  const snap = await getDocs(q)
  return unwrapDocs<AuditLog>(snap.docs)
}