import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles,
  RefreshCw,
  PackageOpen,
  AlertTriangle,
  TrendingUp,
  PackageX,
  ShoppingCart,
  MessageSquareText,
  History,
  ClipboardList,
  ChevronDown,
  Check,
  BellOff,
  Clock,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { useToast } from '../../context/ToastContext'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card, StatCard } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Spinner'
import { Input } from '../../components/ui/Input'
import {
  computeInsights,
  persistInsightRecords,
  storeDailyRollup,
  listInsights,
  updateInsightStatus,
  answerAssistant,
} from '../../services/insightsService'
import { logAudit } from '../../services/auditService'
import { aiPurchasePrefillKey } from '../../types/insight'
import { friendlyError } from '../../utils/errors'
import { formatMoney, formatNumber, formatDateTime } from '../../utils/format'
import type {
  InsightBundle,
  InsightRecord,
  InsightStatus,
  AssistantAnswer,
  Confidence,
  InsightSeverity,
} from '../../types'

type Tab = 'overview' | 'reorder' | 'movement' | 'anomalies' | 'assistant' | 'history'

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'reorder', label: 'Reorder', icon: <ShoppingCart className="h-4 w-4" /> },
  { id: 'movement', label: 'Fast / Slow', icon: <TrendingUp className="h-4 w-4" /> },
  { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle className="h-4 w-4" /> },
  { id: 'assistant', label: 'Assistant', icon: <MessageSquareText className="h-4 w-4" /> },
  { id: 'history', label: 'History', icon: <History className="h-4 w-4" /> },
]

function confidenceBadge(conf: Confidence) {
  const tone = conf === 'high' ? 'emerald' : conf === 'medium' ? 'amber' : 'slate'
  return <Badge tone={tone}>{conf} confidence</Badge>
}
function severityBadge(sev: InsightSeverity) {
  const tone = sev === 'critical' ? 'red' : sev === 'warning' ? 'amber' : 'sky'
  return <Badge tone={tone}>{sev}</Badge>
}
function statusBadge(status: InsightStatus) {
  const tone = status === 'new' ? 'sky' : status === 'reviewed' ? 'amber' : status === 'actioned' ? 'emerald' : 'slate'
  return <Badge tone={tone}>{status}</Badge>
}

