"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Server, Play, Square, RefreshCw, Globe, Clock, Trash2, FolderSync } from "lucide-react"

const services = [
  {
    id: "webhook",
    name: "Webhook Server",
    description: "Receives webhooks from Overseerr",
    icon: Globe,
    status: "running",
    port: 8978,
    uptime: "5d 12h 34m",
  },
  {
    id: "poller",
    name: "Overseerr Poller",
    description: "Polls Overseerr for approved requests",
    icon: RefreshCw,
    status: "running",
    interval: "30s",
  },
  {
    id: "dead-scanner",
    name: "Dead Scanner",
    description: "Scans for dead torrents and re-adds",
    icon: Trash2,
    status: "stopped",
    interval: "10m",
  },
  {
    id: "organizer",
    name: "Media Organizer",
    description: "Creates organized symlink structure",
    icon: FolderSync,
    status: "stopped",
    interval: "5m",
  },
]

export default function ServicesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Services</h1>
        <p className="text-muted-foreground">Manage background services</p>
      </div>

      <div className="flex gap-2">
        <Button><Play className="mr-2 h-4 w-4" />Start All</Button>
        <Button variant="outline"><Square className="mr-2 h-4 w-4" />Stop All</Button>
        <Button variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Restart All</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {services.map((service) => (
          <Card key={service.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <service.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{service.name}</CardTitle>
                    <CardDescription>{service.description}</CardDescription>
                  </div>
                </div>
                <Switch checked={service.status === "running"} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={service.status === "running" ? "default" : "secondary"}>
                      {service.status}
                    </Badge>
                    {service.port && <span className="text-xs text-muted-foreground">Port {service.port}</span>}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {service.uptime && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{service.uptime}</span>}
                    {service.interval && <span>Interval: {service.interval}</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  {service.status === "running" ? (
                    <>
                      <Button variant="outline" size="icon" className="h-8 w-8"><RefreshCw className="h-4 w-4" /></Button>
                      <Button variant="outline" size="icon" className="h-8 w-8"><Square className="h-4 w-4" /></Button>
                    </>
                  ) : (
                    <Button variant="outline" size="icon" className="h-8 w-8"><Play className="h-4 w-4" /></Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
