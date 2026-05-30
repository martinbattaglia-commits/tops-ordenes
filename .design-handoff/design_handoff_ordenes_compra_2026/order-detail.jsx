// order-detail.jsx — Detail view + PDF-style preview (Orden de Compra)
const { useState: useStateOD } = React;

function OrderDetail({ orderId, onBack, onShare }) {
  const order = ORDERS.find(o => o.id === orderId) || ORDERS[0];

  return (
    <div className="content scroll-area" style={{ padding: 0 }}>
      <div style={{ padding: '24px 32px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <Icon name="arrow-left" size={13} /> Órdenes
        </button>
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>/</span>
        <span style={{ fontSize: 12, color: 'var(--fg-secondary)' }} className="mono">{order.id}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm"><Icon name="qr" size={13}/> QR</button>
          <button className="btn btn-ghost btn-sm"><Icon name="download" size={13}/> Descargar PDF</button>
          <button className="btn btn-ghost btn-sm" onClick={onShare}><Icon name="send" size={13}/> Reenviar email</button>
          <button className="btn btn-primary btn-sm"><Icon name="copy" size={13}/> Duplicar</button>
        </div>
      </div>

      <div style={{ padding: '20px 32px 60px', display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24, alignItems: 'flex-start' }}>
        {/* Left meta column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 0 }}>
          <div className="card card-pad">
            <div className="eyebrow-tiny" style={{ marginBottom: 8 }}>{order.id}</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-brand)', margin: '0 0 4px', letterSpacing: '-0.005em' }}>
              {order.proveedor}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--fg-secondary)', marginBottom: 14 }}>{order.cuit}</div>
            <StatusBadge status={order.status} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 18 }}>
              <MetaCell label="Fecha" value={fmtDate(order.date)} />
              <MetaCell label="Cond. de pago" value={order.condPago} />
              <MetaCell label="Destino" value={order.depot} />
              <MetaCell label="Entrega" value={order.entrega} />
            </div>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--stroke-soft)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>Total</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-brand)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.005em' }}>
                  {fmtCurrency(order.total)}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--fg-muted)' }}>
                <div>Neto · {fmtCurrency(order.neto)}</div>
                <div>IVA 21% · {fmtCurrency(order.iva)}</div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 12 }}>
              Emisor autorizado
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--tops-red)', color: 'white',
                display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>
                JL
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{order.emisor.name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{order.emisor.role}</div>
              </div>
              {order.signedBy && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--status-success)', fontWeight: 700 }}>
                  <Icon name="check-circle" size={13} stroke={2.2}/>
                  Firmada
                </div>
              )}
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 14 }}>
              Trazabilidad
            </div>
            <Timeline order={order} />
          </div>

          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
                Envíos automáticos
              </div>
              <button className="btn btn-ghost btn-sm" onClick={onShare} style={{ padding: '3px 8px', fontSize: 11 }}>
                <Icon name="refresh" size={11}/> Reenviar
              </button>
            </div>
            <EmailChip email={PROVEEDORES.find(p => p.id === order.providerId)?.email || ''} delivered opened tag="Proveedor" />
            <EmailChip email="joseluis@logisticatops.com" delivered opened tag="Dirección" />
            <EmailChip email="ruth@logisticatops.com" delivered tag="Administración" />
          </div>

          <div className="card card-pad" style={{
            background: 'linear-gradient(135deg, rgba(33,69,118,0.04), rgba(5,5,85,0.02))',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Icon name="cloud-check" size={16} style={{ color: 'var(--status-success)' }} />
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tops-blue-700)' }}>
                Sincronizado en Drive
              </div>
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--fg-secondary)', wordBreak: 'break-all', lineHeight: 1.5 }}>
              /Logística TOPS/{order.driveFolder}/{order.id}.pdf
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--fg-muted)', marginTop: 6 }}>
              Última sincronización: {fmtDateTime(order.signedAt || order.date)}
            </div>
          </div>
        </div>

        {/* Right PDF preview */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
            <div>
              <div className="eyebrow-tiny">Vista previa · A4</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg-brand)' }}>
                Orden de Compra
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-surface)',
              border: '1px solid var(--stroke-soft)', borderRadius: 6, fontSize: 11 }}>
              <button className="btn btn-primary btn-sm" style={{ padding: '4px 10px' }}>PDF</button>
              <button className="btn btn-ghost btn-sm" style={{ padding: '4px 10px', border: 'none' }}>Email</button>
              <button className="btn btn-ghost btn-sm" style={{ padding: '4px 10px', border: 'none' }}>WhatsApp</button>
            </div>
          </div>
          <PdfPreview order={order} />
        </div>
      </div>
    </div>
  );
}

