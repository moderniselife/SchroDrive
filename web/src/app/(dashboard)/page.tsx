"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { 
  HardDrive, 
  Download, 
  Activity,
  Server,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Radio,
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface Provider {
  name: string
  id: string
  configured: boolean
  connected: boolean
  torrentCount?: number
  error?: string
  webdav: {
    configured: boolean
    url: string | null
  }
}

interface Torrent {
  id: string
  name: string
  status: string
  progress: number
  size: number
  provider: string
  addedAt: string
  downloadSpeed: number
  seeds: number
}

interface DownloadItem {
  id: string
  name: string
  type: string
  status: string
  progress: number
  size: number
  provider: string
  addedAt: string
}

interface ServiceStatus {
  webhook: boolean
  poller: boolean
  mount: boolean
  deadScanner: boolean
  deadScannerWatch: boolean
  organizerWatch: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
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
  if (diffMins < 60) return `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`
}

function getStatusIcon(status: string, progress: number) {
  const normalizedStatus = status.toLowerCase()
  if (progress >= 100 || normalizedStatus.includes("completed") || normalizedStatus.includes("downloaded")) {
    return <CheckCircle2 className="h-4 w-4 text-green-500" />
  }
  if (normalizedStatus.includes("download") || normalizedStatus.includes("active")) {
    return <Download className="h-4 w-4 text-blue-500 animate-pulse" />
  }
  if (normalizedStatus.includes("error") || normalizedStatus.includes("failed")) {
    return <AlertCircle className="h-4 w-4 text-red-500" />
  }
  return <Clock className="h-4 w-4 text-yellow-500" />
}

function getStatusBadgeVariant(status: string, progress: number): "default" | "secondary" | "outline" | "destructive" {
  const normalizedStatus = status.toLowerCase()
  if (progress >= 100 || normalizedStatus.includes("completed") || normalizedStatus.includes("downloaded")) {
    return "default"
  }
  if (normalizedStatus.includes("download") || normalizedStatus.includes("active")) {
    return "secondary"
  }
  if (normalizedStatus.includes("error") || normalizedStatus.includes("failed")) {
    return "destructive"
  }
  return "outline"
}

