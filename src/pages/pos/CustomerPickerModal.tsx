import { useEffect, useRef, useState } from 'react'
import { Search, User, Plus, Check } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { searchCustomers, createCustomer } from '../../services/customerService'
import { useDebounce } from '../../hooks/useOnlineStatus'
import type { Customer } from '../../types'
import { isWalkIn, walkInCustomer } from '../../services/customerService'

interface CustomerPickerProps {
  open: boolean
  storeId: string
  selectedId: string | null
  onSelect: (customer: { id: string; name: string }) => void
  onClose: () => void
}

export function CustomerPickerModal({ open, storeId, selectedId, onSelect, onClose }: CustomerPickerProps) {
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 250)
  const [results, setResults] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setSearch('')
      setNewName('')
      inputRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || !storeId) return
    const text = debounced.trim()
    if (!text) {
      setResults([walkInCustomer()])
      return
    }
    let cancelled = false
    setLoading(true)
    searchCustomers(storeId, text)
      .then((found) => {
        if (cancelled) return
        const list = [walkInCustomer(), ...found]
        setResults(list)
      })
      .catch(() => {
        if (!cancelled) setResults([walkInCustomer()])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, open, storeId])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const id = await createCustomer(storeId, { name: newName, phone: '', email: '', address: '', notes: '' }, '')
      onSelect({ id, name: newName })
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Select customer" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Input ref={inputRef} placeholder="Search name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
        </div>

        <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Add new</p>
          <div className="flex gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Customer name" />
            <Button variant="outline" size="sm" loading={creating} onClick={handleCreate} disabled={!newName.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Results</p>
          {loading ? (
            <div className="space-y-1.5 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              ))}
            </div>
          ) : (
            <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700">
              {results.map((c) => {
                const selected = selectedId === c.id || (c.id && isWalkIn(c.id) && selectedId === 'walkin')
                return (
                  <li key={c.id ?? 'walkin'}>
                    <button
                      type="button"
                      onClick={() => {
                        if (c.id && isWalkIn(c.id)) {
                          onSelect({ id: 'walkin', name: walkInCustomer().name })
                        } else {
                          onSelect({ id: c.id ?? '', name: c.name })
                        }
                        onClose()
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40"
                    >
                      <User className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{c.name}</p>
                        {c.phone && <p className="text-xs text-slate-500">{c.phone}</p>}
                      </div>
                      {selected && <Check className="h-4 w-4 text-emerald-600" aria-label="selected" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
