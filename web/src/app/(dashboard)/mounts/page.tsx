"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { HardDrive, RefreshCw, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"

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

export default function MountsPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchProviders() {
    try {
      const res = await fetch("/api/providers")
      const data = await res.json()
      if (data.ok !== false) {
        setProviders(data.providers || [])
      }
    } catch (error) {
      console.error("Failed to fetch providers:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchProviders()
    const interval = setInterval(fetchProviders, 30000)
    return () => clearInterval(interval)
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    fetchProviders()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Virtual Mounts</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
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
          <h1 className="text-2xl font-bold">Virtual Mounts</h1>
          <p className="text-muted-foreground">WebDAV mount status for debrid providers</p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {providers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <HardDrive className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No Providers Configured</h3>
            <p className="text-muted-foreground mb-4">
              Configure TorBox or Real-Debrid in settings to enable WebDAV mounts.
            </p>
            <Button variant="outline" asChild>
              <a href="/settings">Go to Settings</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {providers.map((provider) => (
            <Card key={provider.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      provider.id === "torbox" ? "bg-blue-500/10" : "bg-purple-500/10"
                    }`}>
                      <HardDrive className={`h-5 w-5 ${
                        provider.id === "torbox" ? "text-blue-500" : "text-purple-500"
                      }`} />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{provider.name}</CardTitle>
                      <CardDescription>
                        {provider.webdav.url || "WebDAV not configured"}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant={provider.connected ? "default" : provider.configured ? "destructive" : "secondary"}>
                    {provider.connected ? "connected" : provider.configured ? "error" : "disabled"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground mb-1">API Status</p>
                    <div className="flex items-center gap-2">
                      {provider.connected ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="font-medium">
                        {provider.connected ? "Connected" : provider.error || "Disconnected"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground mb-1">Torrents</p>
                    <p className="text-2xl font-bold">
                      {provider.connected ? (provider.torrentCount || 0) : "-"}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">WebDAV Configuration</p>
                  <div className="flex items-center gap-2">
                    {provider.webdav.configured ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                    )}
                    <span className="text-sm">
                      {provider.webdav.configured ? "Configured" : "Not configured - set WebDAV credentials in settings"}
                    </span>
                  </div>
                  {provider.webdav.url && (
                    <code className="block mt-2 text-xs text-muted-foreground bg-muted px-2 py-1 rounded truncate">
                      {provider.webdav.url}
                    </code>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
