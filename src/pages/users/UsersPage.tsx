import { useCallback, useEffect, useState } from 'react'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth'
import { Plus, Pencil } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader, DataTable } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Modal } from '../../components/ui/Modal'
import { Badge, statusTone } from '../../components/ui/Badge'
import { Spinner, EmptyState } from '../../components/ui/Spinner'
import { listUsers, createUser, updateUser } from '../../services/userService'
import { logAudit } from '../../services/auditService'
import { getFirebaseEnv } from '../../firebase/config'
import { friendlyError } from '../../utils/errors'
import { required, isEmail, type FieldErrors } from '../../utils/validation'
import { ROLES } from '../../types'
import type { AppUser, Role } from '../../types'

interface FormState {
  uid?: string
  name: string
  email: string
  password: string
  role: Role
  phone: string
  status: 'active' | 'inactive'
}

const EMPTY_FORM: FormState = { name: '', email: '', password: '', role: 'CASHIER', phone: '', status: 'active' }

/**
 * Creates the Firebase Auth account on a temporary secondary app so the signed-in
 * owner's session stays untouched. The temporary app is deleted immediately after.
 */
async function createAuthAccount(email: string, password: string): Promise<string> {
  const temp: FirebaseApp = initializeApp(getFirebaseEnv(), `staff-${Date.now()}`)
  try {
    const secondaryAuth = getAuth(temp)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password)
    await fbSignOut(secondaryAuth).catch(() => {})
    return cred.user.uid
  } finally {
    void deleteApp(temp).catch(() => {})
  }
}

export default function UsersPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify, success, error: toastError } = useToast()

  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      setUsers(await listUsers(user.storeId))
    } catch (err) {
      notify({ type: 'error', message: friendlyError(err), title: 'Could not load users' })
    } finally {
      setLoading(false)
    }
  }, [user, notify])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setErrors({})
    setFormOpen(true)
  }

  const openEdit = (u: AppUser) => {
    setForm({ uid: u.uid, name: u.name, email: u.email, password: '', role: u.role, phone: u.phone, status: u.status })
    setErrors({})
    setFormOpen(true)
  }

  const validate = (f: FormState): FieldErrors => {
    const errs: FieldErrors = {}
    const name = required(f.name, 'Name')
    if (name) errs.name = name
    const emailErr = isEmail(f.email) || required(f.email, 'Email')
    if (emailErr) errs.email = emailErr
    if (!f.uid && f.password.length < 6) errs.password = 'Temporary password must be at least 6 characters'
    return errs
  }

  const submitForm = async () => {
    if (!user || !settings?.storeId) return
    const errs = validate(form)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSaving(true)
    try {
      if (form.uid) {
        await updateUser(form.uid, { name: form.name, role: form.role, phone: form.phone, status: form.status }, user.uid)
        await logAudit({
          storeId: settings.storeId,
          userId: user.uid,
          userName: user.name,
          action: 'USER_UPDATED',
          entityType: 'user',
          entityId: form.uid,
          metadata: { role: form.role, status: form.status },
        })
        success(`${form.name} updated`, 'User saved')
      } else {
        const uid = await createAuthAccount(form.email, form.password)
        await createUser(uid, { storeId: settings.storeId, name: form.name, email: form.email.trim(), role: form.role, phone: form.phone }, user.uid)
        await logAudit({
          storeId: settings.storeId,
          userId: user.uid,
          userName: user.name,
          action: 'USER_CREATED',
          entityType: 'user',
          entityId: uid,
          metadata: { email: form.email, role: form.role },
        })
        success(`${form.name} can now sign in with the temporary password`, 'User created')
      }
      setFormOpen(false)
      void load()
    } catch (err) {
      toastError(friendlyError(err), 'Could not save user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        description={`${users.length} team members`}
        actions={
          <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            Add user
          </Button>
        }
      />

      {loading ? (
        <Spinner label="Loading users…" />
      ) : (
        <DataTable<AppUser>
          rowKey={(u) => u.uid}
          rows={users}
          emptyState={<EmptyState title="No users yet" message="Add cashiers and managers with role-based access." />}
          columns={[
            {
              key: 'name',
              header: 'User',
              render: (u) => (
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    {(u.name || 'U').charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{u.email}</p>
                  </div>
                </div>
              ),
            },
            { key: 'role', header: 'Role', render: (u) => <Badge tone={u.role === 'OWNER' ? 'violet' : 'sky'}>{u.role}</Badge> },
            { key: 'phone', header: 'Phone', render: (u) => u.phone || '—' },
            { key: 'status', header: 'Status', render: (u) => <Badge tone={statusTone(u.status)}>{u.status}</Badge> },
            {
              key: 'actions',
              header: '',
              render: (u) => (
                <div className="flex justify-end">
                  <Button size="xs" variant="ghost" leftIcon={<Pencil className="h-3 w-3" />} onClick={() => openEdit(u)}>
                    Edit
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.uid ? 'Edit user' : 'Add user'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={submitForm}>{form.uid ? 'Save changes' : 'Create user'}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} autoFocus />
          <Input label="Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} type="email" disabled={Boolean(form.uid)} hint={form.uid ? 'Email cannot be changed here' : undefined} />
          {!form.uid && (
            <Input
              label="Temporary password *"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              error={errors.password}
              type="text"
              hint="Share privately; the user should change it later"
            />
          )}
          <Select
            label="Role *"
            value={form.role}
            onChange={(e) => {
              const role = e.target.value as Role
              const perms = ROLES[role]
              setForm({
                ...form,
                role,
                status: !perms?.pos && form.status === 'active' ? 'inactive' : form.status,
              })
            }}
          >
            {(Object.keys(ROLES) as Role[]).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-700/40 dark:text-slate-400">
          Roles map to fixed permission sets — e.g. CASHIER gets POS + sales + customers, INVENTORY gets products/purchases/suppliers, ADMIN everything except user management.
        </p>
      </Modal>
    </div>
  )
}