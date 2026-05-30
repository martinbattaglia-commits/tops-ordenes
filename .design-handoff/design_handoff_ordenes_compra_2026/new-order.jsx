// new-order.jsx — Asistente para crear una orden de compra (4 pasos)
const { useState: useStateNO, useRef: useRefNO, useEffect: useEffectNO, useMemo: useMemoNO } = React;

const STEPS = [
  { id: 'proveedor', label: 'Proveedor' },
  { id: 'general',   label: 'Datos generales' },
  { id: 'productos', label: 'Productos' },
  { id: 'firma',     label: 'Firma' },
];

const blankLine = () => ({ sku: '', label: '', desc: '', qty: 1, unit: 'un', price: 0, total: 0 });

function NewOrder({ onComplete, onCancel, pushToast }) {
  const [stepIdx, setStepIdx] = useStateNO(0);
  const [data, setData] = useStateNO({
    providerId: 'p01',
    proveedor: 'Pallets Sur S.R.L.',
    cuit: '30-71204562-3',
    domicilio: 'Carlos Pellegrini 2380, Avellaneda',
    telefono: '011 4204-7800',
    contacto: 'Diego Vázquez',
    email: 'ventas@palletssur.com.ar',
    condPago: '30 días',
    categoria: 'Insumos depósito',
    destino: 'Depósito Magaldi · CABA',
    depot: 'Magaldi',
    entrega: 'Inmediata',
    items: [
      { sku: 'PAL-EUR-001', label: 'Pallet europeo 1200x800 madera', desc: 'Madera tratada NIMF-15', qty: 80, unit: 'un', price: 12500, total: 1000000 },
      { sku: 'FIL-STR-23',  label: 'Film stretch 23 micrones x 250 m', desc: '', qty: 24, unit: 'rollo', price: 8900, total: 213600 },
    ],
    observ: 'Entrega coordinada para martes 27 entre 08:00 y 11:00 hs en muelle 3.',
    signatureData: null,
  });

  const update = (patch) => setData(d => ({ ...d, ...patch }));

  const totals = useMemoNO(() => {
    const neto = data.items.reduce((a, b) => a + (Number(b.total) || 0), 0);
    const iva = Math.round(neto * 0.21);
    return { neto, iva, total: neto + iva };
  }, [data.items]);

  const orderPreview = {
    id: 'OC-2026-0348',
    shortId: 348,
    date: new Date('2026-05-25T11:30:00'),
    providerId: data.providerId,
    proveedor: data.proveedor,
    cuit: data.cuit,
    condPago: data.condPago,
    categoria: data.categoria,
    destino: data.destino,
    depot: data.depot,
    entrega: data.entrega,
    emisor: APROBADORES[0],
    items: data.items,
    neto: totals.neto, iva: totals.iva, total: totals.total,
    observ: data.observ,
    signedBy: data.signatureData ? APROBADORES[0].name : null,
    signedAt: data.signatureData ? new Date() : null,
    recibido: null,
    facturaId: null,
    status: data.signatureData ? 'enviada' : 'pendiente',
    driveFolder: 'Órdenes de Compra 2026/Mayo/' + data.proveedor,
  };

  const goNext = () => stepIdx < STEPS.length - 1 && setStepIdx(stepIdx + 1);
  const goPrev = () => stepIdx > 0 && setStepIdx(stepIdx - 1);

  const finish = (sigData) => {
    update({ signatureData: sigData });
    setTimeout(() => {
      pushToast && pushToast({ kind: 'signed', title: 'Orden ' + orderPreview.id + ' firmada', msg: 'José Luis Battaglia · ' + data.proveedor });
      onComplete && onComplete(orderPreview);
    }, 350);
  };

  return (
    <div className="content scroll-area" style={{ padding: 0, background: 'var(--bg-page)' }}>
      <div style={{ padding: '24px 32px 0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          <Icon name="x" size={13} /> Cancelar
        </button>
        <div style={{ marginLeft: 16 }}>
          <Stepper steps={STEPS} current={stepIdx} onJump={setStepIdx} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fg-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="mono">{orderPreview.id}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="cloud-check" size={13} style={{ color: 'var(--status-success)' }} />
            Auto-guardado
          </span>
        </div>
      </div>

      <div style={{ padding: '20px 32px 80px', display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 24, alignItems: 'flex-start' }}>
        <div className="card" style={{ padding: '28px 30px', minHeight: 540 }}>
          {stepIdx === 0 && <StepProveedor data={data} update={update} />}
          {stepIdx === 1 && <StepGeneral data={data} update={update} />}
          {stepIdx === 2 && <StepProductos data={data} update={update} totals={totals} />}
          {stepIdx === 3 && <StepFirma data={data} order={orderPreview} onSigned={finish} onBack={goPrev} />}

          {stepIdx < 3 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--stroke-soft)' }}>
              <button className="btn btn-ghost" onClick={goPrev} disabled={stepIdx === 0} style={{ opacity: stepIdx === 0 ? 0.4 : 1 }}>
                <Icon name="arrow-left" size={13} /> Atrás
              </button>
              <button className="btn btn-primary" onClick={goNext}>
                Continuar <Icon name="arrow-right" size={13} stroke={2.2} />
              </button>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
            <div className="eyebrow-tiny" style={{ marginBottom: 0 }}>Vista previa en vivo</div>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-success)', boxShadow: '0 0 0 3px rgba(14,124,58,0.18)' }} />
              Sincronizado
            </span>
          </div>
          <div style={{ transform: 'scale(0.88)', transformOrigin: 'top left', width: '113.6%', marginBottom: -120, pointerEvents: 'none' }}>
            <PdfPreview order={orderPreview} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({ steps, current, onJump }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <div className={`step-item ${current === i ? 'active' : ''} ${i < current ? 'done' : ''}`}
            onClick={() => onJump && i < current && onJump(i)}
            style={{ cursor: i < current ? 'pointer' : 'default' }}>
            <span className="num">
              {i < current ? <Icon name="check" size={12} stroke={2.4} /> : i + 1}
            </span>
            <span>{s.label}</span>
          </div>
          {i < steps.length - 1 && <span className="step-sep" />}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ====== Step 1 — Proveedor ====== */
function StepProveedor({ data, update }) {
  const [search, setSearch] = useStateNO('');
  const [showSuggest, setShowSuggest] = useStateNO(false);

  const filtered = search ? PROVEEDORES.filter(c =>
    c.razon.toLowerCase().includes(search.toLowerCase()) || c.cuit.includes(search)
  ) : PROVEEDORES.slice(0, 4);

  const pick = (p) => {
    update({
      providerId: p.id, proveedor: p.razon, cuit: p.cuit,
      domicilio: p.domicilio, telefono: p.telefono, contacto: p.contacto,
      email: p.email, condPago: p.cond, categoria: p.categoria,
    });
    setSearch('');
    setShowSuggest(false);
  };

  return (
    <div>
      <div className="eyebrow-tiny">Paso 1 de 4</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-brand)', margin: '0 0 6px' }}>Proveedor</h2>
      <p style={{ fontSize: 13, color: 'var(--fg-secondary)', margin: '0 0 20px' }}>
        Buscá un proveedor existente o cargá los datos manualmente. El sistema autocompleta razón social, CUIT, domicilio y condición de pago habitual.
      </p>

      <div style={{ position: 'relative', marginBottom: 24 }}>
        <div className="field-label" style={{ marginBottom: 6 }}>
          <Icon name="sparkle" size={11} stroke={2} style={{ color: 'var(--tops-red)', verticalAlign: '-1px', marginRight: 4 }} />
          Búsqueda inteligente
        </div>
        <div className="input-icon-wrap">
          <Icon name="search" size={14} className="lead-icon" />
          <input className="input" placeholder="Razón social, CUIT, categoría…"
            value={search}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 200)}
            onChange={e => { setSearch(e.target.value); setShowSuggest(true); }} />
        </div>
        {showSuggest && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30,
            background: 'white', border: '1px solid var(--stroke-soft)', borderRadius: 8,
            boxShadow: 'var(--shadow-md)', overflow: 'hidden', maxHeight: 320, overflowY: 'auto',
          }}>
            <div style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)', background: 'var(--neutral-50)', borderBottom: '1px solid var(--stroke-soft)' }}>
              {search ? 'Coincidencias' : 'Proveedores recientes'}
            </div>
            {filtered.map(p => (
              <div key={p.id}
                onMouseDown={() => pick(p)}
                style={{
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
                  cursor: 'pointer', transition: 'background 120ms',
                  borderBottom: '1px solid var(--stroke-soft)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--neutral-50)'}
                onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--tops-blue-700)',
                  color: 'white', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>
                  {p.avatar}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.razon}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.cuit} · {p.orders} órdenes · última {fmtDate(new Date(p.lastOrder))}</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {p.tags.slice(0, 2).map(t => (
                    <span key={t} style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                      padding: '2px 6px', borderRadius: 3,
                      background: 'rgba(33,69,118,0.10)', color: 'var(--tops-blue-700)',
                    }}>{t}</span>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--fg-link)', cursor: 'pointer', fontWeight: 600 }}>
              <Icon name="plus" size={12} stroke={2.2} style={{ verticalAlign: '-1px' }} /> Crear proveedor nuevo
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr', gap: 14, marginBottom: 14 }}>
        <Field label="Razón Social" required>
          <input className="input" value={data.proveedor} onChange={e => update({ proveedor: e.target.value })} />
        </Field>
        <Field label="CUIT" required help="Validación AFIP">
          <div className="input-icon-wrap">
            <input className="input mono" value={data.cuit} onChange={e => update({ cuit: e.target.value })} />
            <Icon name="check-circle" size={14} style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--status-success)' }} />
          </div>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
        <Field label="Domicilio">
          <input className="input" value={data.domicilio} onChange={e => update({ domicilio: e.target.value })} />
        </Field>
        <Field label="Teléfono">
          <input className="input" value={data.telefono} onChange={e => update({ telefono: e.target.value })} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr', gap: 14 }}>
        <Field label="Contacto comercial">
          <input className="input" value={data.contacto} onChange={e => update({ contacto: e.target.value })} />
        </Field>
        <Field label="Email del proveedor" required help="Recibirá el PDF automáticamente">
          <div className="input-icon-wrap">
            <Icon name="mail" size={14} className="lead-icon" />
            <input className="input" value={data.email} onChange={e => update({ email: e.target.value })} />
          </div>
        </Field>
      </div>
    </div>
  );
}

