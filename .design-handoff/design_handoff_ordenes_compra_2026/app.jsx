// app.jsx — Root: routing, toasts, success modal, tweaks
const { useState: useStateApp, useEffect: useEffectApp } = React;

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "accent": "#C90812",
  "density": "comfortable",
  "showAlerts": true,
  "demoBanner": false
}/*EDITMODE-END*/;

function App() {
  const [authed, setAuthed]     = useStateApp(false);
  const [route, setRoute]       = useStateApp('dashboard'); // dashboard, orders, new, order-detail, vendors, reports, billing, email-preview, drive, settings
  const [openOrderId, setOpenOrderId] = useStateApp(null);
  const [toasts, setToasts]     = useStateApp([]);
  const [showSuccess, setShowSuccess] = useStateApp(null);
  const [notifs, setNotifs]     = useStateApp(NOTIFS_INITIAL);
  const [menuOpen, setMenuOpen] = useStateApp(false);

  const [t, setTweak] = useTweaks(DEFAULT_TWEAKS);

  // apply tweak overrides
  useEffectApp(() => {
    const r = document.documentElement;
    r.style.setProperty('--tops-red', t.accent);
    r.style.setProperty('--bg-accent', t.accent);
    r.style.setProperty('--fg-accent', t.accent);
    r.style.setProperty('--status-danger', t.accent);
    const isDense = t.density === 'compact';
    r.style.setProperty('--space-6', isDense ? '18px' : '24px');
    r.style.setProperty('--space-8', isDense ? '24px' : '32px');
  }, [t]);

  // Welcome toast on mount (post-login)
  useEffectApp(() => {
    if (!authed) return;
    const tm = setTimeout(() => {
      pushToast({ kind: 'signed', title: 'OC-2026-0347 firmada', msg: 'José Luis Battaglia · Pallets Sur S.R.L. acaba de aprobar.' });
    }, 1800);
    return () => clearTimeout(tm);
  }, [authed]);

  const pushToast = (t) => {
    const id = Date.now() + Math.random();
    setToasts(s => [...s, { id, ...t }]);
    setTimeout(() => setToasts(s => s.filter(x => x.id !== id)), 5500);
  };

  const openOrder = (id) => { setOpenOrderId(id); setRoute('order-detail'); };
  const handleOrderComplete = (order) => { setShowSuccess(order); };

  if (!authed) {
    return (
      <>
        <Login onSubmit={() => setAuthed(true)} />
        <TweaksPanel title="Tweaks · TOPS Compras">
          <TweakSection label="Atajos" />
          <TweakButton label="Saltar login → Dashboard" onClick={() => setAuthed(true)} />
        </TweaksPanel>
      </>
    );
  }

  return (
    <div className={`app-root ${menuOpen ? 'menu-open' : ''}`}>
      <Sidebar route={route} onNav={(r) => { setRoute(r); setMenuOpen(false); }} />
      <div className="mobile-overlay" onClick={() => setMenuOpen(false)} />
      <div className="main-area">
        <Topbar route={route} onNav={setRoute} notifCount={notifs.length} onBellClick={() => {}} onMenuClick={() => setMenuOpen(true)} />
        {route === 'dashboard'     && <Dashboard onNav={setRoute} onOpenOrder={openOrder} />}
        {route === 'orders'        && <OrdersList onOpenOrder={openOrder} onNav={setRoute} />}
        {route === 'order-detail'  && <OrderDetail orderId={openOrderId} onBack={() => setRoute('orders')} onShare={() => pushToast({ kind: 'info', title: 'Comprobante reenviado', msg: 'Email reenviado al proveedor + Ruth + Dirección.' })} />}
        {route === 'new'           && <NewOrder onComplete={handleOrderComplete} onCancel={() => setRoute('dashboard')} pushToast={pushToast} />}
        {route === 'vendors'       && <Vendors onOpenOrder={openOrder} />}
        {route === 'reports'       && <Stub title="Reportes" subtitle="Reportería avanzada por proveedor, categoría y período. Exportación a Excel/CSV." icon="report" />}
        {route === 'billing'       && <Stub title="Conciliación" subtitle="Cruce automático de OC contra facturas y remitos del proveedor." icon="bill" />}
        {route === 'email-preview' && <EmailPreview />}
        {route === 'drive'         && <DrivePage />}
        {route === 'settings'      && <Stub title="Configuración" subtitle="Usuarios, permisos, integraciones Drive/Gmail y plantillas." icon="gear" />}
      </div>

      <MobileBottomNav route={route} onNav={setRoute} />

      <ToastStack toasts={toasts} onClose={(id) => setToasts(s => s.filter(t => t.id !== id))} />

      {showSuccess && (
        <SuccessModal order={showSuccess} onClose={() => { setShowSuccess(null); setRoute('order-detail'); setOpenOrderId(showSuccess.id); }} />
      )}

      <TweaksPanel title="Tweaks · TOPS Compras">
        <TweakSection label="Identidad" />
        <TweakColor label="Color de acento" value={t.accent}
          options={['#C90812','#050555','#214576','#0E7C3A']}
          onChange={(v) => setTweak('accent', v)} />
        <TweakRadio label="Densidad" value={t.density}
          options={['comfortable', 'compact']}
          onChange={(v) => setTweak('density', v)} />

        <TweakSection label="Navegación" />
        <TweakButton label="→ Dashboard"           onClick={() => setRoute('dashboard')} />
        <TweakButton label="→ Historial OC"        onClick={() => setRoute('orders')} />
        <TweakButton label="→ Nueva OC (4 pasos)"  onClick={() => setRoute('new')} />
        <TweakButton label="→ Detalle / PDF"       onClick={() => openOrder(ORDERS[0].id)} />
        <TweakButton label="→ Proveedores"         onClick={() => setRoute('vendors')} />
        <TweakButton label="→ Email al proveedor"  onClick={() => setRoute('email-preview')} />
        <TweakButton label="→ Carpeta Drive"       onClick={() => setRoute('drive')} />
        <TweakButton label="→ Volver al login"     onClick={() => setAuthed(false)} secondary />

        <TweakSection label="Acciones" />
        <TweakButton label="Simular firma OC"
          onClick={() => pushToast({ kind: 'signed', title: 'OC-2026-0349 firmada', msg: 'José Luis Battaglia · Combustibles AMBA' })} />
        <TweakButton label="Simular envío email"
          onClick={() => pushToast({ kind: 'info', title: 'OC enviada', msg: 'Email entregado al proveedor + 2 internos.' })} />
        <TweakButton label="Simular alerta factura"
          onClick={() => pushToast({ kind: 'warn', title: 'Factura faltante', msg: 'OC-2026-0339 sin factura hace 14 días' })} />
      </TweaksPanel>
    </div>
  );
}