export default function DashboardPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [torrents, setTorrents] = useState<Torrent[]>([])
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [services, setServices] = useState<ServiceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamStatus, setStreamStatus] = useState("")
  const torrentsEventSourceRef = useRef<EventSource | null>(null)
  const downloadsEventSourceRef = useRef<EventSource | null>(null)

  // Fetch providers and services (non-streaming)
  const fetchStaticData = useCallback(async () => {
    try {
      const [providersRes, statusRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/status"),
      ])
      const [providersData, statusData] = await Promise.all([
        providersRes.json(),
        statusRes.json(),
      ])
      if (providersData.ok !== false) setProviders(providersData.providers || [])
      if (statusData.ok !== false) setServices(statusData.services || null)
    } catch (error) {
      console.error("Failed to fetch static data:", error)
    }
  }, [])

  // Stream torrents
  const streamTorrents = useCallback(() => {
    if (torrentsEventSourceRef.current) {
      torrentsEventSourceRef.current.close()
    }
    
    const eventSource = new EventSource("/api/torrents/stream")
    torrentsEventSourceRef.current = eventSource

    eventSource.addEventListener("status", (e) => {
      const data = JSON.parse(e.data)
      setStreamStatus(data.message || "Loading...")
    })

    eventSource.addEventListener("torrents", (e) => {
      const data = JSON.parse(e.data)
      setTorrents((prev) => {
        const newTorrents = [...prev]
        for (const t of data.torrents || []) {
          const key = `${t.provider}-${t.id}`
          const existingIdx = newTorrents.findIndex((x) => `${x.provider}-${x.id}` === key)
          if (existingIdx >= 0) {
            newTorrents[existingIdx] = t
          } else {
            newTorrents.push(t)
          }
        }
        newTorrents.sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
        return newTorrents
      })
      setLoading(false)
    })

    eventSource.addEventListener("done", () => {
      eventSource.close()
    })

    eventSource.onerror = () => {
      eventSource.close()
    }

    return eventSource
  }, [])

  // Stream downloads
  const streamDownloads = useCallback(() => {
    if (downloadsEventSourceRef.current) {
      downloadsEventSourceRef.current.close()
    }
    
    const eventSource = new EventSource("/api/downloads/stream")
    downloadsEventSourceRef.current = eventSource

    eventSource.addEventListener("downloads", (e) => {
      const data = JSON.parse(e.data)
      setDownloads((prev) => {
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
        newDownloads.sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
        return newDownloads
      })
    })

    eventSource.addEventListener("done", () => {
      setIsStreaming(false)
      setRefreshing(false)
      setStreamStatus("")
      eventSource.close()
    })

    eventSource.onerror = () => {
      setIsStreaming(false)
      setRefreshing(false)
      eventSource.close()
    }

    return eventSource
  }, [])

  // Initial load and refresh
  const fetchData = useCallback(() => {
    setIsStreaming(true)
    fetchStaticData()
    streamTorrents()
    streamDownloads()
  }, [fetchStaticData, streamTorrents, streamDownloads])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => {
      clearInterval(interval)
      if (torrentsEventSourceRef.current) torrentsEventSourceRef.current.close()
      if (downloadsEventSourceRef.current) downloadsEventSourceRef.current.close()
    }
  }, [fetchData])

  function handleRefresh() {
    setRefreshing(true)
    fetchData()
  }

  // Calculate stats from real data - combine torrents + downloads
  const totalTorrents = torrents.length
  const totalDownloads = downloads.length
  const activeTorrents = torrents.filter(t => 
    t.progress < 100 && !t.status.toLowerCase().includes("error")
  ).length
  const activeDownloads = downloads.filter(d => 
    d.progress < 100 && !d.status.toLowerCase().includes("error")
  ).length
  const totalTorrentSize = torrents.reduce((acc, t) => acc + (t.size || 0), 0)
  const totalDownloadSize = downloads.reduce((acc, d) => acc + (d.size || 0), 0)
  const totalSize = totalTorrentSize + totalDownloadSize
  const connectedProviders = providers.filter(p => p.connected).length
  
  // Combine recent activity from both sources
  const allActivity = [
    ...torrents.map(t => ({ ...t, source: "torrent" as const })),
    ...downloads.map(d => ({ ...d, source: "download" as const, seeds: 0, downloadSpeed: 0 })),
  ].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())

  const servicesList = services ? [
    { name: "Webhook Server", status: services.webhook ? "running" : "stopped", port: 8978 },
    { name: "Overseerr Poller", status: services.poller ? "running" : "stopped", port: null },
    { name: "WebDAV Mount", status: services.mount ? "running" : "stopped", port: null },
    { name: "Dead Scanner", status: services.deadScanner || services.deadScannerWatch ? "running" : "stopped", port: null },
    { name: "Organizer", status: services.organizerWatch ? "running" : "stopped", port: null },
  ] : []

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-32 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
            <CardContent><Skeleton className="h-48" /></CardContent>
          </Card>
          <Card>
            <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
            <CardContent><Skeleton className="h-48" /></CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            {streamStatus || "Overview of your SchröDrive system"}
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
            {(refreshing || isStreaming) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Torrents
            </CardTitle>
            <Download className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTorrents}</div>
            <p className="text-xs text-muted-foreground">
              {activeTorrents > 0 ? `${activeTorrents} active` : "Across all providers"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Downloads
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalDownloads}</div>
            <p className="text-xs text-muted-foreground">
              {activeDownloads > 0 ? `${activeDownloads} active` : "Ready to stream"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Size
            </CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatBytes(totalSize)}</div>
            <p className="text-xs text-muted-foreground">
              {totalTorrents + totalDownloads} items total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Providers
            </CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{connectedProviders}/{providers.length}</div>
            <p className="text-xs text-muted-foreground">
              Connected
              {connectedProviders === providers.length && providers.length > 0 && (
                <span className="ml-2 text-green-500">Healthy</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest downloads and transfers</CardDescription>
          </CardHeader>
          <CardContent>
            {allActivity.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Download className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No activity found</p>
                <p className="text-sm">Add content to see activity here</p>
              </div>
            ) : (
              <div className="space-y-4">
                {allActivity.slice(0, 5).map((item) => (
                  <div key={`${item.source}-${item.provider}-${item.id}`} className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {getStatusIcon(item.status, item.progress)}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {item.provider} • {item.source}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <Badge variant={getStatusBadgeVariant(item.status, item.progress)}>
                        {item.progress >= 100 ? "completed" : item.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(item.addedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Services Status */}
        <Card>
          <CardHeader>
            <CardTitle>Services</CardTitle>
            <CardDescription>Background service status</CardDescription>
          </CardHeader>
          <CardContent>
            {servicesList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Unable to fetch service status</p>
              </div>
            ) : (
              <div className="space-y-4">
                {servicesList.map((service) => (
                  <div key={service.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{service.name}</p>
                        {service.port && (
                          <p className="text-xs text-muted-foreground">Port {service.port}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant={service.status === "running" ? "default" : "secondary"}>
                      {service.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Provider Status */}
      <Card>
        <CardHeader>
          <CardTitle>Provider Status</CardTitle>
          <CardDescription>Connected debrid services</CardDescription>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <HardDrive className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No providers configured</p>
              <p className="text-sm">Configure TorBox or Real-Debrid in settings</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {providers.map((provider) => (
                <div key={provider.id} className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      provider.id === "torbox" ? "bg-blue-500/10" : "bg-purple-500/10"
                    }`}>
                      <HardDrive className={`h-5 w-5 ${
                        provider.id === "torbox" ? "text-blue-500" : "text-purple-500"
                      }`} />
                    </div>
                    <div>
                      <p className="font-medium">{provider.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {provider.connected 
                          ? `${provider.torrentCount || 0} torrents`
                          : provider.configured 
                            ? "Connection failed" 
                            : "Not configured"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${
                      provider.connected ? "bg-green-500" : provider.configured ? "bg-red-500" : "bg-gray-500"
                    }`} />
                    <span className={`text-sm ${
                      provider.connected ? "text-green-500" : provider.configured ? "text-red-500" : "text-gray-500"
                    }`}>
                      {provider.connected ? "Connected" : provider.configured ? "Error" : "Disabled"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