function MetricsGrid({ metrics }: { metrics: Record<string, string | number | boolean | null> }) {
  const entries = Object.entries(metrics).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (entries.length === 0) return <p className="text-xs text-slate-400">No supporting metrics recorded.</p>
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1 text-xs dark:border-slate-700">
          <dt className="capitalize text-slate-500 dark:text-slate-400">{k.replace(/([A-Z])/g, ' $1')}</dt>
          <dd className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

const QUICK_CHIPS = [
  'What should I order today?',
  'Which products are selling fastest?',
  'Which products are not moving?',
  'Which products might run out this week?',
  'Show me unusual activity today.',
  'How much inventory is tied up in slow-moving products?',
]

export default function AIInsightsPage() {
  const { user } = useAuth()
  const { settings } = useStore()
  const { notify } = useToast()
  const [bundle, setBundle] = useState<InsightBundle | null>(null)
  const [history, setHistory] = useState<InsightRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'reorder' | 'movement' | 'anomalies' | 'assistant' | 'history'>('overview')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null)
  const [hiddenReorder, setHiddenReorder] = useState<Set<string>>(new Set())

  const load = useCallback(
    async (silent = false) => {
      if (!user) return
      if (!silent) setLoading(true)
      else setRefreshing(true)
      setError(null)
      try {
        const thresholds = {
          leadTimeDays: settings?.aiLeadTimeDays,
          safetyStockDays: settings?.aiSafetyStockDays,
          deadStockDays: settings?.aiDeadStockDays,
          slowMovingDays: settings?.aiSlowMovingDays,
          anomalyMultiplier: settings?.aiAnomalyMultiplier,
        }
        const b = await computeInsights(user.storeId, thresholds)
        setBundle(b)
        setHistory(await listInsights(user.storeId, 40))
        void persistInsightRecords(b, thresholds)
        void storeDailyRollup(b)
        setHiddenReorder(new Set())
      } catch (err) {
        setError(friendlyError(err))
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [user, settings],
  )

  useEffect(() => {
    void load()
  }, [load])

  const onAction = useCallback(
    (type: string, productId: string | null, status: InsightStatus, msg: string) => {
      const rec = history.find((r) => r.type === type && (productId ? r.productId === productId : true))
      if (rec?.id) void updateInsightStatus(rec.id, status)
      if (user) {
        void logAudit({
          storeId: user.storeId,
          userId: user.uid,
          userName: user.name,
          action: `ai_${status}`,
          entityType: 'aiInsight',
          entityId: rec?.id ?? '',
          metadata: { type, productId: productId ?? '' },
        })
      }
      notify({ type: 'success', message: msg, title: 'Insight updated' })
    },
    [history, notify, user],
  )

  const ask = useCallback(
    (q: string) => {
      if (!bundle) return
      const trimmed = q.trim()
      if (!trimmed) return
      setAnswer(answerAssistant(trimmed, bundle))
      setQuestion(trimmed)
    },
    [bundle],
  )

  const navigate = useNavigate()
  /**
   * Stage reorder picks as a DRAFT purchase-order hand-off. Nothing is written
   * to Firestore here — the user reviews quantities/supplier on the Purchases
   * page and explicitly submits the real `createPurchase` transaction there.
   */
  const stageForPurchase = useCallback(
    (picks: NonNullable<InsightBundle>['reorderCandidates']) => {
      if (!user || picks.length === 0) return
      const lines = picks
        .filter((p) => p.recommendedOrderQty > 0)
        .map((p) => ({
          productId: p.productId,
          name: p.name,
          unit: p.unit,
          quantity: Math.max(1, Math.ceil(p.recommendedOrderQty)),
          purchasePrice: p.purchasePrice,
          gstRate: p.gstRate,
        }))
      if (lines.length === 0) {
        notify({ type: 'info', message: 'Not enough sales history to size any order yet.', title: 'Nothing to stage' })
        return
      }
      try {
        localStorage.setItem(aiPurchasePrefillKey(user.storeId), JSON.stringify(lines))
      } catch {
        notify({ type: 'error', message: 'Could not prepare the draft purchase list locally.', title: 'Staging failed' })
        return
      }
      for (const p of picks) {
        const rec = history.find((r) => r.type === 'REORDER' && r.productId === p.productId)
        if (rec?.id) void updateInsightStatus(rec.id, 'actioned')
      }
      void logAudit({
        storeId: user.storeId,
        userId: user.uid,
        userName: user.name,
        action: 'ai_purchase_staged',
        entityType: 'aiInsight',
        entityId: '',
        metadata: { count: lines.length },
      })
      notify({
        type: 'success',
        message: `${lines.length} suggestion(s) loaded into a draft purchase — review lines and confirm on the Purchases page.`,
        title: 'Sent to Purchases',
      })
      navigate('/purchases')
    },
    [history, navigate, notify, user],
  )

  if (loading || !user || !bundle) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <PageHeader title="AI Insights" description="Inventory & sales intelligence built from your real data" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    )
  }


  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title="AI Insights"
        description="Decision support for purchasing and inventory — powered by your actual sales data."
        actions={
          <>
            <span className="text-xs text-slate-400">Updated {formatDateTime(bundle.generatedAt)}</span>
            <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-4 w-4" />} loading={refreshing} onClick={() => void load(true)}>
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          AI insights are temporarily unavailable. Core POS functionality is unaffected. {error}
        </div>
      )}

      {!bundle.hasData && (
        <InlineEmpty
          icon={<PackageOpen className="h-6 w-6" />}
          title="Not enough sales history yet"
          message="Once you record sales, the intelligence engine starts producing stock, reorder and anomaly insights — but only when there is enough real data to be reliable."
        />
      )}

      {bundle.hasData && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Sales" value={bundle.summary.sales.value} hint={bundle.summary.sales.detail} icon={<TrendingUp className="h-5 w-5" />} tone="success" />
            <StatCard label="Inventory" value={bundle.summary.inventory.value.split('(')[0].trim()} hint={bundle.summary.inventory.detail} icon={<PackageOpen className="h-5 w-5" />} tone="warning" />
            <StatCard label="Fast movers" value={short(bundle.summary.fastMovers.value)} hint={bundle.summary.fastMovers.detail} icon={<ShoppingCart className="h-5 w-5" />} />
            <StatCard label="Dead stock" value={bundle.summary.deadStock.value} hint={bundle.summary.deadStock.detail} icon={<PackageX className="h-5 w-5" />} tone="danger" />
            <StatCard label="Attention" value={bundle.summary.attention.value} hint={bundle.summary.attention.detail} icon={<AlertTriangle className="h-5 w-5" />} tone="warning" />
          </div>

          <Card className="mb-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <ClipboardList className="h-4 w-4 text-emerald-600" /> Recommended actions
            </h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
              {bundle.summary.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-slate-400">Recommendations are suggestions only — nothing is ordered automatically.</p>
          </Card>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <OverviewSection bundle={bundle} expanded={expanded} setExpanded={setExpanded} />}
          {tab === 'reorder' && (
            <ReorderSection
              candidates={bundle.reorderCandidates.filter((p) => !hiddenReorder.has(p.productId))}
              hidden={hiddenReorder}
              setHidden={setHiddenReorder}
              expanded={expanded}
              setExpanded={setExpanded}
              onAction={onAction}
              onStagePick={stageForPurchase}
            />
          )}
          {tab === 'movement' && <MovementSection bundle={bundle} />}
          {tab === 'anomalies' && <AnomaliesSection bundle={bundle} expanded={expanded} setExpanded={setExpanded} />}
          {tab === 'assistant' && (
            <AssistantSection question={question} setQuestion={setQuestion} answer={answer} onAsk={ask} />
          )}
          {tab === 'history' && <HistorySection history={history} onStatus={onAction} />}
        </>
      )}
    </div>
  )
}

