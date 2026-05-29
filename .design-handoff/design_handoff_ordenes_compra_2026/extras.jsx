// extras.jsx — Login, Email preview, Vendors stub, Drive page, Success modal
const { useState: useStateEX } = React;

function Login({ onSubmit }) {
  return (
    <div className="login-root" style={{
      display: 'grid', gridTemplateColumns: '1fr 480px', height: '100vh', overflow: 'hidden',
      background: 'var(--bg-page)',
    }}>
      <div className="login-brand-panel" style={{ position: 'relative', overflow: 'hidden', background: '#050555' }}>
        <img src={window.__resources.photoFacade} alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(5,5,85,0.85), rgba(5,5,85,0.55) 60%, rgba(5,5,85,0.85))' }} />
        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', padding: '48px 56px', color: 'white' }}>
          <img src={window.__resources.logoWhite} alt="TOPS" style={{ height: 40, width: 'auto', alignSelf: 'flex-start', display: 'block' }} />
          <div style={{ marginTop: 'auto', maxWidth: 560 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
              color: '#ff5560', marginBottom: 16,
            }}>
              Compras inteligentes · 2026
            </div>
            <h1 style={{
              fontSize: 52, fontWeight: 700, lineHeight: 1.04, margin: '0 0 18px', letterSpacing: '-0.015em',
              textTransform: 'uppercase', color: 'white',
            }}>
              Órdenes de compra,<br/>completamente digitales.
            </h1>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.78)', lineHeight: 1.5, marginBottom: 32, maxWidth: 480 }}>
              40 años operando en Barracas. Ahora cada compra que Verotin S.A. realiza queda registrada, firmada y conciliada con factura — desde una plataforma única.
            </p>
            <div style={{ display: 'flex', gap: 40, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.18)' }}>
              <Stat n="42" u="OC" l="Mayo 2026" />
              <Stat n="$ 24,8" u="M" l="Comprometido" />
              <Stat n="84 %" u="" l="Conciliación" />
            </div>
          </div>
        </div>
      </div>

      <div className="login-form-panel" style={{ display: 'flex', flexDirection: 'column', padding: '48px 56px', background: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <img src={window.__resources.logoColor} alt="TOPS" style={{ height: 28, width: 'auto', display: 'block' }} />
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>v.2026.05.25</span>
        </div>
        <div style={{ margin: 'auto 0' }}>
          <div className="eyebrow-tiny">Acceso corporativo</div>
          <h2 style={{ fontSize: 30, fontWeight: 700, color: 'var(--fg-brand)', margin: '0 0 8px', letterSpacing: '-0.005em' }}>
            Iniciá sesión
          </h2>
          <p style={{ fontSize: 14, color: 'var(--fg-secondary)', margin: '0 0 28px' }}>
            Usá tu cuenta corporativa @logisticatops.com para entrar al módulo de Compras.
          </p>

          <div className="field" style={{ marginBottom: 16 }}>
            <div className="field-label">Email corporativo</div>
            <div className="input-icon-wrap">
              <Icon name="mail" size={14} className="lead-icon" />
              <input className="input" placeholder="joseluis@logisticatops.com" defaultValue="joseluis@logisticatops.com" />
            </div>
          </div>

          <div className="field" style={{ marginBottom: 18 }}>
            <div className="field-label">Contraseña</div>
            <div className="input-icon-wrap">
              <Icon name="lock" size={14} className="lead-icon" />
              <input className="input" type="password" defaultValue="••••••••••" />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked />
              <span>Mantener sesión iniciada</span>
            </label>
            <a href="#" style={{ color: 'var(--fg-link)', fontWeight: 600 }}>¿Olvidaste tu contraseña?</a>
          </div>

          <button className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={onSubmit}>
            Ingresar al panel <Icon name="arrow-right" size={14} stroke={2.2} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--stroke-soft)' }} />
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>O</span>
            <div style={{ flex: 1, height: 1, background: 'var(--stroke-soft)' }} />
          </div>

          <button className="btn btn-ghost btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={onSubmit}>
            <GoogleG /> Continuar con Google Workspace
          </button>
        </div>

        <div style={{ marginTop: 'auto', fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          Verotin S.A. · CUIT 33-60489698-9<br/>
          Agustín Magaldi 1765, CABA · Argentina
        </div>
      </div>
    </div>
  );
}

function Stat({ n, u, l }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'white', letterSpacing: '-0.005em', lineHeight: 1 }}>
        {n}{u && <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.7)', marginLeft: 3 }}>{u}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginTop: 4 }}>{l}</div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18">
      <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.78 2.73v2.27h2.89c1.69-1.56 2.67-3.85 2.67-6.64Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.47-.81 5.95-2.18l-2.89-2.27c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.93v2.34A9 9 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.95 10.7A5.41 5.41 0 0 1 3.66 9c0-.59.1-1.16.29-1.7V4.96H.93A9 9 0 0 0 0 9c0 1.45.35 2.83.93 4.04l3.02-2.34Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.32 0 2.51.46 3.45 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .93 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

/* ====== Email preview ====== */
function EmailPreview() {
  const order = ORDERS[0];
  return (
    <div className="content scroll-area">
      <div className="content-narrow">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Plantillas · Comunicación automática</div>
            <h1 className="page-title">Email al proveedor</h1>
            <p className="page-subtitle">Lo que recibe el proveedor al emitir una OC. Se envía automáticamente al confirmar la firma del Director.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost"><Icon name="pen" size={13}/> Editar plantilla</button>
            <button className="btn btn-primary"><Icon name="send" size={13}/> Enviar prueba</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
          <div>
            <EmailMockup order={order} />
          </div>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Reglas de envío automático</div>

            <RuleRow icon="mail" label="Siempre" who="Email del proveedor" tag="Proveedor" hilite />
            <RuleRow icon="mail" label="Siempre — copia" who="joseluis@logisticatops.com" tag="Dirección" />
            <RuleRow icon="mail" label="Siempre — copia" who="ruth@logisticatops.com" tag="Administración" />

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--stroke-soft)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 10 }}>
                Adjuntos
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Attachment name={order.id + '.pdf'} kind="PDF" size="312 KB" />
                <Attachment name={order.id + '-firma.png'} kind="PNG" size="34 KB" />
              </div>
            </div>

            <div style={{ marginTop: 22, padding: 14, background: 'rgba(33,69,118,0.06)', borderRadius: 8, fontSize: 12, color: 'var(--fg-secondary)' }}>
              <Icon name="cloud-check" size={13} style={{ color: 'var(--tops-blue-700)', verticalAlign: '-2px', marginRight: 4 }} />
              <strong style={{ color: 'var(--fg-primary)' }}>Sincronización automática:</strong> cada OC se guarda en Google Drive bajo
              <span className="mono" style={{ color: 'var(--tops-blue-700)' }}> /Órdenes de Compra 2026/</span> organizada por mes y proveedor.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailMockup({ order }) {
  const prov = PROVEEDORES.find(p => p.id === order.providerId) || {};
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--stroke-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['#FF5F57','#FEBC2E','#28C840'].map(c => <span key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', margin: '0 auto' }}>Bandeja de entrada — {prov.email}</div>
      </div>

      <div style={{ padding: '22px 24px 14px', borderBottom: '1px solid var(--stroke-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--tops-blue-900)', color: 'white',
            display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>T</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 2 }}>
              Logística TOPS · Compras
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              compras@logisticatops.com → {prov.email}, ruth@logisticatops.com, joseluis@logisticatops.com
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>25 may. 2026 — 11:14</div>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--fg-brand)', margin: 0 }}>
          Orden de Compra {order.id} — {order.proveedor}
        </h3>
      </div>

      <div style={{ padding: '24px 28px', fontSize: 13, color: 'var(--fg-primary)', lineHeight: 1.65 }}>
        <p style={{ margin: '0 0 14px' }}>Estimado/a <strong>{prov.contacto}</strong>,</p>
        <p style={{ margin: '0 0 14px' }}>
          Adjuntamos la orden de compra <strong>{order.id}</strong> emitida por <strong>Verotin S.A. (Logística TOPS)</strong> con fecha {fmtDate(order.date)}. Esperamos su confirmación de stock y fecha de entrega.
        </p>

        <div style={{ background: 'var(--neutral-50)', padding: 16, borderRadius: 8, margin: '14px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
          <SummaryCell label="Orden" value={order.id} mono />
          <SummaryCell label="Fecha" value={fmtDate(order.date)} />
          <SummaryCell label="Cond. pago" value={order.condPago} />
          <SummaryCell label="Entrega en" value={order.destino} />
          <SummaryCell label="Items" value={order.items.length + ' productos'} />
          <SummaryCell label="Total" value={fmtCurrency(order.total) + ' (IVA inc.)'} bold />
        </div>

        <p style={{ margin: '0 0 14px' }}>
          La orden fue firmada digitalmente por <strong>José Luis Battaglia</strong>, Director de Operaciones, bajo el número único <span className="mono" style={{ color: 'var(--tops-blue-700)' }}>{order.id}</span>. Podés validar la autenticidad escaneando el código QR del comprobante.
        </p>

        <a style={{ display: 'inline-block', background: 'var(--tops-red)', color: 'white', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', textDecoration: 'none', marginBottom: 14 }}>
          Ver Orden de Compra (PDF) →
        </a>

        <p style={{ margin: '0 0 14px' }}>
          Para coordinar entrega, podés responder este email o contactar a <a href="#" style={{ color: 'var(--tops-blue-700)' }}>ruth@logisticatops.com</a> · <strong>(011) 4302-3944</strong>.
        </p>

        <p style={{ margin: '20px 0 0', color: 'var(--fg-secondary)' }}>
          Saludos cordiales,<br/>
          <strong style={{ color: 'var(--fg-primary)' }}>José Luis Battaglia</strong> — Director de Operaciones<br/>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Verotin S.A. · Agustín Magaldi 1765, CABA · www.logisticatops.com</span>
        </p>
      </div>

      <div style={{ padding: '14px 24px', borderTop: '1px solid var(--stroke-soft)', background: 'var(--neutral-50)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Attachment name={order.id + '.pdf'} kind="PDF" size="312 KB" inline />
        <Attachment name={order.id + '-firma.png'} kind="PNG" size="34 KB" inline />
      </div>
    </div>
  );
}

function SummaryCell({ label, value, mono, bold }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 2 }}>{label}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: bold ? 14 : 13, fontWeight: bold ? 700 : 500, color: bold ? 'var(--fg-brand)' : 'var(--fg-primary)' }}>{value}</div>
    </div>
  );
}