function MetaCell({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)' }}>{value}</div>
    </div>
  );
}

function Timeline({ order }) {
  const events = [
    { t: order.recibido ? fmtDateTime(new Date(order.date.getTime() + 86400000)) : '—', label: 'Recibido + factura', by: order.recibido || 'Pendiente', done: !!order.recibido, icon: 'check-circle' },
    { t: order.signedAt ? fmtDateTime(order.signedAt) : '—', label: 'Email enviado',  by: '3 destinatarios', done: ['enviada','conciliada'].includes(order.status), icon: 'send' },
    { t: order.signedAt ? fmtDateTime(order.signedAt) : '—', label: 'Firma digital',  by: order.signedBy || 'Pendiente', done: !!order.signedBy, icon: 'pen' },
    { t: fmtDateTime(order.date), label: 'OC generada', by: order.emisor.name, done: true, icon: 'plus' },
  ];
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: 12, top: 6, bottom: 6, width: 2, background: 'var(--neutral-100)' }} />
      {events.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12, position: 'relative' }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: e.done ? 'var(--status-success)' : 'var(--neutral-100)',
            color: e.done ? 'white' : 'var(--fg-muted)',
            display: 'grid', placeItems: 'center',
            zIndex: 1, flexShrink: 0,
            border: '3px solid white',
          }}>
            <Icon name={e.icon} size={12} stroke={2.4} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)' }}>{e.label}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{e.t === '—' ? 'Pendiente' : e.t} · {e.by}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmailChip({ email, delivered, opened, tag }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px',
      borderRadius: 6,
      marginBottom: 6,
      background: 'var(--neutral-50)',
    }}>
      <Icon name="mail" size={13} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'var(--fg-primary)', fontWeight: 500, flex: 1, minWidth: 0,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {email}
      </span>
      {tag && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--fg-muted)', padding: '2px 6px', borderRadius: 3, background: 'white',
        border: '1px solid var(--stroke-soft)' }}>{tag}</span>}
      {delivered && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0, fontSize: 10, color: opened ? 'var(--status-success)' : 'var(--fg-muted)', fontWeight: 600 }}>
          <Icon name="check" size={11} stroke={2.4} />
          {opened && <Icon name="check" size={11} stroke={2.4} style={{ marginLeft: -7 }} />}
        </span>
      )}
    </div>
  );
}

