import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getFleetStatus } from '../api/client';

export type PanelId =
  | 'dashboard'
  | 'crm'
  | 'marketing'
  | 'finance'
  | 'logistics'
  | 'products'
  | 'osint'
  | 'bi';

interface FleetState {
  modules: Record<string, { online: boolean; error?: string }>;
  totals: { online: number; total: number };
  lastCheck: Date | null;
}

interface ConsoleContextType {
  fleet: FleetState;
  refreshFleet: () => Promise<void>;
  activePanel: PanelId;
  setActivePanel: (p: PanelId) => void;
}

const ConsoleContext = createContext<ConsoleContextType | null>(null);

export function useConsole(): ConsoleContextType {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error('useConsole requires ConsoleProvider');
  return ctx;
}

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [fleet, setFleet] = useState<FleetState>({
    modules: {},
    totals: { online: 0, total: 0 },
    lastCheck: null,
  });
  const [activePanel, setActivePanel] = useState<PanelId>('dashboard');

  const refreshFleet = useCallback(async () => {
    const status = await getFleetStatus();
    console.log('[Console] Fleet-Status:', status.totals.online, '/', status.totals.total);
    setFleet({ ...status, lastCheck: new Date() });
  }, []);

  useEffect(() => {
    refreshFleet();
    const interval = setInterval(refreshFleet, 15000);
    return () => clearInterval(interval);
  }, [refreshFleet]);

  return (
    <ConsoleContext.Provider value={{ fleet, refreshFleet, activePanel, setActivePanel }}>
      {children}
    </ConsoleContext.Provider>
  );
}