function RuleRow({ icon, label, who, tag, hilite }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--stroke-soft)' }}>
      <div style={{ width: 28, height: 28, borderRadius: 6,
        background: hilite ? 'rgba(201,8,18,0.08)' : 'var(--neutral-100)',
        color: hilite ? 'var(--tops-red)' : 'var(--fg-secondary)',
        display: 'grid', placeItems: 'center' }}>
        <Icon name={icon} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{who}</div>
      </div>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        padding: '2px 6px', borderRadius: 3,
        background: 'var(--neutral-100)', color: 'var(--fg-secondary)',
      }}>{tag}</span>
    </div>
  );
}

function Attachment({ name, kind, size, inline }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: inline ? '6px 10px' : '8px 12px',
      background: 'white',
      border: '1px solid var(--stroke-soft)',
      borderRadius: 6,
      fontSize: 12,
      flex: inline ? '0 0 auto' : '1',
    }}>
      <div style={{ width: 24, height: 28, background: 'var(--tops-red)', borderRadius: 3,
        display: 'grid', placeItems: 'center', color: 'white', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0 }}>
        {kind}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{size}</div>
      </div>
      <Icon name="download" size={14} style={{ color: 'var(--fg-muted)' }} />
    </div>
  );
}

/* ====== Vendors page ====== */
function Vendors({ onOpenOrder }) {
  return (
    <div className="content scroll-area">
      <div className="content-narrow">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Maestro · 38 proveedores</div>
            <h1 className="page-title">Proveedores</h1>
            <p className="page-subtitle">CRM de proveedores recurrentes. CUIT, contacto, condiciones de pago y rendimiento histórico.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost"><Icon name="export" size={14} /> Exportar</button>
            <button className="btn btn-primary"><Icon name="plus" size={14} stroke={2.2} /> Nuevo proveedor</button>
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Categoría</th>
                <th>Contacto</th>
                <th>Cond. pago</th>
                <th style={{ textAlign: 'right' }}>OC histórico</th>
                <th style={{ textAlign: 'right' }}>Comprado YTD</th>
                <th>Última OC</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {PROVEEDORES.map(p => {
                const myOrders = ORDERS.filter(o => o.providerId === p.id);
                const ytd = myOrders.reduce((a, b) => a + b.total, 0);
                return (
                  <tr key={p.id} onClick={() => myOrders[0] && onOpenOrder(myOrders[0].id)}>
                    <td className="cell-cliente">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--tops-blue-700)', color: 'white',
                          display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                          {p.avatar}
                        </div>
                        <div>
                          {p.razon}
                          <span className="cuit">{p.cuit}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--fg-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Icon name="tag" size={12} style={{ color: 'var(--fg-muted)' }} />{p.categoria}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600 }}>{p.contacto}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.telefono}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>{p.cond}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{p.orders} OC</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--fg-brand)' }}>{fmtCurrency(ytd)}</td>
                    <td style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>{fmtDate(new Date(p.lastOrder))}</td>
                    <td><button className="icon-btn"><Icon name="menu-dots" size={15}/></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ====== Drive page (folder view) ====== */
function DrivePage() {
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo'];
  return (
    <div className="content scroll-area">
      <div className="content-narrow">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Almacenamiento automático</div>
            <h1 className="page-title">Órdenes de Compra 2026</h1>
            <p className="page-subtitle">Carpeta sincronizada con Google Drive. Cada OC se guarda en /Mes/Proveedor/. Sincronización en tiempo real.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost"><Icon name="refresh" size={14}/> Sincronizar</button>
            <button className="btn btn-primary"><Icon name="cloud" size={14}/> Abrir en Drive</button>
          </div>
        </div>

        <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(14,124,58,0.10)', color: 'var(--status-success)',
            display: 'grid', placeItems: 'center' }}>
            <Icon name="cloud-check" size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Google Drive · joseluis@logisticatops.com</div>
            <div style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>324 órdenes sincronizadas · 2,4 GB · última sync hace 8 min</div>
          </div>
          <div className="badge badge-success"><span className="dot"/>Conectado</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {months.map(m => (
            <div key={m} className="card card-pad card-hover" style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 40, height: 32, background: 'var(--tops-blue-900)', borderRadius: 4,
                  display: 'grid', placeItems: 'center', position: 'relative' }}>
                  <span style={{ position: 'absolute', top: -4, left: 6, width: 14, height: 6, background: 'var(--tops-blue-900)', borderRadius: '2px 2px 0 0' }}/>
                  <Icon name="cart" size={16} style={{ color: 'white' }}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>{m} 2026</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{m === 'Mayo' ? '42 órdenes · $ 24,8 M' : Math.floor(Math.random() * 40 + 30) + ' órdenes'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {PROVEEDORES.slice(0, 4).map(p => (
                  <span key={p.id} style={{
                    fontSize: 10, fontWeight: 600, color: 'var(--fg-secondary)',
                    padding: '3px 8px', borderRadius: 999,
                    background: 'var(--neutral-50)',
                  }}>{p.avatar}</span>
                ))}
                <span style={{ fontSize: 10, color: 'var(--fg-muted)', padding: '3px 4px' }}>+{PROVEEDORES.length - 4}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ====== Generic stub ====== */
function Stub({ title, subtitle, icon }) {
  return (
    <div className="content scroll-area">
      <div className="content-narrow">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Próximamente</div>
            <h1 className="page-title">{title}</h1>
            <p className="page-subtitle">{subtitle}</p>
          </div>
        </div>
        <div className="card" style={{ padding: 60, textAlign: 'center', color: 'var(--fg-secondary)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--neutral-100)',
            color: 'var(--fg-muted)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            <Icon name={icon} size={24} stroke={1.4}/>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 6 }}>Sección en construcción</div>
          <div style={{ fontSize: 13, maxWidth: 380, margin: '0 auto' }}>
            Esta vista se desarrollará en la siguiente iteración del prototipo. Volvé al dashboard o creá una nueva orden de compra.
          </div>
        </div>
      </div>
    </div>
  );
}

window.Login = Login;
window.EmailPreview = EmailPreview;
window.Vendors = Vendors;
window.DrivePage = DrivePage;
window.Stub = Stub;