function PdfPreview({ order }) {
  const prov = PROVEEDORES.find(p => p.id === order.providerId) || {};
  return (
    <div className="pdf-page">
      {/* Top accent bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'var(--tops-red)' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        borderBottom: '2px solid var(--tops-blue-900)', paddingBottom: 14, marginBottom: 16, marginTop: 6 }}>
        <div>
          <img src={window.__resources.logoColor} alt="TOPS" style={{ height: 38, marginBottom: 8, display: 'block' }} />
          <div style={{ fontSize: 9, color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--fg-primary)' }}>Verotin S.A.</strong> · CUIT 33-60489698-9 · IVA Responsable Inscripto<br/>
            Agustín Magaldi 1765 (C1286AFM) — CABA · Argentina<br/>
            Tel/Fax: (011) 4302-3944 / 3541 / 9710 · www.logisticatops.com
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--tops-red)', marginBottom: 6 }}>
            Orden de Compra
          </div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-brand)', marginBottom: 6, letterSpacing: '-0.01em' }}>
            {order.id}
          </div>
          <div style={{ fontSize: 9, color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
            Fecha emisión: <strong style={{ color: 'var(--fg-primary)' }}>{fmtDate(order.date)}</strong><br/>
            Cond. de pago: <strong style={{ color: 'var(--fg-primary)' }}>{order.condPago}</strong><br/>
            Entrega: <strong style={{ color: 'var(--fg-primary)' }}>{order.entrega}</strong>
          </div>
        </div>
      </div>

      {/* Proveedor */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 6 }}>
          Proveedor
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr 1fr', gap: 14, fontSize: 11 }}>
          <PdfRow label="Razón Social" value={order.proveedor} bold />
          <PdfRow label="C.U.I.T." value={order.cuit} />
          <PdfRow label="Contacto" value={prov.contacto || '—'} />
          <PdfRow label="Domicilio" value={prov.domicilio || '—'} />
          <PdfRow label="Teléfono" value={prov.telefono || '—'} />
          <PdfRow label="Email" value={prov.email || '—'} />
        </div>
      </div>

      {/* Destino */}
      <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--neutral-50)', borderRadius: 4,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, fontSize: 10.5 }}>
        <PdfRow label="Sírvanse entregar en" value={order.destino} bold />
        <PdfRow label="Solicitado por" value={order.emisor.name} />
        <PdfRow label="Cargo" value="Director de Operaciones" />
        <PdfRow label="Categoría" value={order.categoria} />
      </div>

      {/* Service table */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 6 }}>
          Detalle — Sírvanse por este medio suministrarnos los siguientes artículos
        </div>
        <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--tops-blue-900)', color: 'white' }}>
              <th style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, letterSpacing: '0.04em', width: 28 }}>N°</th>
              <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, letterSpacing: '0.04em', width: 50 }}>Cant.</th>
              <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, letterSpacing: '0.04em', width: 40 }}>Un.</th>
              <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, letterSpacing: '0.04em' }}>Detalle</th>
              <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, letterSpacing: '0.04em' }}>P. Unit.</th>
              <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, letterSpacing: '0.04em' }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--stroke-soft)' }}>
                <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--fg-muted)' }}>{i + 1}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{it.qty}</td>
                <td style={{ padding: '7px 10px', color: 'var(--fg-secondary)' }}>{it.unit}</td>
                <td style={{ padding: '7px 10px', fontWeight: 500 }}>
                  {it.label}
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>SKU {it.sku}</div>
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(it.price)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--fg-brand)' }}>{fmtCurrency(it.total)}</td>
              </tr>
            ))}
            {/* Filler rows for paper-form feel */}
            {Array.from({ length: Math.max(0, 5 - order.items.length) }).map((_, i) => (
              <tr key={'f' + i} style={{ borderBottom: '1px solid var(--stroke-soft)', height: 24 }}>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--neutral-300)' }}>{order.items.length + i + 1}</td>
                <td colSpan="5"></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14, marginBottom: 14 }}>
        <div style={{ paddingTop: 4 }}>
          <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 4 }}>Observaciones</div>
          <div style={{ fontSize: 10, color: 'var(--fg-primary)', lineHeight: 1.6, padding: '8px 10px', background: 'var(--neutral-50)', borderRadius: 4, minHeight: 60 }}>
            {order.observ || 'Sin observaciones.'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', color: 'var(--fg-secondary)' }}>
            <span>Subtotal neto</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-primary)', fontWeight: 600 }}>{fmtCurrency(order.neto)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', color: 'var(--fg-secondary)' }}>
            <span>IVA 21%</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-primary)', fontWeight: 600 }}>{fmtCurrency(order.iva)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0 0',
            borderTop: '1.5px solid var(--tops-blue-900)', marginTop: 4, color: 'var(--fg-brand)', fontWeight: 700 }}>
            <span>TOTAL</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 15 }}>{fmtCurrency(order.total)}</span>
          </div>
        </div>
      </div>

      {/* Footer: signature + receipt + QR */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 16, alignItems: 'flex-end',
        paddingTop: 12, borderTop: '1px solid var(--stroke-soft)' }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 6 }}>
            Autorizado por
          </div>
          <div style={{ borderBottom: '1px solid var(--neutral-900)', height: 44, position: 'relative' }}>
            {order.signedBy && <ScriptSignature />}
          </div>
          <div style={{ fontSize: 9, color: 'var(--fg-secondary)', marginTop: 4 }}>
            {order.signedBy ? <><strong style={{ color: 'var(--fg-primary)' }}>{order.signedBy}</strong> · Director de Operaciones<br/>{fmtDateTime(order.signedAt)}</> : 'Pendiente de firma'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 6 }}>
            Recibido y verificado por
          </div>
          <div style={{ borderBottom: '1px solid var(--neutral-900)', height: 44 }} />
          <div style={{ fontSize: 9, color: 'var(--fg-secondary)', marginTop: 4 }}>
            {order.recibido ? <><strong style={{ color: 'var(--fg-primary)' }}>{order.recibido}</strong><br/>Factura {order.facturaId}</> : 'Completar al ingreso de mercadería'}
          </div>
        </div>
        <QrPlaceholder text={order.id} />
      </div>

      {/* Disclaimer */}
      <div style={{ marginTop: 12, padding: 8, background: 'var(--neutral-50)', borderRadius: 4, fontSize: 8, color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--fg-primary)' }}>CONDICIONES:</strong> esta orden de compra es válida únicamente firmada digitalmente por José Luis Battaglia, Director de Operaciones de Verotin S.A. Validar autenticidad escaneando el QR del comprobante. Hash sha256: <span className="mono">a7d3f29c…</span> · ID Drive: <span className="mono">1xKp9_…</span>
      </div>
    </div>
  );
}

