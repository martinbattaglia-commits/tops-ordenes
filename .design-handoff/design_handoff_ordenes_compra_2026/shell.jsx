// shell.jsx — Sidebar + Topbar for Órdenes de Compra
const { useState, useEffect, useRef } = React;

const NAV = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'orders',    label: 'Órdenes',       icon: 'orders', count: ORDERS.length },
  { id: 'new',       label: 'Nueva orden',   icon: 'plus', accent: true },
  { id: 'vendors',   label: 'Proveedores',   icon: 'vendors' },
  { id: 'reports',   label: 'Reportes',      icon: 'report' },
  { id: 'billing',   label: 'Conciliación',  icon: 'bill' },
];
const NAV_BOTTOM = [
  { id: 'email-preview', label: 'Plantillas email', icon: 'mail' },
  { id: 'drive',         label: 'Carpeta Drive',    icon: 'cloud' },
  { id: 'settings',      label: 'Configuración',    icon: 'gear' },
];

function Sidebar({ route, onNav }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={window.__resources.logoWhite} alt="Logística TOPS" />
        <span className="sb-tag">OC</span>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-label">Compras 2026</div>
        <nav className="sidebar-nav">
          {NAV.map(item => (
            <div
              key={item.id}
              className={`sidebar-link ${route === item.id ? 'active' : ''} ${item.accent ? 'danger-accent' : ''}`}
              onClick={() => onNav(item.id)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {item.count != null && <span className="sb-count">{item.count}</span>}
            </div>
          ))}
        </nav>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-label">Sistema</div>
        <nav className="sidebar-nav">
          {NAV_BOTTOM.map(item => (
            <div
              key={item.id}
              className={`sidebar-link ${route === item.id ? 'active' : ''}`}
              onClick={() => onNav(item.id)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </div>
          ))}
        </nav>
      </div>

      <div className="sidebar-footer">
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.42)', padding: '0 6px 10px'
        }}>Integraciones</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          <IntegrationPing name="Google Drive" status="ok" detail="324 OC sincronizadas" />
          <IntegrationPing name="Email (Resend)" status="ok" detail="API · 99,8% deliver" />
          <IntegrationPing name="Clientify" status="pending" detail="Pendiente de integrar" />
        </div>
        <div className="sidebar-user" onClick={() => onNav('settings')}>
          <div className="avatar">JL</div>
          <div className="meta">
            <div className="name">José Luis Battaglia</div>
            <div className="role">Director de Operaciones</div>
          </div>
          <Icon name="chevron-down" size={14} style={{ color: 'rgba(255,255,255,0.4)' }} />
        </div>
      </div>
    </aside>
  );
}

function IntegrationPing({ name, status, detail }) {
  const okColor = status === 'ok' ? '#36c275' : (status === 'pending' ? '#B45309' : '#888');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
      borderRadius: 6, background: 'rgba(255,255,255,0.04)',
      fontSize: 12,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: okColor,
        boxShadow: status === 'ok' ? '0 0 0 3px rgba(54,194,117,0.20)' : 'none',
        flexShrink: 0,
      }} />
      <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500, flex: 1, fontSize: 11.5 }}>{name}</span>
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>{detail}</span>
    </div>
  );
}

function Topbar({ route, onNav, onBellClick, notifCount, onMenuClick }) {
  return (
    <header className="topbar">
      <button className="mobile-menu-btn" onClick={onMenuClick} aria-label="Menú">
        <Icon name="dashboard" size={18} />
      </button>
      <div className="mobile-brand">
        <img src={window.__resources.logoColor} alt="TOPS" />
        <span className="tag">Compras</span>
      </div>

      <div className="search">
        <Icon name="search" size={15} style={{ color: 'var(--fg-muted)' }} />
        <input placeholder="Buscar orden, proveedor, CUIT, producto…" />
        <span className="kbd">⌘ K</span>
      </div>
      <div className="spacer" />

      <div className="pill-date">
        <span className="dot" />
        Lunes 25 de mayo · 11:30
      </div>

      <button className="icon-btn" onClick={onBellClick} aria-label="Notificaciones">
        <Icon name="bell" size={17} />
        {notifCount > 0 && <span className="badge-dot" />}
      </button>

      <button className="btn btn-danger" onClick={() => onNav('new')}>
        <Icon name="plus" size={15} stroke={2.2} />
        <span className="btn-label">Nueva orden de compra</span>
      </button>
    </header>
  );
}

function MobileBottomNav({ route, onNav }) {
  const ITEMS = [
    { id: 'dashboard', label: 'Inicio',      icon: 'dashboard' },
    { id: 'orders',    label: 'Órdenes',     icon: 'orders' },
    { id: 'new',       label: 'Nueva',       icon: 'plus', fab: true },
    { id: 'vendors',   label: 'Proveedores', icon: 'vendors' },
    { id: 'settings',  label: 'Más',         icon: 'menu-dots' },
  ];
  return (
    <nav className="mobile-bottom-nav">
      {ITEMS.map(it => (
        <button key={it.id}
          className={`nav-item ${it.fab ? 'fab' : ''} ${route === it.id ? 'active' : ''}`}
          onClick={() => onNav(it.id)}>
          <Icon name={it.icon} size={it.fab ? 22 : 20} stroke={it.fab ? 2.4 : 1.8} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

window.Sidebar = Sidebar;
window.Topbar = Topbar;
window.MobileBottomNav = MobileBottomNav;
