"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import MobileBottomNav from "./MobileBottomNav";
import MobileDrawer from "./MobileDrawer";
import { VoiceOverlay } from "@/components/voice/VoiceOverlay";

interface ShellProps {
  user: { name: string; role: string; avatar: string };
  canViewExecutive?: boolean;
  canViewSistema?: boolean;
  canViewRrhhDocs?: boolean;
  canViewKnowledge?: boolean;
  canViewConnect?: boolean;
  canViewCopilot?: boolean;
  children: ReactNode;
}

export default function Shell({ user, canViewExecutive, canViewSistema, canViewRrhhDocs, canViewKnowledge, canViewConnect, canViewCopilot, children }: ShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="h-[100dvh] flex bg-bg-page overflow-hidden">
      {/* Sidebar fijo desktop */}
      <aside className="hidden lg:flex w-[248px] shrink-0 h-full">
        <Sidebar user={user} canViewExecutive={canViewExecutive} canViewSistema={canViewSistema} canViewRrhhDocs={canViewRrhhDocs} canViewKnowledge={canViewKnowledge} canViewConnect={canViewConnect} canViewCopilot={canViewCopilot} />
      </aside>

      {/* Drawer mobile */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Sidebar user={user} canViewExecutive={canViewExecutive} canViewSistema={canViewSistema} canViewRrhhDocs={canViewRrhhDocs} canViewKnowledge={canViewKnowledge} canViewConnect={canViewConnect} canViewCopilot={canViewCopilot} onNavigate={() => setDrawerOpen(false)} />
      </MobileDrawer>

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onMenuClick={() => setDrawerOpen(true)} />
        <main className="flex-1 min-h-0 scroll-area pb-[calc(80px+var(--safe-bottom))] lg:pb-0 nx-page-fade">
          {children}
          <VoiceOverlay />
        </main>
        <div className="lg:hidden">
          <MobileBottomNav />
        </div>
      </div>
    </div>
  );
}
