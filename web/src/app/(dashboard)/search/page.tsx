"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, Loader2, Plus, ExternalLink } from "lucide-react"

function formatBytes(bytes: number) {
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

const mockResults = [
  { id: 1, title: "Movie.Name.2024.1080p.BluRay.x264-GROUP", seeders: 234, leechers: 45, size: 8500000000, indexer: "1337x" },
  { id: 2, title: "Movie.Name.2024.2160p.WEB-DL.x265-GROUP", seeders: 156, leechers: 23, size: 15200000000, indexer: "RARBG" },
  { id: 3, title: "Movie.Name.2024.720p.WEB-DL.x264-GROUP", seeders: 89, leechers: 12, size: 3200000000, indexer: "YTS" },
]

export default function SearchPage() {
  const [query, setQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<typeof mockResults>([])
  const [hasSearched, setHasSearched] = useState(false)

  const handleSearch = async () => {
    if (!query) return
    setIsSearching(true)
    setHasSearched(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setResults(mockResults)
    setIsSearching(false)
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="text-muted-foreground">Search for content across indexers</p>
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
            <Button onClick={handleSearch} disabled={!query || isSearching}>
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
            ) : (
              <div className="space-y-2">
                {results.map((result) => (
                  <div key={result.id} className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{result.title}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <Badge variant="outline">{result.indexer}</Badge>
                        <span className="text-xs text-muted-foreground">{formatBytes(result.size)}</span>
                        <span className="text-xs text-green-500">↑ {result.seeders}</span>
                        <span className="text-xs text-red-500">↓ {result.leechers}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /></Button>
                      <Button size="sm"><Plus className="mr-2 h-4 w-4" />Add</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
