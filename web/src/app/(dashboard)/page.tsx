"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { 
  HardDrive, 
  Download, 
  Upload, 
  Activity,
  Server,
  Clock,
  CheckCircle2,
} from "lucide-react"

const stats = [
  {
    title: "Total Downloads",
    value: "1,234",
    description: "Last 30 days",
    icon: Download,
    trend: "+12%",
  },
  {
    title: "Active Transfers",
    value: "8",
    description: "In progress",
    icon: Upload,
    trend: "Live",
  },
  {
    title: "Storage Used",
    value: "2.4 TB",
    description: "Across all providers",
    icon: HardDrive,
    trend: "85%",
  },
  {
    title: "Uptime",
    value: "99.9%",
    description: "Last 7 days",
    icon: Activity,
    trend: "Healthy",
  },
]

const recentActivity = [
  { id: 1, title: "Movie Name 2024", status: "completed", provider: "TorBox", time: "2 min ago" },
  { id: 2, title: "TV Show S01E05", status: "downloading", provider: "Real-Debrid", time: "5 min ago" },
  { id: 3, title: "Documentary 2023", status: "completed", provider: "TorBox", time: "12 min ago" },
  { id: 4, title: "Anime Series EP10", status: "queued", provider: "TorBox", time: "15 min ago" },
  { id: 5, title: "Movie Classic 1995", status: "completed", provider: "Real-Debrid", time: "1 hour ago" },
]

const services = [
  { name: "Webhook Server", status: "running", port: 8978 },
  { name: "Overseerr Poller", status: "running", port: null },
  { name: "Dead Scanner", status: "stopped", port: null },
  { name: "Organizer", status: "stopped", port: null },
]

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your SchröDrive system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">
                {stat.description}
                <span className="ml-2 text-green-500">{stat.trend}</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest downloads and transfers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {item.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : item.status === "downloading" ? (
                      <Download className="h-4 w-4 text-blue-500 animate-pulse" />
                    ) : (
                      <Clock className="h-4 w-4 text-yellow-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.provider}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        item.status === "completed"
                          ? "default"
                          : item.status === "downloading"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {item.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Services Status */}
        <Card>
          <CardHeader>
            <CardTitle>Services</CardTitle>
            <CardDescription>Background service status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {services.map((service) => (
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <HardDrive className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium">TorBox</p>
                  <p className="text-sm text-muted-foreground">WebDAV Mounted</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm text-green-500">Connected</span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <HardDrive className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="font-medium">Real-Debrid</p>
                  <p className="text-sm text-muted-foreground">WebDAV Mounted</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm text-green-500">Connected</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
