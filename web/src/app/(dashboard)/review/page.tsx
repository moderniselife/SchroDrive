"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type ReviewEntry = { id: string; sourcePath: string; sourceBasename: string; parsed: { status: "matched" | "ambiguous" | "unmatched"; title?: string; confidence: number; reason: string }; decision: string }

export default function ReviewPage() {
  const [entries, setEntries] = useState<ReviewEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [decision, setDecision] = useState("pending")
  const [parserStatus, setParserStatus] = useState("")
  const [includeResolved, setIncludeResolved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({})
  const pageSize = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize), includeResolved: String(includeResolved) })
      if (decision) query.set("status", decision)
      if (parserStatus) query.set("parserStatus", parserStatus)
      const response = await fetch(`/api/organizer/review?${query}`, { cache: "no-store" })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load review queue")
      setEntries(data.entries || []); setTotal(data.total || 0); setError("")
    } catch (value: any) { setError(value.message || "Unable to load review queue") }
    finally { setLoading(false) }
  }, [decision, includeResolved, page, parserStatus])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPage(0) }, [decision, includeResolved, parserStatus])

  async function action(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/organizer/review/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    if (response.ok) await load()
    else { const data = await response.json(); setError(data.error || "Unable to save review action") }
  }

  async function decide(id: string, value: "accepted" | "dismissed") {
    const title = titleOverrides[id]?.trim()
    await action(id, { decision: value, ...(title ? { override: { title } } : {}) })
  }

  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">Organizer Review</h1><p className="text-muted-foreground">Resolve media identity decisions and resume processing safely.</p></div><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></div>
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3"><label className="text-sm">Decision <select className="ml-2 rounded border bg-background p-2" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="dismissed">Dismissed</option></select></label><label className="text-sm">Parser state <select className="ml-2 rounded border bg-background p-2" value={parserStatus} onChange={(event) => setParserStatus(event.target.value)}><option value="">All</option><option value="matched">Matched</option><option value="ambiguous">Ambiguous</option><option value="unmatched">Unmatched</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} /> include resolved</label><span className="ml-auto text-sm text-muted-foreground">{total} results</span></div>
    {error && <div className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">{error}</div>}
    {!loading && entries.length === 0 && <Card><CardContent className="pt-6 text-muted-foreground">No review entries match these filters.</CardContent></Card>}
    <div className="grid gap-4">{entries.map((entry) => <Card key={entry.id}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-yellow-500" />{entry.sourceBasename}</CardTitle><Badge variant="outline">{entry.parsed.status} · {Math.round(entry.parsed.confidence * 100)}% · {entry.decision}</Badge></div></CardHeader><CardContent className="space-y-3"><p className="break-all text-xs text-muted-foreground">{entry.sourcePath}</p><p className="text-sm">Detected: <span className="font-medium">{entry.parsed.title || "No title"}</span> · {entry.parsed.reason}</p><div className="flex flex-wrap gap-2"><Input className="max-w-sm" placeholder="Optional title override" value={titleOverrides[entry.id] || ""} onChange={(event) => setTitleOverrides((current) => ({ ...current, [entry.id]: event.target.value }))} /><Button size="sm" onClick={() => void decide(entry.id, "accepted")}><Check className="mr-2 h-4 w-4" />Accept</Button><Button size="sm" variant="outline" onClick={() => void decide(entry.id, "dismissed")}><X className="mr-2 h-4 w-4" />Dismiss</Button><Button size="sm" variant="outline" onClick={() => void action(entry.id, { action: "retry" })}><RefreshCw className="mr-2 h-4 w-4" />Retry / Resume</Button><Button size="sm" variant="ghost" asChild><Link href={`/review/${encodeURIComponent(entry.id)}`}>Details <ExternalLink className="ml-2 h-4 w-4" /></Link></Button></div></CardContent></Card>)}</div>
    <div className="flex items-center justify-between"><Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="mr-2 h-4 w-4" />Previous</Button><span className="text-sm text-muted-foreground">Page {page + 1} of {pages}</span><Button variant="outline" size="sm" disabled={page + 1 >= pages || loading} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="ml-2 h-4 w-4" /></Button></div>
  </div>
}
