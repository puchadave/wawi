import { useEffect } from 'react';
import { useConsole, PanelId } from '../hooks/useConsole';

const NAV_ITEMS: Array<{ id: PanelId; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Overview', icon: '◉' },
  { id: 'crm', label: 'CRM / Intel', icon: '⊚' },
  { id: 'marketing', label: 'Marketing', icon: '◈' },
  { id: 'finance', label: 'FiBu Auto', icon: '€' },
  { id: 'products', label: 'Nischen-Shop', icon: '▣' },
  { id: 'logistics', label: 'Logistics', icon: '⇄' },
  { id: 'osint', label: 'OSINT Engine', icon: '◎' },
  { id: 'bi', label: 'BI Brain', icon: '▤' },
];

export function Sidebar() {
  const { fleet, activePanel, setActivePanel, refreshFleet } = useConsole();
  const { online, total } = fleet.totals;
  const allHealthy = online === total && total > 0;

  useEffect(() => {
    document.title = `FO-Console | ${online}/${total} Mods Online`;
  }, [online, total]);

  return (
    <aside className="sidebar">
      <div className="logo-block">
        <div className="logo-title">FO·CONSOLE</div>
        <div className="logo-sub">FullAutonom Business</div>
      </div>

      <nav className="nav-list">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-btn ${activePanel === item.id ? 'active' : ''}`}
            onClick={() => setActivePanel(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.id === 'dashboard' && (
              <span className={`status-dot ${allHealthy ? 'ok' : 'warn'}`} />
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="fleet-status">
          <div className="fleet-count">
            <span className={`fleet-pulse ${allHealthy ? 'ok' : 'warn'}`} />
            {online}/{total} Module erreichbar
          </div>
          <button className="refresh-btn" onClick={refreshFleet}>⟳</button>
        </div>
        <div className="server-tag">Server: {import.meta.env.VITE_SERVER_HOST ?? '127.0.0.1'}</div>
      </div>
    </aside>
  );
}