/* ====== Step 2 — General ====== */
function StepGeneral({ data, update }) {
  return (
    <div>
      <div className="eyebrow-tiny">Paso 2 de 4</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-brand)', margin: '0 0 6px' }}>Datos generales</h2>
      <p style={{ fontSize: 13, color: 'var(--fg-secondary)', margin: '0 0 22px' }}>
        Condiciones comerciales y logísticas de la compra. La OC queda asignada a José Luis Battaglia como emisor oficial.
      </p>

      <Field label="Destino de la mercadería" required>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <DepotCard selected={data.depot === 'Magaldi'} onClick={() => update({ depot: 'Magaldi', destino: 'Depósito Magaldi · CABA' })}
            name="Magaldi" address="Agustín Magaldi 1765 · CABA" badge="ANMAT" online ops={6} />
          <DepotCard selected={data.depot === 'Luján'} onClick={() => update({ depot: 'Luján', destino: 'Depósito Luján · BsAs' })}
            name="Luján" address="Ruta 8 km 67.5 · BsAs" badge="General" online ops={3} />
        </div>
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 22 }}>
        <Field label="Condición de pago" required>
          <div className="select-wrap" style={{ position: 'relative' }}>
            <select className="select" value={data.condPago} onChange={e => update({ condPago: e.target.value })}>
              {COND_PAGO.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Fecha de entrega" required>
          <div className="input-icon-wrap">
            <Icon name="calendar" size={14} className="lead-icon" />
            <input className="input" value={data.entrega} onChange={e => update({ entrega: e.target.value })} placeholder="Inmediata / días / fecha" />
          </div>
        </Field>
      </div>

      <div style={{ marginTop: 22 }}>
        <Field label="Categoría">
          <div className="chip-group">
            {['Insumos depósito', 'Combustible', 'Repuestos', 'IT / Tecnología', 'ANMAT / Limpieza', 'Estructura', 'Oficina', 'Servicios', 'Seguridad'].map(c => (
              <button key={c}
                className={`chip ${data.categoria === c ? 'selected' : ''}`}
                onClick={() => update({ categoria: c })}>
                {data.categoria === c && <Icon name="check" size={12} stroke={2.4} />}
                {c}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div style={{ marginTop: 22 }}>
        <Field label="Emisor de la orden">
          <div style={{
            padding: '14px 16px', borderRadius: 8,
            background: 'linear-gradient(135deg, rgba(201,8,18,0.05), rgba(5,5,85,0.02))',
            border: '1px solid var(--stroke-soft)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--tops-red)', color: 'white',
              display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>JL</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>José Luis Battaglia</div>
              <div style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>Director de Operaciones · Único autorizado para emitir OC</div>
            </div>
            <div className="badge badge-success"><span className="dot"/>Autorizado</div>
          </div>
        </Field>
      </div>
    </div>
  );
}

function DepotCard({ selected, onClick, name, address, badge, online, ops }) {
  return (
    <div onClick={onClick} style={{
      padding: '14px 16px',
      border: '1px solid ' + (selected ? 'var(--tops-blue-900)' : 'var(--stroke-soft)'),
      background: selected ? 'var(--tops-blue-900)' : 'white',
      color: selected ? 'white' : 'var(--fg-primary)',
      borderRadius: 8, cursor: 'pointer',
      transition: 'all 200ms cubic-bezier(0.22,1,0.36,1)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon name="building" size={15} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>{name}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          padding: '2px 6px', borderRadius: 3, marginLeft: 'auto',
          background: selected ? 'rgba(255,255,255,0.16)' : 'rgba(201,8,18,0.10)',
          color: selected ? 'white' : 'var(--tops-red)',
        }}>{badge}</span>
      </div>
      <div style={{ fontSize: 11, opacity: selected ? 0.7 : 1, color: selected ? 'rgba(255,255,255,0.7)' : 'var(--fg-muted)', marginBottom: 10 }}>{address}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? '#36c275' : '#888' }}/>
        <span style={{ opacity: selected ? 0.85 : 1, color: selected ? 'rgba(255,255,255,0.85)' : 'var(--fg-secondary)' }}>
          Recepción habilitada · {ops} op.
        </span>
      </div>
      {selected && (
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <Icon name="check-circle" size={16} />
        </div>
      )}
    </div>
  );
}

/* ====== Step 3 — Productos (dynamic table) ====== */
function StepProductos({ data, update, totals }) {
  const [pickerOpenIdx, setPickerOpenIdx] = useStateNO(null);

  const setItem = (idx, patch) => {
    const items = [...data.items];
    items[idx] = { ...items[idx], ...patch };
    if (patch.qty != null || patch.price != null) {
      items[idx].total = Math.round((Number(items[idx].qty) || 0) * (Number(items[idx].price) || 0));
    }
    update({ items });
  };
  const addRow = () => update({ items: [...data.items, blankLine()] });
  const removeRow = (idx) => update({ items: data.items.filter((_, i) => i !== idx) });

  const pickProduct = (idx, prod) => {
    setItem(idx, { sku: prod.sku, label: prod.label, unit: prod.unit, price: prod.price });
    setPickerOpenIdx(null);
  };

  return (
    <div>
      <div className="eyebrow-tiny">Paso 3 de 4</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-brand)', margin: '0 0 6px' }}>Detalle de productos</h2>
      <p style={{ fontSize: 13, color: 'var(--fg-secondary)', margin: '0 0 22px' }}>
        Agregá los artículos a comprar. El sistema autocalcula subtotal, IVA 21% y total en tiempo real.
      </p>

      <div className="card" style={{ overflow: 'hidden', border: '1px solid var(--stroke-soft)' }}>
        <table className="lines-table">
          <thead>
            <tr>
              <th style={{ width: 28, textAlign: 'center' }}>N°</th>
              <th style={{ minWidth: 220 }}>Producto</th>
              <th style={{ width: 80, textAlign: 'right' }}>Cant.</th>
              <th style={{ width: 70 }}>Un.</th>
              <th style={{ width: 130, textAlign: 'right' }}>Precio unit.</th>
              <th style={{ width: 130, textAlign: 'right' }}>Subtotal</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={i}>
                <td className="row-idx">{i + 1}</td>
                <td className="col-prod" style={{ position: 'relative' }}>
                  <input
                    placeholder="Detalle del producto…"
                    value={it.label}
                    onFocus={() => setPickerOpenIdx(i)}
                    onBlur={() => setTimeout(() => setPickerOpenIdx(p => p === i ? null : p), 200)}
                    onChange={e => setItem(i, { label: e.target.value })} />
                  {it.sku && (
                    <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', padding: '0 10px 2px' }}>
                      SKU {it.sku}
                    </div>
                  )}
                  {pickerOpenIdx === i && (
                    <ProductPicker onPick={(p) => pickProduct(i, p)} />
                  )}
                </td>
                <td className="col-num">
                  <input type="number" min="0" value={it.qty}
                    onChange={e => setItem(i, { qty: +e.target.value })} />
                </td>
                <td>
                  <input value={it.unit}
                    onChange={e => setItem(i, { unit: e.target.value })} />
                </td>
                <td className="col-num right">
                  <input type="number" min="0" value={it.price}
                    onChange={e => setItem(i, { price: +e.target.value })} />
                </td>
                <td className="col-total">{fmtCurrency(it.total)}</td>
                <td className="col-actions">
                  <button onClick={() => removeRow(i)} title="Eliminar fila">
                    <Icon name="trash" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button className="line-add" onClick={addRow}>
          <Icon name="plus" size={14} stroke={2.4} /> Agregar producto
        </button>

        <div className="totals">
          <div className="row"><span>Subtotal neto</span><b>{fmtCurrency(totals.neto)}</b></div>
          <div className="row iva"><span>IVA 21%</span><b>{fmtCurrency(totals.iva)}</b></div>
          <div className="row total"><span>TOTAL</span><b>{fmtCurrency(totals.total)}</b></div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <Field label="Observaciones / instrucciones de entrega">
          <textarea className="textarea" placeholder="Coordinación con muelle, requisitos, certificados…"
            value={data.observ} onChange={e => update({ observ: e.target.value })} />
        </Field>
      </div>

      <div style={{
        marginTop: 18, padding: '14px 16px',
        background: 'linear-gradient(135deg, rgba(5,5,85,0.04), rgba(201,8,18,0.04))',
        border: '1px solid var(--stroke-soft)',
        borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--tops-blue-900)',
          color: 'white', display: 'grid', placeItems: 'center' }}>
          <Icon name="wand" size={16} stroke={2} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--tops-red)' }}>Sugerencia inteligente</div>
          <div style={{ fontSize: 13, color: 'var(--fg-secondary)' }}>
            Pallets Sur S.R.L. suele entregar cinta adhesiva 48mm junto con pallets. ¿Sumar 24 un. a la orden?
          </div>
        </div>
        <button className="btn btn-ghost btn-sm">Agregar</button>
      </div>
    </div>
  );
}

