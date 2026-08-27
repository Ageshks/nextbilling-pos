import { Keyboard } from 'lucide-react'

interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
}

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const rows = [
    { key: 'F2', action: 'Focus search' },
    { key: 'F4', action: 'Hold bill' },
    { key: 'F6', action: 'Select customer' },
    { key: 'F8', action: 'Open payment' },
    { key: 'F10', action: 'Complete sale' },
    { key: 'ESC', action: 'Cancel held/current line' },
    { key: '↑ / ↓', action: 'Navigate' },
  ]
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${open ? 'pointer-events-auto bg-slate-950/50' : 'pointer-events-none'} `}
      style={{ opacity: open ? 1 : 0, transition: 'opacity 150ms ease' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Keyboard shortcuts</h3>
          <Keyboard className="h-4 w-4 text-slate-400" />
        </div>
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-100 dark:border-slate-700">
                <td className="w-20 py-1.5 font-mono text-xs font-medium text-slate-600 dark:text-slate-300">{r.key}</td>
                <td className="py-1.5 text-slate-700 dark:text-slate-200">{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