function ToastStack({ toasts, onClose }) {
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind === 'warn' ? 'is-warn' : ''}`}>
          <div className={`toast-icon ${t.kind === 'info' ? 'info' : ''} ${t.kind === 'warn' ? 'warn' : ''}`}>
            <Icon name={t.kind === 'info' ? 'send' : t.kind === 'warn' ? 'bolt' : 'pen'} size={15} stroke={2.2} />
          </div>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            <div className="toast-msg">{t.msg}</div>
          </div>
          <button className="toast-close" onClick={() => onClose(t.id)}>
            <Icon name="x" size={13}/>
          </button>
        </div>
      ))}
    </div>
  );
}

function SuccessModal({ order, onClose }) {
  const prov = PROVEEDORES.find(p => p.id === order.providerId) || {};
  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div style={{ padding: '32px 36px 24px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(14,124,58,0.12)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--status-success)', color: 'white',
              display: 'grid', placeItems: 'center' }}>
              <Icon name="check" size={24} stroke={2.4} />
            </div>
          </div>
          <div className="eyebrow-tiny" style={{ color: 'var(--status-success)' }}>OC emitida, firmada y enviada</div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--fg-brand)', margin: '0 0 8px', letterSpacing: '-0.005em' }}>
            ¡Listo! Orden generada.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--fg-secondary)', margin: '0 0 22px' }}>
            La orden <span className="mono" style={{ color: 'var(--fg-brand)', fontWeight: 700 }}>{order.id}</span> por <strong style={{ color: 'var(--fg-primary)' }}>{fmtCurrency(order.total)}</strong> fue firmada digitalmente y enviada por email.
          </p>

          <div style={{ background: 'var(--neutral-50)', borderRadius: 8, padding: '14px 16px', textAlign: 'left', marginBottom: 16 }}>
            <SendItem who={prov.email || 'proveedor@email.com'} tag="Proveedor" />
            <SendItem who="ruth@logisticatops.com" tag="Administración" />
            <SendItem who="joseluis@logisticatops.com" tag="Dirección" last />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            background: 'rgba(33,69,118,0.06)', borderRadius: 8, fontSize: 12, textAlign: 'left' }}>
            <Icon name="cloud-check" size={16} style={{ color: 'var(--status-success)' }} />
            <div style={{ flex: 1, color: 'var(--fg-secondary)' }}>
              <strong style={{ color: 'var(--fg-primary)' }}>Guardada en Drive:</strong>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-muted)', marginTop: 2 }}>
                /Órdenes de Compra 2026/Mayo/{prov.razon}/
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '16px 36px 28px', borderTop: '1px solid var(--stroke-soft)' }}>
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
            <Icon name="download" size={14}/> Descargar PDF
          </button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>
            Ver orden <Icon name="arrow-right" size={14} stroke={2.2}/>
          </button>
        </div>
      </div>
    </div>
  );
}

function SendItem({ who, tag, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
      borderBottom: last ? 'none' : '1px solid var(--stroke-soft)' }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(14,124,58,0.12)',
        color: 'var(--status-success)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name="check" size={11} stroke={2.6} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--fg-primary)', flex: 1 }}>{who}</span>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        padding: '2px 6px', borderRadius: 3,
        background: 'white', color: 'var(--fg-secondary)', border: '1px solid var(--stroke-soft)',
      }}>{tag}</span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
