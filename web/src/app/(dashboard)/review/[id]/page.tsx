"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Entry = { id: string; sourcePath: string; sourceBasename: string; decision: string; parsed: { status: string; title?: string; confidence: number; reason: string }; override?: Record<string, unknown> }
type Audit = { action: string; payload?: unknown; createdAt: string }

export default function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("")
  const [entry, setEntry] = useState<Entry | null>(null)
  const [audit, setAudit] = useState<Audit[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  async function load(reviewId: string) {
    setLoading(true)
    try {
      const [entryResponse, auditResponse] = await Promise.all([
        fetch(`/api/organizer/review/${encodeURIComponent(reviewId)}`, { cache: "no-store" }),
        fetch(`/api/organizer/review/${encodeURIComponent(reviewId)}/audit`, { cache: "no-store" }),
      ])
      const entryData = await entryResponse.json()
      const auditData = await auditResponse.json()
      if (!entryResponse.ok || !entryData.ok) throw new Error(entryData.error || "Unable to load review")
      if (!auditResponse.ok || !auditData.ok) throw new Error(auditData.error || "Unable to load audit")
      setEntry(entryData.entry); setAudit(auditData.audit || []); setError("")
    } catch (value: any) { setError(value.message || "Unable to load review") }
    finally { setLoading(false) }
  }

  useEffect(() => { void params.then(({ id: value }) => { setId(value); void load(value) }) }, [params])

  async function retry() {
    if (!id) return
    const response = await fetch(`/api/organizer/review/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retry" }) })
    if (!response.ok) { const data = await response.json(); setError(data.error || "Unable to retry review"); return }
    await load(id)
  }

  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4"><div><Button variant="ghost" asChild><Link href="/review"><ArrowLeft className="mr-2 h-4 w-4" />Review queue</Link></Button><h1 className="mt-3 text-2xl font-bold">Review detail</h1></div><Button variant="outline" onClick={() => id && void load(id)} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    {error && <div className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">{error}</div>}
    {entry && <><Card><CardHeader><CardTitle>{entry.sourceBasename}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="break-all text-xs text-muted-foreground">{entry.sourcePath}</p><p>Detected: <strong>{entry.parsed.title || "No title"}</strong> · {entry.parsed.reason}</p><div className="flex gap-2"><Badge variant="outline">{entry.parsed.status}</Badge><Badge variant="outline">{entry.decision}</Badge><Button size="sm" variant="outline" onClick={() => void retry()}>Retry / Resume</Button></div>{entry.override && <pre className="rounded bg-muted p-3 text-xs">{JSON.stringify(entry.override, null, 2)}</pre>}</CardContent></Card><Card><CardHeader><CardTitle>Audit trail</CardTitle></CardHeader><CardContent>{audit.length === 0 ? <p className="text-muted-foreground">No audit events.</p> : <div className="space-y-2">{audit.map((item, index) => <div key={`${item.createdAt}-${index}`} className="rounded border p-2 text-sm"><strong>{item.action}</strong><span className="ml-2 text-muted-foreground">{item.createdAt}</span>{item.payload !== undefined && <pre className="mt-1 text-xs">{JSON.stringify(item.payload)}</pre>}</div>)}</div>}</CardContent></Card></>}
  </div>
}
