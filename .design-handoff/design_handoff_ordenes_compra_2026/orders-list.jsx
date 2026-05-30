// orders-list.jsx — Historial de órdenes de compra
const { useState: useStateOL, useMemo: useMemoOL } = React;

function OrdersList({ onOpenOrder, onNav }) {
  const [filterStatus, setFilterStatus] = useStateOL('todas');
  const [filterVendor, setFilterVendor] = useStateOL('todos');
  const [search, setSearch] = useStateOL('');

  const filtered = useMemoOL(() => {
    return ORDERS.filter(o => {
      if (filterStatus !== 'todas' && o.status !== filterStatus) return false;
      if (filterVendor !== 'todos' && o.providerId !== filterVendor) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!o.proveedor.toLowerCase().includes(q) && !o.id.toLowerCase().includes(q) && !o.cuit.includes(q)) return false;
      }
      return true;
    });
  }, [filterStatus, filterVendor, search]);

  const statusCounts = {
    todas:      ORDERS.length,
    enviada:    ORDERS.filter(o => o.status === 'enviada').length,
    firmada:    ORDERS.filter(o => o.status === 'firmada').length,
    pendiente:  ORDERS.filter(o => o.status === 'pendiente').length,
    conciliada: ORDERS.filter(o => o.status === 'conciliada').length,
    borrador:   ORDERS.filter(o => o.status === 'borrador').length,
  };

  return (
    <div className="content scroll-area">
      <div className="content-narrow">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Historial · {ORDERS.length} órdenes de compra</div>
            <h1 className="page-title">Órdenes de compra</h1>
            <p className="page-subtitle">Trazabilidad completa de cada compra emitida. Filtrá, exportá o reenviá comprobantes al proveedor.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost"><Icon name="export" size={14} /> Exportar CSV</button>
            <button className="btn btn-primary" onClick={() => onNav('new')}>
              <Icon name="plus" size={14} stroke={2.2} /> Nueva orden
            </button>
          </div>
        </div>

        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 4,
          background: 'var(--bg-surface)', border: '1px solid var(--stroke-soft)',
          borderRadius: 8, width: 'fit-content', flexWrap: 'wrap' }}>
          {[
            ['todas',      'Todas'],
            ['enviada',    'Enviadas'],
            ['firmada',    'Firmadas'],
            ['pendiente',  'Pendientes'],
            ['conciliada', 'Conciliadas'],
            ['borrador',   'Borradores'],
          ].map(([k, label]) => (
            <button key={k}
              className={`btn btn-sm ${filterStatus === k ? 'btn-primary' : 'btn-ghost'}`}
              style={filterStatus === k ? {} : { border: 'none', background: 'transparent' }}
              onClick={() => setFilterStatus(k)}>
              {label}
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: filterStatus === k ? 'rgba(255,255,255,0.7)' : 'var(--fg-muted)',
                marginLeft: 4,
              }}>{statusCounts[k]}</span>
            </button>
          ))}
        </div>

        {/* Filter row */}
        <div className="card" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="input-icon-wrap" style={{ flex: 1, minWidth: 240, maxWidth: 360 }}>
            <Icon name="search" size={14} className="lead-icon" />
            <input className="input" placeholder="Buscar por proveedor, número o CUIT…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <FilterPill label="Proveedor" value={filterVendor} options={[
            ['todos', 'Todos'], ...PROVEEDORES.map(p => [p.id, p.razon])
          ]} onChange={setFilterVendor} />
          <FilterPill label="Período" value="mes" options={[['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['anio', '2026'], ['custom', 'Personalizado']]} />
          <FilterPill label="Monto" value="todos" options={[['todos', 'Todos'], ['p100k', '< $ 100K'], ['p500k', '$ 100K — 500K'], ['p1m', '> $ 500K']]} />
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fg-secondary)' }}>
            <strong style={{ color: 'var(--fg-primary)' }}>{filtered.length}</strong> resultados ·
            <strong style={{ color: 'var(--fg-brand)', marginLeft: 6 }}>
              {fmtCurrency(filtered.reduce((a, b) => a + b.total, 0))}
            </strong>
          </div>
        </div>

        {/* Orders table */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}><input type="checkbox" /></th>
                <th>Orden</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Categoría</th>
                <th style={{ textAlign: 'right' }}>Items</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Estado</th>
                <th>Firma</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 22).map(o => (
                <OrderRow key={o.id} order={o} onOpenOrder={onOpenOrder} />
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', borderTop: '1px solid var(--stroke-soft)', background: 'var(--neutral-50)', fontSize: 12 }}>
            <div style={{ color: 'var(--fg-secondary)' }}>Mostrando 1–{Math.min(22, filtered.length)} de {filtered.length}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" disabled><Icon name="arrow-left" size={12}/></button>
              <button className="btn btn-primary btn-sm">1</button>
              <button className="btn btn-ghost btn-sm">2</button>
              <button className="btn btn-ghost btn-sm">3</button>
              <button className="btn btn-ghost btn-sm"><Icon name="arrow-right" size={12}/></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderRow({ order, onOpenOrder }) {
  return (
    <tr onClick={() => onOpenOrder(order.id)}>
      <td onClick={e => e.stopPropagation()}><input type="checkbox" /></td>
      <td className="order-num">{order.id}</td>
      <td style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>{fmtDate(order.date)}</td>
      <td className="cell-cliente">
        {order.proveedor}
        <span className="cuit">{order.cuit}</span>
      </td>
      <td>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-secondary)' }}>
          <Icon name="tag" size={12} style={{ color: 'var(--fg-muted)' }} />
          {order.categoria}
        </span>
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--fg-secondary)' }}>
        {order.items.length} <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>items</span>
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--fg-brand)' }}>
        {fmtCurrency(order.total)}
      </td>
      <td><StatusBadge status={order.status}/></td>
      <td>
        {order.signedBy ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SigGlyph />
            <span style={{ fontSize: 11, color: 'var(--fg-secondary)' }}>JL</span>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontStyle: 'italic' }}>—</span>
        )}
      </td>
      <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right' }}>
        <button className="icon-btn"><Icon name="menu-dots" size={15} /></button>
      </td>
    </tr>
  );
}

function FilterPill({ label, value, options = [], onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
      border: '1px solid var(--stroke-soft)', borderRadius: 6, background: 'white',
      fontSize: 12, cursor: 'pointer', transition: 'border-color 180ms',
    }}>
      <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>{label}:</span>
      <select value={value} onChange={e => onChange && onChange(e.target.value)}
        style={{ border: 'none', background: 'transparent', fontWeight: 600, color: 'var(--fg-primary)', outline: 'none', cursor: 'pointer', maxWidth: 180 }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Icon name="chevron-down" size={12} style={{ color: 'var(--fg-muted)' }} />
    </div>
  );
}

// Tiny "signature" mark for the table cells (J. L. initials)
function SigGlyph({ width = 36, height = 16 }) {
  return (
    <svg width={width} height={height} viewBox="0 0 36 16" style={{ flexShrink: 0 }}>
      <path d="M2 12 C 4 4, 6 14, 9 8 S 14 2, 17 12 C 19 16, 21 6, 24 10 S 30 14, 34 6"
        stroke="#214576" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

window.OrdersList = OrdersList;
window.SigGlyph = SigGlyph;
