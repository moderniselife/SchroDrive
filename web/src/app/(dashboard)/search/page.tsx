"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, Loader2, Plus, AlertCircle, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"

interface SearchResult {
  title: string
  size: number
  seeders: number
  leechers: number
  magnetUrl: string
  infoHash: string
  indexer: string
  publishDate: string
  categories: string[]
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

export default function SearchPage() {
  const [query, setQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [provider, setProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!query.trim()) return
    
    setIsSearching(true)
    setHasSearched(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      
      if (data.ok === false) {
        setError(data.error || "Search failed")
        setResults([])
      } else {
        setResults(data.results || [])
        setProvider(data.provider || null)
        if (data.results?.length === 0) {
          toast.info("No results found")
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to search")
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleAdd = async (result: SearchResult) => {
    if (!result.magnetUrl) {
      toast.error("No magnet URL available for this result")
      return
    }

    setAddingId(result.infoHash || result.title)
    
    try {
      const res = await fetch("/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          magnet: result.magnetUrl,
          name: result.title,
        }),
      })
      
      const data = await res.json()
      
      if (data.ok) {
        toast.success(`Added to ${data.provider}`)
      } else {
        toast.error(data.error || "Failed to add")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to add")
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="text-muted-foreground">
          Search for content across indexers
          {provider && <span className="ml-2">• Using {provider}</span>}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search for movies, TV shows..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-9"
              />
            </div>
            <Button onClick={handleSearch} disabled={!query.trim() || isSearching}>
              {isSearching ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching...</>
              ) : (
                <><Search className="mr-2 h-4 w-4" />Search</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1">
        <CardHeader>
          <CardTitle>
            {hasSearched ? `Results for "${query}" (${results.length})` : "Search Results"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {!hasSearched ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-lg font-medium">Start Searching</p>
                <p className="text-sm text-muted-foreground">Enter a search query to find content</p>
              </div>
            ) : isSearching ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">Searching indexers...</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="h-12 w-12 text-red-500/50" />
                <p className="mt-4 text-lg font-medium text-red-500">Search Failed</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-lg font-medium">No Results</p>
                <p className="text-sm text-muted-foreground">Try a different search query</p>
              </div>
            ) : (
              <div className="space-y-2">
                {results.map((result, idx) => {
                  const id = result.infoHash || result.title || String(idx)
                  const isAdding = addingId === id
                  
                  return (
                    <div key={id} className="rounded-lg border p-4 hover:bg-muted/50">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium break-words">{result.title}</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <Badge variant="outline">{result.indexer}</Badge>
                            <span className="text-xs text-muted-foreground">{formatBytes(result.size)}</span>
                            <span className="text-xs text-green-500">↑ {result.seeders}</span>
                            <span className="text-xs text-red-500">↓ {result.leechers}</span>
                          </div>
                        </div>
                        <Button 
                          size="sm" 
                          onClick={() => handleAdd(result)}
                          disabled={isAdding || !result.magnetUrl}
                          className="shrink-0"
                        >
                          {isAdding ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <><Plus className="mr-2 h-4 w-4" />Add</>
                          )}
                        </Button>
                      </div>
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
