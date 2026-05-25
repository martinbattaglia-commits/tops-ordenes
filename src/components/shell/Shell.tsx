"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import MobileBottomNav from "./MobileBottomNav";
import MobileDrawer from "./MobileDrawer";

interface ShellProps {
  user: { name: string; role: string; avatar: string };
  children: ReactNode;
}

export default function Shell({ user, children }: ShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-bg-page">
      {/* Sidebar fijo desktop */}
      <aside className="hidden lg:flex w-[248px] shrink-0 sticky top-0 h-screen">
        <Sidebar user={user} />
      </aside>

      {/* Drawer mobile */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} />
      </MobileDrawer>

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onMenuClick={() => setDrawerOpen(true)} />
        <main className="flex-1 min-h-0 scroll-area pb-[calc(80px+var(--safe-bottom))] lg:pb-0">
          {children}
        </main>
        <div className="lg:hidden">
          <MobileBottomNav />
        </div>
      </div>
    </div>
  );
}