function ProductPicker({ onPick }) {
  return (
    <div style={{
      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
      background: 'white', border: '1px solid var(--stroke-soft)', borderRadius: 8,
      boxShadow: 'var(--shadow-md)', overflow: 'hidden',
      maxHeight: 240, overflowY: 'auto', marginTop: 2,
    }}>
      <div style={{ padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--fg-muted)',
        background: 'var(--neutral-50)', borderBottom: '1px solid var(--stroke-soft)' }}>
        Catálogo · seleccioná o escribí libremente
      </div>
      {PRODUCTOS.slice(0, 10).map(p => (
        <div key={p.sku}
          onMouseDown={() => onPick(p)}
          style={{
            padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12,
            cursor: 'pointer', borderBottom: '1px solid var(--stroke-soft)', fontSize: 12,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--neutral-50)'}
          onMouseLeave={e => e.currentTarget.style.background = 'white'}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-primary)' }}>{p.label}</div>
            <div style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{p.sku} · {p.unit}</div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-brand)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtCurrency(p.price)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ====== Step 4 — Firma ====== */
function StepFirma({ data, order, onSigned, onBack }) {
  const canvasRef = useRefNO(null);
  const [hasInk, setHasInk] = useStateNO(false);
  const [drawing, setDrawing] = useStateNO(false);

  useEffectNO(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#050555';

    let down = false;
    let last = null;
    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: p.clientX - r.left, y: p.clientY - r.top };
    };
    const start = (e) => {
      e.preventDefault();
      down = true; setDrawing(true);
      last = getPos(e);
    };
    const move = (e) => {
      if (!down) return;
      e.preventDefault();
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      if (!hasInk) setHasInk(true);
    };
    const end = () => { down = false; setDrawing(false); };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    return () => {
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('mousemove', move);
      canvas.removeEventListener('mouseup', end);
      canvas.removeEventListener('mouseleave', end);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', end);
    };
  }, []);

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const confirm = () => {
    if (!hasInk) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onSigned && onSigned(dataUrl);
  };

  return (
    <div>
      <div className="eyebrow-tiny">Paso 4 de 4</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg-brand)', margin: '0 0 6px' }}>Firma del Director</h2>
      <p style={{ fontSize: 13, color: 'var(--fg-secondary)', margin: '0 0 22px' }}>
        Las órdenes de compra solo pueden ser emitidas por <strong>José Luis Battaglia</strong>, Director de Operaciones. La firma se incrusta en el PDF junto con timestamp, hash SHA-256 e IP del dispositivo.
      </p>

      <div style={{
        padding: '14px 16px', marginBottom: 18,
        background: 'rgba(33,69,118,0.06)',
        borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--tops-red)', color: 'white',
          display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>JL</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-primary)' }}>José Luis Battaglia</div>
          <div style={{ fontSize: 12, color: 'var(--fg-secondary)' }}>Director de Operaciones · Verotin S.A. · joseluis@logisticatops.com</div>
        </div>
      </div>

      <Field label="Firma digital" required>
        <div style={{ position: 'relative', background: 'white', border: '2px dashed var(--stroke-strong)', borderRadius: 8, overflow: 'hidden' }}>
          {!hasInk && !drawing && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 1 }}>
              <div style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>
                <Icon name="pen" size={28} stroke={1.4} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>Firmá aquí con el dedo o el mouse</div>
                <div style={{ fontSize: 11, marginTop: 2 }}>Al confirmar autorizás esta compra ante {data.proveedor}.</div>
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ width: '100%', height: 200, display: 'block', cursor: 'crosshair', touchAction: 'none' }} />
          <div style={{ position: 'absolute', top: 10, left: 10, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)', zIndex: 2 }}>
            X — JOSÉ LUIS BATTAGLIA
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={clear} disabled={!hasInk}>
            <Icon name="refresh" size={12} /> Limpiar
          </button>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon name="lock" size={11} /> Hash SHA-256 generado al guardar
          </div>
        </div>
      </Field>

      {/* Resumen automático */}
      <div style={{ marginTop: 22, padding: 16, background: 'var(--neutral-50)', borderRadius: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 10 }}>
          Al confirmar se ejecutarán automáticamente
        </div>
        <AutoAction icon="file-pdf" label="Generar PDF corporativo" detail={order.id + '.pdf · con QR y firma'} />
        <AutoAction icon="cloud" label="Guardar en Google Drive"   detail={'/Logística TOPS/' + order.driveFolder + '/'} />
        <AutoAction icon="send" label="Enviar email a 3 destinatarios" detail={data.email + ' · joseluis@... · ruth@...'} />
        <AutoAction icon="database" label="Registrar en historial" detail="Trazabilidad completa + auditoría" last />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--stroke-soft)' }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <Icon name="arrow-left" size={13} /> Atrás
        </button>
        <button className="btn btn-danger btn-lg" disabled={!hasInk} onClick={confirm} style={{ opacity: hasInk ? 1 : 0.5 }}>
          <Icon name="check" size={15} stroke={2.4} />
          Confirmar, firmar y enviar
        </button>
      </div>
    </div>
  );
}

function AutoAction({ icon, label, detail, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
      borderBottom: last ? 'none' : '1px solid var(--stroke-soft)' }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, background: 'white', color: 'var(--tops-blue-700)',
        display: 'grid', placeItems: 'center', flexShrink: 0, border: '1px solid var(--stroke-soft)' }}>
        <Icon name={icon} size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-primary)' }}>{label}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>
      </div>
      <Icon name="check" size={13} stroke={2.4} style={{ color: 'var(--status-success)' }} />
    </div>
  );
}

/* ====== shared field wrapper ====== */
function Field({ label, required, help, children }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <div className="field-label">
        {label}
        {required && <span className="req">*</span>}
        {help && <span style={{ marginLeft: 8, color: 'var(--fg-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {help}</span>}
      </div>
      {children}
    </div>
  );
}

window.NewOrder = NewOrder;
