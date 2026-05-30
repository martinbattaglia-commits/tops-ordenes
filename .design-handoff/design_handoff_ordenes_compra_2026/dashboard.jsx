// dashboard.jsx — Panel administrativo (Órdenes de Compra)
const { useMemo: useMemoD } = React;

function Dashboard({ onNav, onOpenOrder }) {
  const recent = ORDERS.slice(0, 6);

  return (
    <div className="content scroll-area">
      <div className="content-narrow">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Panel administrativo · Mayo 2026</div>
            <h1 className="page-title">Buen día, José Luis.</h1>
            <p className="page-subtitle">9 órdenes emitidas este mes. 2 pendientes de tu firma · 4 pendientes de factura del proveedor.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost"><Icon name="export" size={14} /> Exportar mes</button>
            <button className="btn btn-primary" onClick={() => onNav('new')}><Icon name="plus" size={14} stroke={2.2} /> Nueva orden</button>
          </div>
        </div>

        {/* KPIs */}
        <div className="kpi-grid">
          <KPI label="Órdenes del mes" value="42" delta="+18.4%" vs="vs abril" spark={[3,4,5,3,6,7,5,8,9,11,12,10]} />
          <KPI label="Monto comprometido" value="$ 24,8" unit="M" delta="+9.2%" vs="vs abril" spark={[10,12,14,16,18,21,24,28,30,34,38,42]} accent />
          <KPI label="Proveedores activos" value="18" unit="/ 38" delta="+2" vs="nuevos" spark={[12,12,13,14,14,15,15,16,17,17,18,18]} />
          <KPI label="Tasa de conciliación" value="84" unit="%" delta="+6.2 pts" vs="vs abril" spark={[68,70,72,74,76,77,78,80,81,82,83,84]} />
        </div>

        {/* Charts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 16 }}>
          <SpendChart />
          <CategoryMix />
        </div>

        {/* Recent + Alerts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
          <RecentOrdersCard orders={recent} onNav={onNav} onOpenOrder={onOpenOrder} />
          <AlertsCard onOpenOrder={onOpenOrder} />
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, unit, delta, vs, spark = [], accent }) {
  const up = delta && delta.startsWith('+');
  return (
    <div className={`card kpi ${accent ? 'featured-stroke' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}{unit && <span className="unit">{unit}</span>}</div>
      <div className={`kpi-delta ${up ? 'up' : 'down'}`}>
        <Icon name={up ? 'trend-up' : 'trend-down'} size={13} stroke={2} />
        {delta}<span className="vs">{vs}</span>
      </div>
      {spark.length > 0 && <Sparkline data={spark} color={accent ? '#C90812' : '#214576'} />}
    </div>
  );
}

function Sparkline({ data, color = '#214576' }) {
  const w = 70, h = 28;
  const max = Math.max(...data), min = Math.min(...data);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - ((v - min) / (max - min || 1)) * (h - 4) - 2]);
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const last = pts[pts.length - 1];
  const fillD = d + ` L${w},${h} L0,${h} Z`;
  const id = `g${color.slice(1)}-${Math.random().toString(36).slice(2, 6)}`;
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={color} />
    </svg>
  );
}

function SpendChart() {
  // 6 months stacked bars (emitida vs conciliada)
  const months = ['Dic ‘25', 'Ene ‘26', 'Feb ‘26', 'Mar ‘26', 'Abr ‘26', 'May ‘26'];
  const emitida    = [14.2, 16.8, 19.4, 18.1, 22.7, 24.8]; // millones
  const conciliada = [12.8, 15.6, 17.9, 16.4, 19.8, 20.8];

  const w = 720, h = 240, pad = { l: 44, r: 16, t: 20, b: 32 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const max = 28;
  const barGroupW = innerW / months.length;
  const barW = 18;
  const yFor = (v) => pad.t + innerH - (v / max) * innerH;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Compras por mes</div>
          <div className="card-sub">Últimos 6 meses · monto en millones de pesos</div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: '#050555', borderRadius: 2 }}/>
            <span style={{ color: 'var(--fg-secondary)' }}>Emitidas</span>
            <strong style={{ color: 'var(--fg-primary)', marginLeft: 4 }}>$ 24,8 M</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: '#C90812', borderRadius: 2 }}/>
            <span style={{ color: 'var(--fg-secondary)' }}>Conciliadas</span>
            <strong style={{ color: 'var(--fg-primary)', marginLeft: 4 }}>$ 20,8 M</strong>
          </div>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 240 }} preserveAspectRatio="none">
          {/* y grid */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <g key={i}>
              <line x1={pad.l} y1={pad.t + innerH * p} x2={w - pad.r} y2={pad.t + innerH * p} stroke="#EEF1F6" strokeWidth="1" />
              <text x={pad.l - 8} y={pad.t + innerH * p + 4} fontSize="10" fill="#8A94A6" textAnchor="end" fontFamily="Gotham, sans-serif">
                $ {Math.round(max * (1 - p))} M
              </text>
            </g>
          ))}
          {/* bars */}
          {months.map((m, i) => {
            const cx = pad.l + barGroupW * i + barGroupW / 2;
            return (
              <g key={m}>
                <rect x={cx - barW - 2} y={yFor(emitida[i])} width={barW} height={innerH - (yFor(emitida[i]) - pad.t)}
                  fill="#050555" rx="2" />
                <rect x={cx + 2} y={yFor(conciliada[i])} width={barW} height={innerH - (yFor(conciliada[i]) - pad.t)}
                  fill="#C90812" rx="2" opacity="0.85" />
                <text x={cx} y={h - 10} fontSize="11" fill="#8A94A6" textAnchor="middle" fontFamily="Gotham, sans-serif">
                  {m}
                </text>
                {i === months.length - 1 && (
                  <>
                    <text x={cx - barW/2 - 2} y={yFor(emitida[i]) - 6} fontSize="10" fontWeight="700"
                      fill="#050555" textAnchor="middle" fontFamily="Gotham, sans-serif">{emitida[i]}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function CategoryMix() {
  const items = [
    { label: 'Combustible',       value: 28, color: '#050555' },
    { label: 'Insumos depósito',  value: 22, color: '#214576' },
    { label: 'Repuestos',         value: 16, color: '#3a6db0' },
    { label: 'IT / Tecnología',   value: 12, color: '#C90812' },
    { label: 'ANMAT / Limpieza',  value: 11, color: '#8A94A6' },
    { label: 'Otros',             value: 11, color: '#C2CAD6' },
  ];
  const total = items.reduce((a, b) => a + b.value, 0);
  let acc = 0;
  const r = 64, c = 80, sw = 18;
  const circ = 2 * Math.PI * r;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Compras por categoría</div>
          <div className="card-sub">Mayo · participación %</div>
        </div>
        <button className="btn btn-ghost btn-sm">Ver detalle</button>
      </div>
      <div style={{ padding: '24px 22px', display: 'flex', gap: 24, alignItems: 'center' }}>
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle cx={c} cy={c} r={r} fill="none" stroke="#F7F8FB" strokeWidth={sw}/>
          {items.map((it, i) => {
            const pct = it.value / total;
            const len = pct * circ;
            const offset = acc * circ;
            acc += pct;
            return (
              <circle key={i}
                cx={c} cy={c} r={r}
                fill="none"
                stroke={it.color}
                strokeWidth={sw}
                strokeDasharray={`${len} ${circ}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${c} ${c})`}
                strokeLinecap="butt"
              />
            );
          })}
          <text x={c} y={c - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="#050555" fontFamily="Gotham, sans-serif">$24,8</text>
          <text x={c} y={c + 14} textAnchor="middle" fontSize="10" fill="#8A94A6" fontFamily="Gotham, sans-serif" letterSpacing="1">MILLONES</text>
        </svg>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, flexShrink: 0 }}/>
              <span style={{ flex: 1, color: 'var(--fg-primary)', fontWeight: 500 }}>{it.label}</span>
              <span style={{ color: 'var(--fg-secondary)' }}>{it.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecentOrdersCard({ orders, onNav, onOpenOrder }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Últimas órdenes de compra</div>
          <div className="card-sub">Emitidas en los últimos 7 días</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onNav('orders')}>
          Ver todas <Icon name="arrow-right" size={12} stroke={2.2} />
        </button>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Orden</th>
            <th>Proveedor</th>
            <th>Categoría</th>
            <th style={{ textAlign: 'right' }}>Total</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id} onClick={() => onOpenOrder(o.id)}>
              <td className="order-num">{o.id}</td>
              <td className="cell-cliente">
                {o.proveedor}
                <span className="cuit">{o.cuit}</span>
              </td>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-secondary)' }}>
                  <Icon name="tag" size={12} style={{ color: 'var(--fg-muted)' }} />
                  {o.categoria}
                </span>
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--fg-brand)' }}>{fmtCurrency(o.total)}</td>
              <td><StatusBadge status={o.status}/></td>
              <td style={{ textAlign: 'right' }}>
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); }}>
                  <Icon name="menu-dots" size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.borrador;
  return <span className={`badge ${m.cls}`}><span className="dot" />{m.label}</span>;
}

