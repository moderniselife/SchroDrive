"use client"

import {
  LayoutDashboard,
  Settings,
  ScrollText,
  HardDrive,
  FolderOpen,
  Plus,
  Search,
  Server,
  Activity,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import Link from "next/link"
import { usePathname } from "next/navigation"

const navigation = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Activity", href: "/activity", icon: Activity },
    ],
  },
  {
    title: "Content",
    items: [
      { name: "Browse Files", href: "/files", icon: FolderOpen },
      { name: "Search", href: "/search", icon: Search },
      { name: "Add Content", href: "/add", icon: Plus },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Virtual Mounts", href: "/mounts", icon: HardDrive },
      { name: "Services", href: "/services", icon: Server },
      { name: "Logs", href: "/logs", icon: ScrollText },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HardDrive className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold">SchröDrive</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navigation.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname === item.href}>
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="rounded-lg border bg-muted/50 p-3 mx-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">System Online</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