function PdfRow({ label, value, bold }) {
  return (
    <div>
      <div style={{ fontSize: 8, fontWeight: 500, color: 'var(--fg-muted)', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: bold ? 700 : 500, color: 'var(--fg-primary)' }}>{value}</div>
    </div>
  );
}

function ScriptSignature() {
  // Hand-drawn "José Luis" signature SVG
  return (
    <svg viewBox="0 0 240 60" style={{ position: 'absolute', bottom: -2, left: 8, width: 180, height: 50 }}>
      <path d="M8 36 C 14 14, 22 22, 28 30 C 34 38, 30 18, 42 20 C 56 22, 50 40, 62 36 C 72 32, 66 18, 80 22 C 92 26, 86 42, 102 38 C 118 34, 108 16, 124 18 C 138 20, 132 38, 146 32 C 164 24, 152 16, 174 20 C 192 24, 188 36, 210 24"
        stroke="#214576" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M46 46 Q 90 54, 140 44"
        stroke="#214576" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function QrPlaceholder({ text }) {
  // Pseudo-QR pattern - deterministic dots
  const seed = (text || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const cells = [];
  let s = seed;
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 21; x++) {
      s = (s * 9301 + 49297) % 233280;
      const fp = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      const fpInner = (x >= 1 && x <= 5 && y >= 1 && y <= 5) || (x >= 15 && x <= 19 && y >= 1 && y <= 5) || (x >= 1 && x <= 5 && y >= 15 && y <= 19);
      const fpCore  = (x >= 2 && x <= 4 && y >= 2 && y <= 4) || (x >= 16 && x <= 18 && y >= 2 && y <= 4) || (x >= 2 && x <= 4 && y >= 16 && y <= 18);
      let on = false;
      if (fp) on = !fpInner || fpCore;
      else on = s / 233280 > 0.55;
      if (on) cells.push(<rect key={`${x}-${y}`} x={x * 4} y={y * 4} width="4" height="4" fill="#050555" />);
    }
  }
  return (
    <div style={{ width: 92, padding: 6, background: 'white', border: '1px solid var(--stroke-soft)', borderRadius: 4 }}>
      <svg viewBox="0 0 84 84" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {cells}
      </svg>
      <div style={{ fontSize: 7, color: 'var(--fg-muted)', textAlign: 'center', marginTop: 4, letterSpacing: '0.04em' }}>
        Validar OC
      </div>
    </div>
  );
}

window.OrderDetail = OrderDetail;
window.PdfPreview = PdfPreview;
window.QrPlaceholder = QrPlaceholder;
window.ScriptSignature = ScriptSignature;