function short(value: string): string {
  return value.length > 16 ? value.slice(0, 16) + '…' : value
}

function InlineEmpty({ icon, title, message }: { icon?: React.ReactNode; title: string; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-600">
      <div className="rounded-full bg-slate-100 p-3 text-slate-400 dark:bg-slate-700 dark:text-slate-500">{icon}</div>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
      {message && <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{message}</p>}
    </div>
  )
}

function ExpandRow({ id, expanded, setExpanded, children }: { id: string; expanded: string | null; setExpanded: (s: string | null) => void; children: React.ReactNode }) {
  const open = expanded === id
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setExpanded(open ? null : id)} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:underline">
        {open ? 'Hide' : 'Why am I seeing this?'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-1.5 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">{children}</div>}
    </div>
  )
}


function OverviewSection({
  bundle,
}: {
  bundle: InsightBundle
  expanded: string | null
  setExpanded: (s: string | null) => void
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Today's business intelligence</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{bundle.summary.sales.detail}</p>
        <ul className="space-y-2">
          {bundle.summary.recommendations.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              {r}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Critical — run out soon</h3>
        {bundle.reorderCandidates.filter((p) => p.daysUntilStockout !== null && p.daysUntilStockout <= 2).length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No critical stockouts right now.</p>
        ) : (
          <ul className="space-y-2">
            {bundle.reorderCandidates
              .filter((p) => p.daysUntilStockout !== null && p.daysUntilStockout <= 2)
              .slice(0, 4)
              .map((p) => (
                <li key={p.productId} className="rounded-lg border border-red-100 bg-red-50/50 p-2 dark:border-red-500/20 dark:bg-red-500/5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.name}</span>
                    <Badge tone="red">~{Math.ceil(p.daysUntilStockout as number)}d</Badge>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {p.currentStock} in stock · {p.avgDaily7}/day avg
                  </p>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </div>
  )
}


function ReorderSection({
  candidates,
  hidden,
  setHidden,
  expanded,
  setExpanded,
  onAction,
  onStagePick,
}: {
  candidates: InsightBundle['reorderCandidates']
  hidden: Set<string>
  setHidden: (updater: (prev: Set<string>) => Set<string>) => void
  expanded: string | null
  setExpanded: (s: string | null) => void
  onAction: (type: string, productId: string | null, status: InsightStatus, msg: string) => void
  onStagePick: (picks: InsightBundle['reorderCandidates']) => void
}) {
  if (candidates.length === 0) {
    return (
      <InlineEmpty
        title="No reorder recommendations"
        message="All tracked products have enough stock for now. Hidden items reappear after Refresh."
      />
    )
  }
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3 dark:border-slate-700">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {candidates.length} product(s) recommended for reorder. Figures are 7/30-day average daily sales, weighted velocity, estimated days to stockout and a suggested order quantity.
          {hidden.size > 0 && ` · ${hidden.size} ignored/snoozed this session.`}
        </p>
        <Button size="sm" variant="outline" leftIcon={<ShoppingCart className="h-4 w-4" />} onClick={() => onStagePick(candidates.filter((p) => !p.insufficientData))}>
          Review in purchases
        </Button>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {candidates.map((p) => (
          <li key={p.productId} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{p.name}</span>
                  {p.insufficientData && <Badge tone="slate">insufficient history</Badge>}
                  {confidenceBadge(p.confidence)}
                  {p.daysUntilStockout !== null && p.daysUntilStockout <= 2 && <Badge tone="red">critical</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Stock {formatNumber(p.currentStock)} {p.unit} · 7d avg {formatNumber(p.avgDaily7)}/day · 30d avg {formatNumber(p.avgDaily30)}/day
                  {p.daysUntilStockout !== null ? ` · stockout ~${Math.ceil(p.daysUntilStockout)}d` : ' · no stockout projection yet'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  Order {p.recommendedOrderQty}
                </span>
                <Button size="xs" variant="outline" leftIcon={<Check className="h-3.5 w-3.5" />} onClick={() => onStagePick([p])}>
                  Add to order
                </Button>
                <Button size="xs" variant="ghost" leftIcon={<BellOff className="h-3.5 w-3.5" />} onClick={() => { setHidden((prev) => new Set(prev).add(p.productId)); onAction('REORDER', p.productId, 'dismissed', `Ignored ${p.name}.`); }}>
                  Ignore
                </Button>
                <Button size="xs" variant="ghost" leftIcon={<Clock className="h-3.5 w-3.5" />} onClick={() => { setHidden((prev) => new Set(prev).add(p.productId)); onAction('REORDER', p.productId, 'reviewed', `Snoozed ${p.name}.`); }}>
                  Snooze
                </Button>
              </div>
            </div>
            <ExpandRow id={`reorder-${p.productId}`} expanded={expanded} setExpanded={setExpanded}>
              <MetricsGrid
                metrics={{
                  currentStock: p.currentStock,
                  avgDaily7: p.avgDaily7,
                  avgDaily30: p.avgDaily30,
                  weightedDaily: p.weightedDaily,
                  daysUntilStockout: p.daysUntilStockout,
                  demandNext1: p.demandNext1,
                  demandNext7: p.demandNext7,
                  demandNext30: p.demandNext30,
                  confidence: p.confidence,
                  recommendedOrderQty: p.recommendedOrderQty,
                }}
              />
            </ExpandRow>
          </li>
        ))}
      </ul>
    </Card>
  )
}


function MovementSection({ bundle }: { bundle: InsightBundle }) {
  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="border-b border-slate-200 p-3 dark:border-slate-700">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <TrendingUp className="h-4 w-4 text-emerald-600" /> Fast moving
          </h3>
        </div>
        {bundle.fastMoving.length === 0 ? (
          <InlineEmpty title="No fast movers yet" message="Products appear here once they pass the fast-moving volume threshold." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Sold / 7d</th>
                  <th className="px-3 py-2">Revenue</th>
                  <th className="px-3 py-2">Avg/day</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2">Days left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {bundle.fastMoving.map((f) => (
                  <tr key={f.productId}>
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{f.name}</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(f.sold7d)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(f.revenue7d)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(f.avgDaily)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(f.stock)}</td>
                    <td className="px-3 py-2 tabular-nums">{f.daysLeft === null ? '—' : formatNumber(f.daysLeft)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="border-b border-slate-200 p-3 dark:border-slate-700">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <PackageX className="h-4 w-4 text-amber-600" /> Slow moving & dead stock
          </h3>
          {bundle.slowDead.length > 0 && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {bundle.slowDead.filter((s) => s.kind === 'DEAD').length} dead ·{' '}
              {formatMoney(bundle.slowDead.reduce((a, s) => a + s.stockValue, 0))} of inventory value
            </p>
          )}
        </div>
        {bundle.slowDead.length === 0 ? (
          <InlineEmpty title="Nothing slow or dead" message="No tracked products are sitting with very low or zero sales." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2">Stock value</th>
                  <th className="px-3 py-2">Days since sale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {bundle.slowDead.map((s) => (
                  <tr key={s.productId}>
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{s.name}</td>
                    <td className="px-3 py-2"><Badge tone={s.kind === 'DEAD' ? 'red' : 'amber'}>{s.kind}</Badge></td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(s.stock)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(s.stockValue)}</td>
                    <td className="px-3 py-2 tabular-nums">{s.lastSaleDay === null ? 'never' : `${s.daysSinceLastSale} days`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function AnomaliesSection({
  bundle,
  expanded,
  setExpanded,
}: {
  bundle: InsightBundle
  expanded: string | null
  setExpanded: (s: string | null) => void
}) {
  if (bundle.salesAnomalies.length === 0) {
    return <InlineEmpty title="No anomalies detected" message="Nothing unusual compared with recent history. The engine only flags clear, data-backed patterns." />
  }
  return (
    <div className="space-y-2">
      {bundle.salesAnomalies.map((a, i) => (
        <Card key={i}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 ${a.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{a.productName ?? 'Store-wide activity'}</span>
              {severityBadge(a.severity)}
            </div>
            <Badge tone="sky">{a.kind.replaceAll('_', ' ')}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{a.message}</p>
          <ExpandRow id={`anomaly-${i}`} expanded={expanded} setExpanded={setExpanded}>
            <MetricsGrid metrics={a.support} />
          </ExpandRow>
        </Card>
      ))}
      <p className="text-xs text-slate-400">Neutral language is used intentionally — unusual activity should be reviewed, not treated as proof of wrongdoing.</p>
    </div>
  )
}


function AssistantSection({
  question,
  setQuestion,
  answer,
  onAsk,
}: {
  question: string
  setQuestion: (q: string) => void
  answer: AssistantAnswer | null
  onAsk: (q: string) => void
}) {
  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <MessageSquareText className="h-4 w-4 text-emerald-600" /> Ask about your business
      </h3>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Answers are generated from your store's real data. If there isn't enough history to answer reliably, the assistant says so instead of guessing.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onAsk(question)
        }}
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What should I order today?"
          aria-label="Ask a business question"
        />
        <Button type="submit" size="sm" disabled={!question.trim()}>
          Ask
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setQuestion(chip)
              onAsk(chip)
            }}
            className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
          >
            {chip}
          </button>
        ))}
      </div>
      {answer && (
        <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/5">
          <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-200">{answer.reply}</p>
          {!answer.claimedData && (
            <p className="mt-2 text-xs text-slate-400">Guidance shown above is general help, not derived from your sales data.</p>
          )}
        </div>
      )}
    </Card>
  )
}


function HistorySection({
  history,
  onStatus,
}: {
  history: InsightRecord[]
  onStatus: (type: string, productId: string | null, status: InsightStatus, msg: string) => void
}) {
  if (history.length === 0) {
    return (
      <InlineEmpty
        icon={<History className="h-6 w-6" />}
        title="No insight history yet"
        message="Recommendations and anomalies are recorded here each time insights are computed, with the metrics that justified them."
      />
    )
  }
  return (
    <Card padded={false}>
      <div className="border-b border-slate-200 p-3 dark:border-slate-700">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every recommendation is stored with its supporting metrics and can be marked reviewed, actioned or dismissed — keeping the decision trail auditable.
        </p>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {history.map((r) => (
          <li key={r.id ?? `${r.type}-${r.generatedAt}`} className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {severityBadge(r.severity)}
                  {confidenceBadge(r.confidence)}
                  {statusBadge(r.status)}
                  <Badge tone="slate">{r.type.replaceAll('_', ' ')}</Badge>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">{r.message}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{r.recommendation}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Generated {formatDateTime(r.generatedAt)}
                  {r.productName ? ` · ${r.productName}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {r.status !== 'reviewed' && (
                  <Button size="xs" variant="outline" leftIcon={<Check className="h-3.5 w-3.5" />} onClick={() => onStatus(r.type, r.productId, 'reviewed', 'Marked as reviewed.')}>
                    Reviewed
                  </Button>
                )}
                {r.status !== 'actioned' && r.type === 'REORDER' && (
                  <Button size="xs" variant="outline" onClick={() => onStatus(r.type, r.productId, 'actioned', 'Marked as actioned.')}>
                    Actioned
                  </Button>
                )}
                {r.status !== 'dismissed' && (
                  <Button size="xs" variant="ghost" leftIcon={<BellOff className="h-3.5 w-3.5" />} onClick={() => onStatus(r.type, r.productId, 'dismissed', 'Insight dismissed.')}>
                    Dismiss
                  </Button>
                )}
              </div>
            </div>
            <ExpandRow id={`hist-${r.id}`} expanded={null} setExpanded={() => {}}>
              <MetricsGrid metrics={r.supportingMetrics} />
            </ExpandRow>
          </li>
        ))}
      </ul>
    </Card>
  )
}

