import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { Header } from "./Header"
import { useUIStore } from "@/store/ui"
import { Toaster } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"

export function MainLayout() {
  const { sidebarCollapsed, sidebarOpen } = useUIStore()

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <Sidebar />
      <div
        className={cn(
          "min-h-screen transition-all duration-200 lg:pl-64",
          sidebarCollapsed ? "lg:pl-16" : "",
          sidebarOpen ? "lg:pl-64" : ""
        )}
      >
        <Header />
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}