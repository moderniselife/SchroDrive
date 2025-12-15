"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Download, Clock, CheckCircle, XCircle, Loader2, RefreshCw, Globe, FileText, Link2, Radio } from "lucide-react"

interface DownloadItem {
  id: string
  name: string
  type: string // "download" | "web" | "usenet"
  status: string
  progress: number
  size: number
  provider: string
  addedAt: string
  downloadSpeed?: number
  downloadUrl?: string
  host?: string
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatSpeed(bytesPerSec: number) {
  if (!bytesPerSec || bytesPerSec === 0) return "0 B/s"
  return formatBytes(bytesPerSec) + "/s"
}

function formatRelativeTime(dateString: string): string {
  if (!dateString) return "Unknown"
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

function getStatus(item: DownloadItem): "downloading" | "completed" | "queued" | "failed" {
  const status = item.status.toLowerCase()
  if (item.progress >= 100 || status === "downloaded") return "completed"
  if (status.includes("download") || status.includes("active")) return "downloading"
  if (status.includes("error") || status.includes("failed") || status.includes("dead")) return "failed"
  if (status.includes("queue") || status.includes("wait") || status.includes("pending")) return "queued"
  if (item.downloadSpeed && item.downloadSpeed > 0) return "downloading"
  return "completed"
}

function getTypeIcon(type: string) {
  switch (type) {
    case "web": return <Globe className="h-4 w-4 text-blue-500" />
    case "usenet": return <FileText className="h-4 w-4 text-orange-500" />
    default: return <Link2 className="h-4 w-4 text-purple-500" />
  }
}

const statusIcons: Record<string, React.ReactNode> = {
  downloading: <Download className="h-4 w-4 text-blue-500 animate-pulse" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  queued: <Clock className="h-4 w-4 text-yellow-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
}

export default function ActivityPage() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<string>("")
  const [isStreaming, setIsStreaming] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)

  const fetchDownloadsStream = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setIsStreaming(true)
    setStatus("Connecting...")
    
    const eventSource = new EventSource("/api/downloads/stream")
    eventSourceRef.current = eventSource

    eventSource.addEventListener("status", (e) => {
      const data = JSON.parse(e.data)
      setStatus(data.message || "Loading...")
    })

    eventSource.addEventListener("downloads", (e) => {
      const data = JSON.parse(e.data)
      setDownloads((prev) => {
        // Merge new downloads, avoiding duplicates by id+provider+type
        const newDownloads = [...prev]
        for (const d of data.downloads || []) {
          const key = `${d.provider}-${d.type}-${d.id}`
          const existingIdx = newDownloads.findIndex((x) => `${x.provider}-${x.type}-${x.id}` === key)
          if (existingIdx >= 0) {
            newDownloads[existingIdx] = d
          } else {
            newDownloads.push(d)
          }
        }
        // Sort by addedAt descending
        newDownloads.sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
        return newDownloads
      })
      setLoading(false)
      setStatus(`Loaded ${data.count} ${data.type} from ${data.provider}`)
    })

    eventSource.addEventListener("error", (e: any) => {
      try {
        const data = JSON.parse(e.data)
        console.error("Stream error:", data)
        setStatus(`Error: ${data.error || "Unknown error"}`)
      } catch {
        console.error("Stream connection error")
      }
    })

    eventSource.addEventListener("done", () => {
      setIsStreaming(false)
      setRefreshing(false)
      setStatus("")
      eventSource.close()
    })

    eventSource.onerror = () => {
      setIsStreaming(false)
      setRefreshing(false)
      setLoading(false)
      eventSource.close()
    }
  }, [])

  useEffect(() => {
    fetchDownloadsStream()
    // Refresh every 30 seconds
    const interval = setInterval(fetchDownloadsStream, 30000)
    return () => {
      clearInterval(interval)
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [fetchDownloadsStream])

  function handleRefresh() {
    setRefreshing(true)
    setDownloads([]) // Clear for fresh load
    fetchDownloadsStream()
  }

  const activeCount = downloads.filter((d) => getStatus(d) === "downloading").length
  const queuedCount = downloads.filter((d) => getStatus(d) === "queued").length
  const completedCount = downloads.filter((d) => getStatus(d) === "completed").length
  const totalSpeed = downloads.reduce((acc, d) => acc + (d.downloadSpeed || 0), 0)

  // Count by type
  const webCount = downloads.filter((d) => d.type === "web").length
  const usenetCount = downloads.filter((d) => d.type === "usenet").length
  const rdCount = downloads.filter((d) => d.provider === "realdebrid").length

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Downloads</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Downloads</h1>
          <p className="text-muted-foreground">
            {status || "Real-Debrid downloads & TorBox web/usenet downloads"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isStreaming && (
            <Badge variant="outline" className="gap-1">
              <Radio className="h-3 w-3 animate-pulse" />
              Loading
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || isStreaming}>
            {(refreshing || isStreaming) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold">{activeCount}</p>
              </div>
              <Download className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">{completedCount}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Real-Debrid</p>
                <p className="text-2xl font-bold">{rdCount}</p>
              </div>
              <Link2 className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">TorBox</p>
                <p className="text-2xl font-bold">{webCount + usenetCount}</p>
              </div>
              <Globe className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1">
        <CardHeader>
          <CardTitle>All Downloads</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {downloads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Download className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-lg font-medium">No downloads</p>
                <p className="text-sm text-muted-foreground">
                  Downloads from Real-Debrid and TorBox web/usenet will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {downloads.map((item) => {
                  const status = getStatus(item)
                  return (
                    <div key={`${item.provider}-${item.id}`} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          {statusIcons[status]}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium leading-none break-words">{item.name}</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <Badge variant="outline" className="capitalize">{item.provider}</Badge>
                              <Badge variant="secondary" className="capitalize flex items-center gap-1">
                                {getTypeIcon(item.type)}
                                {item.type}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{formatBytes(item.size)}</span>
                              {item.host && (
                                <span className="text-xs text-muted-foreground">• {item.host}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                          {formatRelativeTime(item.addedAt)}
                        </span>
                      </div>
                      {(status === "downloading" || (item.progress > 0 && item.progress < 100)) && (
                        <div className="space-y-1">
                          <Progress value={item.progress} />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{Math.round(item.progress)}%</span>
                            {item.downloadSpeed && item.downloadSpeed > 0 && <span>{formatSpeed(item.downloadSpeed)}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
