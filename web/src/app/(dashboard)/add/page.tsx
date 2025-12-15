"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Link, Search, Plus, Loader2, CheckCircle2 } from "lucide-react"

export default function AddContentPage() {
  const [magnetUrl, setMagnetUrl] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [isAdding, setIsAdding] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<"torbox" | "realdebrid">("torbox")

  const handleAddMagnet = async () => {
    setIsAdding(true)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setIsAdding(false)
    setMagnetUrl("")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Add Content</h1>
        <p className="text-muted-foreground">Add torrents to your debrid service</p>
      </div>

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Select Provider</CardTitle>
            <CardDescription>Choose which service to add content to</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <Button
                variant={selectedProvider === "torbox" ? "default" : "outline"}
                onClick={() => setSelectedProvider("torbox")}
                className="flex-1"
              >
                {selectedProvider === "torbox" && <CheckCircle2 className="mr-2 h-4 w-4" />}
                TorBox
              </Button>
              <Button
                variant={selectedProvider === "realdebrid" ? "default" : "outline"}
                onClick={() => setSelectedProvider("realdebrid")}
                className="flex-1"
              >
                {selectedProvider === "realdebrid" && <CheckCircle2 className="mr-2 h-4 w-4" />}
                Real-Debrid
              </Button>
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
              />
            </div>
            <Button onClick={handleAddMagnet} disabled={!magnetUrl || isAdding} className="w-full">
              {isAdding ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding...</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" />Add to {selectedProvider === "torbox" ? "TorBox" : "Real-Debrid"}</>
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
            <CardDescription>Search indexer for content and add the best result</CardDescription>
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
                />
                <Button disabled={!searchQuery}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
