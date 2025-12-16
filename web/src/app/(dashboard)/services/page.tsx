"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Server, RefreshCw, Globe, Trash2, FolderSync, HardDrive, Loader2, Search } from "lucide-react"

interface ServiceStatus {
  webhook: boolean
  poller: boolean
  mount: boolean
  deadScanner: boolean
  deadScannerWatch: boolean
  organizerWatch: boolean
}

interface IndexerInfo {
  configured: boolean
  provider: string | null
}

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceStatus | null>(null)
  const [indexer, setIndexer] = useState<IndexerInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchStatus() {
    try {
      const res = await fetch("/api/status")
      const data = await res.json()
      if (data.ok !== false) {
        setServices(data.services || null)
        setIndexer(data.indexer || null)
      }
    } catch (error) {
      console.error("Failed to fetch service status:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    fetchStatus()
  }

  const servicesList = services ? [
    {
      id: "webhook",
      name: "Webhook Server",
      description: "Receives webhooks from Overseerr",
      icon: Globe,
      enabled: services.webhook,
      port: 8978,
    },
    {
      id: "poller",
      name: "Overseerr Poller",
      description: "Polls Overseerr for approved requests",
      icon: RefreshCw,
      enabled: services.poller,
    },
    {
      id: "mount",
      name: "WebDAV Mount",
      description: "Auto-mount WebDAV drives on startup",
      icon: HardDrive,
      enabled: services.mount,
    },
    {
      id: "dead-scanner",
      name: "Dead Scanner",
      description: "Scans for dead torrents and re-adds",
      icon: Trash2,
      enabled: services.deadScanner || services.deadScannerWatch,
      watchMode: services.deadScannerWatch,
    },
    {
      id: "organizer",
      name: "Media Organizer",
      description: "Creates organized symlink structure",
      icon: FolderSync,
      enabled: services.organizerWatch,
      watchMode: services.organizerWatch,
    },
    {
      id: "indexer",
      name: "Indexer",
      description: indexer?.provider ? `Using ${indexer.provider}` : "Search indexer for torrents",
      icon: Search,
      enabled: indexer?.configured || false,
      provider: indexer?.provider,
    },
  ] : []

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Services</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Services</h1>
          <p className="text-muted-foreground">Background service status</p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardContent className="py-3">
          <p className="text-sm">
            Services are configured via environment variables. To enable/disable services, update your <code className="bg-muted px-1 rounded">.env</code> file or container environment and restart.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {servicesList.map((service) => (
          <Card key={service.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    service.enabled ? "bg-green-500/10" : "bg-muted"
                  }`}>
                    <service.icon className={`h-5 w-5 ${
                      service.enabled ? "text-green-500" : "text-muted-foreground"
                    }`} />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{service.name}</CardTitle>
                    <CardDescription>{service.description}</CardDescription>
                  </div>
                </div>
                <Switch checked={service.enabled} disabled />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={service.enabled ? "default" : "secondary"}>
                      {service.enabled ? "enabled" : "disabled"}
                    </Badge>
                    {service.port && (
                      <span className="text-xs text-muted-foreground">Port {service.port}</span>
                    )}
                    {service.watchMode && (
                      <Badge variant="outline" className="text-xs">Watch Mode</Badge>
                    )}
                    {service.provider && (
                      <Badge variant="outline" className="text-xs capitalize">{service.provider}</Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
