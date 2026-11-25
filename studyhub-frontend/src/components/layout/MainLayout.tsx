import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { Header } from "./Header"
import { useUIStore } from "@/store/ui"
import { cn } from "@/lib/utils"
import { FocusWidget } from "@/components/study/FocusWidget"
import { UpdateBanner } from "./UpdateBanner"

export function MainLayout() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 overflow-x-clip">
      <Sidebar />
      <div
        className={cn(
          "min-h-screen min-w-0 transition-[padding] duration-200",
          sidebarCollapsed ? "lg:pl-16" : "lg:pl-64"
        )}
      >
        <Header />
        <UpdateBanner />
        <main className="min-w-0 p-4 pb-20 lg:p-6 lg:pb-20">
          <Outlet />
        </main>
      </div>
      <FocusWidget />
    </div>
  )
}