function AlertsCard({ onOpenOrder }) {
  const alerts = [
    { kind: 'warn', title: 'Sin factura del proveedor', detail: '4 órdenes con más de 14 días', icon: 'wallet', count: 4 },
    { kind: 'info', title: 'Pendientes de firma',        detail: 'Aguardan revisión de Dirección', icon: 'pen', count: 2 },
    { kind: 'danger', title: 'Diferencia contra factura', detail: 'OC-2026-0339 — $ 18.400 de más', icon: 'bolt', count: 1 },
    { kind: 'ok', title: 'Sincronización Drive',         detail: 'Última: hoy 11:14 · OK', icon: 'cloud-check', count: 0 },
  ];
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Alertas administrativas</div>
          <div className="card-sub">Acciones que requieren atención</div>
        </div>
      </div>
      <div style={{ padding: '8px 22px 18px' }}>
        {alerts.map((a, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0',
            borderBottom: i === alerts.length - 1 ? 'none' : '1px solid var(--stroke-soft)',
            cursor: a.count > 0 ? 'pointer' : 'default',
          }} onClick={() => a.count > 0 && onOpenOrder(ORDERS[0].id)}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: a.kind === 'warn' ? 'rgba(180,83,9,0.12)'
                : a.kind === 'danger' ? 'rgba(201,8,18,0.10)'
                : a.kind === 'info' ? 'rgba(33,69,118,0.10)'
                : 'rgba(14,124,58,0.10)',
              color: a.kind === 'warn' ? '#B45309'
                : a.kind === 'danger' ? '#C90812'
                : a.kind === 'info' ? '#214576'
                : '#0E7C3A',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <Icon name={a.icon} size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-primary)' }}>{a.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{a.detail}</div>
            </div>
            {a.count > 0 && (
              <div style={{
                fontSize: 13, fontWeight: 700,
                color: a.kind === 'warn' ? '#B45309' : a.kind === 'danger' ? '#C90812' : '#214576',
                fontVariantNumeric: 'tabular-nums',
              }}>{a.count}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

window.Dashboard = Dashboard;
window.StatusBadge = StatusBadge;
