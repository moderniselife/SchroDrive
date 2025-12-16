"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Link, Search, Plus, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { toast } from "sonner"

interface Provider {
  name: string
  id: string
  configured: boolean
  connected: boolean
}

export default function AddContentPage() {
  const [magnetUrl, setMagnetUrl] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string>("torbox")
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchProviders() {
      try {
        const res = await fetch("/api/providers")
        const data = await res.json()
        if (data.ok !== false && data.providers) {
          setProviders(data.providers)
          // Select first connected provider by default
          const firstConnected = data.providers.find((p: Provider) => p.connected)
          if (firstConnected) {
            setSelectedProvider(firstConnected.id)
          }
        }
      } catch (error) {
        console.error("Failed to fetch providers:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchProviders()
  }, [])

  const handleAddMagnet = async () => {
    if (!magnetUrl.trim()) {
      toast.error("Please enter a magnet URL")
      return
    }
    
    if (!magnetUrl.startsWith("magnet:")) {
      toast.error("Invalid magnet URL - must start with 'magnet:'")
      return
    }

    setIsAdding(true)
    
    try {
      const res = await fetch("/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          magnet: magnetUrl,
          provider: selectedProvider,
        }),
      })
      
      const data = await res.json()
      
      if (data.ok) {
        toast.success(`Added to ${data.provider}`)
        setMagnetUrl("")
      } else {
        toast.error(data.error || "Failed to add magnet")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to add magnet")
    } finally {
      setIsAdding(false)
    }
  }

  const handleSearchAndAdd = async () => {
    if (!searchQuery.trim()) {
      toast.error("Please enter a search query")
      return
    }

    setIsSearching(true)
    
    try {
      // First search
      const searchRes = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`)
      const searchData = await searchRes.json()
      
      if (searchData.ok === false) {
        toast.error(searchData.error || "Search failed")
        return
      }
      
      if (!searchData.results || searchData.results.length === 0) {
        toast.error("No results found")
        return
      }

      // Get best result (first one - backend sorts by seeders)
      const best = searchData.results[0]
      
      if (!best.magnetUrl) {
        toast.error("Best result has no magnet URL")
        return
      }

      toast.info(`Found: ${best.title}`)
      
      // Add it
      const addRes = await fetch("/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          magnet: best.magnetUrl,
          name: best.title,
          provider: selectedProvider,
        }),
      })
      
      const addData = await addRes.json()
      
      if (addData.ok) {
        toast.success(`Added "${best.title}" to ${addData.provider}`)
        setSearchQuery("")
      } else {
        toast.error(addData.error || "Failed to add")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to search and add")
    } finally {
      setIsSearching(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Add Content</h1>
          <p className="text-muted-foreground">Loading providers...</p>
        </div>
        <Skeleton className="h-32 max-w-2xl" />
        <Skeleton className="h-48 max-w-2xl" />
      </div>
    )
  }

  const connectedProviders = providers.filter(p => p.connected)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Add Content</h1>
        <p className="text-muted-foreground">Add torrents to your debrid service</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {connectedProviders.length === 0 ? (
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardContent className="py-6">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-500" />
                <div>
                  <p className="font-medium">No providers connected</p>
                  <p className="text-sm text-muted-foreground">
                    Configure TorBox or Real-Debrid in settings to add content.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Select Provider</CardTitle>
                <CardDescription>Choose which service to add content to</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4">
                  {providers.map((provider) => (
                    <Button
                      key={provider.id}
                      variant={selectedProvider === provider.id ? "default" : "outline"}
                      onClick={() => setSelectedProvider(provider.id)}
                      className="flex-1"
                      disabled={!provider.connected}
                    >
                      {selectedProvider === provider.id && <CheckCircle2 className="mr-2 h-4 w-4" />}
                      {provider.name}
                      {!provider.connected && <span className="ml-2 text-xs">(disconnected)</span>}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link className="h-5 w-5" />
                  Add Magnet Link
                </CardTitle>
                <CardDescription>Paste a magnet link to add directly</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="magnet">Magnet URL</Label>
                  <Input
                    id="magnet"
                    placeholder="magnet:?xt=urn:btih:..."
                    value={magnetUrl}
                    onChange={(e) => setMagnetUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddMagnet()}
                  />
                </div>
                <Button onClick={handleAddMagnet} disabled={!magnetUrl.trim() || isAdding} className="w-full">
                  {isAdding ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding...</>
                  ) : (
                    <><Plus className="mr-2 h-4 w-4" />Add to {providers.find(p => p.id === selectedProvider)?.name || selectedProvider}</>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Search & Add
                </CardTitle>
                <CardDescription>Search indexer for content and add the best result automatically</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="search">Search Query</Label>
                  <div className="flex gap-2">
                    <Input
                      id="search"
                      placeholder="Movie Name 2024..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearchAndAdd()}
                    />
                    <Button onClick={handleSearchAndAdd} disabled={!searchQuery.trim() || isSearching}>
                      {isSearching ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  This will search your configured indexer and automatically add the best result (highest seeders).
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
