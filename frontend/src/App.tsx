import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Boxes, Check, ClipboardList, LayoutDashboard, LogOut, Plus, Search, UserPlus, Users, Wrench, X } from 'lucide-react'
import { api, errorMessage, hasSession, login, logout } from './lib/api'
import type { AccessoryOption, Asset, AssetStatus, Borrower, Checkout, CheckoutItem, Page, Summary, User } from './lib/types'
import logo from './assets/tgc-logo.webp'

type Section = 'dashboard' | 'assets' | 'borrowers' | 'checkouts' | 'users'

function usePage<T>(path: string, revision: number) {
  const [data, setData] = useState<Page<T> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    api<Page<T>>(path).then((result) => {
      if (active) { setData(result); setError('') }
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason instanceof Error ? reason.message : reason))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [path, revision])
  return { data, error, loading }
}

async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = []
  let page = 1
  while (true) {
    const separator = path.includes('?') ? '&' : '?'
    const response = await api<Page<T>>(`${path}${separator}page=${page}`)
    items.push(...response.results)
    if (!response.next) return items
    page += 1
  }
}

function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' }) {
  return <div className={`notice ${tone}`} role="status">{children}</div>
}

function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value.replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>
}

function Pager({ page, count, pageSize = 25, onChange }: { page: number; count: number; pageSize?: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (pages <= 1) return null
  return <div className="pager">
    <button disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
    <span>Page {page} of {pages}</span>
    <button disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
  </div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

function Dashboard({ revision, navigate }: { revision: number; navigate: (section: Section) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<Summary>('/dashboard/').then(setSummary).catch((reason: unknown) => setError(String(reason)))
  }, [revision])
  const cards: { key: keyof Summary; label: string; section: Section }[] = [
    { key: 'available', label: 'Available assets', section: 'assets' },
    { key: 'on_loan', label: 'On loan', section: 'checkouts' },
    { key: 'overdue', label: 'Overdue items', section: 'checkouts' },
    { key: 'damaged', label: 'Damaged', section: 'assets' },
    { key: 'incomplete', label: 'Incomplete kits', section: 'assets' },
    { key: 'lost', label: 'Lost', section: 'assets' },
  ]
  return <>
    <PageHeader title="Overview" description="A quick picture of what is in the IT office and what is still out." />
    {error && <Notice>{error}</Notice>}
    <div className="stats-grid">{cards.map(card =>
      <button className="stat-card" key={card.key} onClick={() => navigate(card.section)}>
        <span>{card.label}</span><strong>{summary?.[card.key] ?? '—'}</strong>
      </button>
    )}</div>
    <div className="panel intro-panel"><h2>Office workflow</h2><p>Register each asset and its included accessories, save a borrower contact, then issue one or more available items with a due date. Confirm accessories on return. Incomplete, damaged and lost items stay unavailable until an admin resolves them.</p></div>
  </>
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function Assets({ user, revision, reload }: { user: User; revision: number; reload: () => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Asset | 'new' | null>(null)
  const [managingAccessories, setManagingAccessories] = useState(false)
  const path = `/assets/?page=${page}&q=${encodeURIComponent(q)}&status=${status}`
  const { data, error, loading } = usePage<Asset>(path, revision)
  return <>
    <PageHeader title="Assets" description="Each device or tool has a unique name and a record of its included accessories." action={user.role === 'admin' && <div className="header-actions"><button onClick={() => setManagingAccessories(true)}>Manage accessories</button><button className="primary" onClick={() => setEditing('new')}><Plus size={17} /> Add asset</button></div>} />
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search assets" placeholder="Search by name" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} /></div><select aria-label="Filter assets" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['available', 'on_loan', 'incomplete', 'damaged', 'lost', 'retired'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th>Name</th><th>Included accessories</th><th>Status</th>{user.role === 'admin' && <th></th>}</tr></thead><tbody>{data?.results.map(asset => <tr key={asset.id}><td className="strong">{asset.name}</td><td>{asset.accessory_items.length ? asset.accessory_items.map(item => item.name).join(', ') : '—'}</td><td><Badge value={asset.status} /></td>{user.role === 'admin' && <td><button className="text-button" onClick={() => setEditing(asset)}>Edit</button></td>}</tr>)}</tbody></table>{loading && <p className="empty">Loading assets…</p>}{!loading && !data?.results.length && <p className="empty">No assets found.</p>}</div>
    <Pager page={page} count={data?.count || 0} onChange={setPage} />
    {editing && <AssetForm asset={editing === 'new' ? null : editing} close={() => setEditing(null)} saved={() => { setEditing(null); reload() }} />}
    {managingAccessories && <AccessoryManager close={() => setManagingAccessories(false)} saved={reload} />}
  </>
}

function AssetForm({ asset, close, saved }: { asset: Asset | null; close: () => void; saved: () => void }) {
  const [name, setName] = useState(asset?.name || '')
  const [notes, setNotes] = useState(asset?.notes || '')
  const [accessoryIds, setAccessoryIds] = useState<number[]>(asset?.accessory_ids || [])
  const [accessories, setAccessories] = useState<AccessoryOption[]>([])
  const [status, setStatus] = useState<AssetStatus>(asset?.status || 'available')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { allPages<AccessoryOption>('/accessories/').then(setAccessories).catch((reason: unknown) => setError(String(reason))) }, [])
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api(asset ? `/assets/${asset.id}/` : '/assets/', {
        method: asset ? 'PATCH' : 'POST',
        body: JSON.stringify({ name, notes, accessory_ids: accessoryIds, ...(asset ? { status } : {}) }),
      })
      saved()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="overlay" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-label={asset ? 'Edit asset' : 'Add asset'}><div className="dialog-head"><h2>{asset ? 'Edit asset' : 'Add asset'}</h2><button onClick={close} aria-label="Close">×</button></div><form onSubmit={submit} className="form-stack">
    {error && <Notice>{error}</Notice>}
    <Field label="Name *"><input required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="For example, Projector 1" /></Field>
    <fieldset className="accessory-field"><legend>Included accessories</legend>{accessories.length ? <div className="accessory-options">{accessories.map(option => <label className="checkbox-line" key={option.id}><input type="checkbox" checked={accessoryIds.includes(option.id)} onChange={e => setAccessoryIds(current => e.target.checked ? [...current, option.id] : current.filter(id => id !== option.id))} />{option.name}{!option.is_active && <small> (inactive)</small>}</label>)}</div> : <p className="hint">No accessory options yet. Add them from Manage accessories.</p>}</fieldset>
    <Field label="Notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    {asset && <Field label="Status"><select value={status} disabled={asset.status === 'on_loan'} onChange={e => setStatus(e.target.value as AssetStatus)}>{['available', 'incomplete', 'damaged', 'lost', 'retired'].map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></Field>}
    <div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save asset'}</button></div>
  </form></div></div>
}

function AccessoryManager({ close, saved }: { close: () => void; saved: () => void }) {
  const [options, setOptions] = useState<AccessoryOption[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function reloadOptions() {
    setOptions(await allPages<AccessoryOption>('/accessories/'))
  }
  useEffect(() => { allPages<AccessoryOption>('/accessories/').then(setOptions).catch((reason: unknown) => setError(String(reason))) }, [])
  async function createOption(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await api('/accessories/', { method: 'POST', body: JSON.stringify({ name }) }); setName(''); await reloadOptions(); saved() }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  async function updateOption(option: AccessoryOption, nextName: string, isActive: boolean) {
    setError('')
    try { await api(`/accessories/${option.id}/`, { method: 'PATCH', body: JSON.stringify({ name: nextName, is_active: isActive }) }); await reloadOptions(); saved() }
    catch (reason) { setError(String(reason)) }
  }
  return <div className="overlay" role="presentation"><div className="dialog wide" role="dialog" aria-modal="true" aria-label="Manage accessories"><div className="dialog-head"><h2>Manage accessories</h2><button onClick={close} aria-label="Close">×</button></div><div className="form-stack">
    {error && <Notice>{error}</Notice>}
    <form className="accessory-create" onSubmit={createOption}><Field label="New accessory option"><input required value={name} onChange={e => setName(e.target.value)} placeholder="For example, Power cable" /></Field><button className="primary" disabled={busy}><Plus size={16} /> Add option</button></form>
    <p className="hint">Active options appear for every asset. Turn an option off to hide it from new selections while keeping past records.</p>
    <div className="accessory-option-list">{options.map(option => <AccessoryOptionRow key={option.id} option={option} save={updateOption} />)}</div>
    <div className="form-actions"><button onClick={close}>Done</button></div>
  </div></div></div>
}

function AccessoryOptionRow({ option, save }: { option: AccessoryOption; save: (option: AccessoryOption, name: string, isActive: boolean) => Promise<void> }) {
  const [name, setName] = useState(option.name)
  const [isActive, setIsActive] = useState(option.is_active)
  return <div className="accessory-option-row"><input aria-label={`Accessory name ${option.name}`} value={name} onChange={e => setName(e.target.value)} /><label className="checkbox-line"><input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />Active</label><button onClick={() => save(option, name, isActive)}>Save</button></div>
}

function Borrowers({ revision, reload }: { revision: number; reload: () => void }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Borrower | 'new' | null>(null)
  const { data, error, loading } = usePage<Borrower>(`/borrowers/?page=${page}&q=${encodeURIComponent(q)}`, revision)
  return <>
    <PageHeader title="Borrowers" description="Contacts are reusable across future checkouts." action={<button className="primary" onClick={() => setEditing('new')}><Plus size={17} /> Add borrower</button>} />
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search borrowers" placeholder="Search name or phone" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} /></div></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Type</th><th></th></tr></thead><tbody>{data?.results.map(borrower => <tr key={borrower.id}><td className="strong">{borrower.name}</td><td>{borrower.phone}</td><td>{borrower.borrower_type || '—'}</td><td><button className="text-button" onClick={() => setEditing(borrower)}>Edit</button></td></tr>)}</tbody></table>{loading && <p className="empty">Loading borrowers…</p>}{!loading && !data?.results.length && <p className="empty">No borrowers found.</p>}</div><Pager page={page} count={data?.count || 0} onChange={setPage} />
    {editing && <BorrowerForm borrower={editing === 'new' ? null : editing} close={() => setEditing(null)} saved={() => { setEditing(null); reload() }} />}
  </>
}

function BorrowerForm({ borrower, close, saved }: { borrower: Borrower | null; close: () => void; saved: () => void }) {
  const [name, setName] = useState(borrower?.name || '')
  const [phone, setPhone] = useState(borrower?.phone || '')
  const [type, setType] = useState(borrower?.borrower_type || '')
  const [notes, setNotes] = useState(borrower?.notes || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api(borrower ? `/borrowers/${borrower.id}/` : '/borrowers/', {
        method: borrower ? 'PATCH' : 'POST', body: JSON.stringify({ name, phone, borrower_type: type, notes }),
      })
      saved()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="overlay" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-label={borrower ? 'Edit borrower' : 'Add borrower'}><div className="dialog-head"><h2>{borrower ? 'Edit borrower' : 'Add borrower'}</h2><button onClick={close} aria-label="Close">×</button></div><form onSubmit={submit} className="form-stack">
    {error && <Notice>{error}</Notice>}<Field label="Full name"><input required value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Phone number"><input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field><Field label="Borrower type (optional)"><select value={type} onChange={e => setType(e.target.value)}><option value="">Unspecified</option>{['employee', 'student', 'customer', 'guest', 'other'].map(value => <option key={value} value={value}>{value}</option>)}</select></Field><Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field><div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save borrower'}</button></div>
  </form></div></div>
}

function Checkouts({ revision, reload }: { revision: number; reload: () => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { data, error, loading } = usePage<Checkout>(`/checkouts/?page=${page}&q=${encodeURIComponent(q)}&status=${status}`, revision)
  return <>
    <PageHeader title="Checkouts" description="Track issued items, partial returns and due dates." action={<button className="primary" onClick={() => setCreating(true)}><Plus size={17} /> New checkout</button>} />
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search checkouts" placeholder="Search borrower or phone" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} /></div><select aria-label="Filter checkouts" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All checkouts</option><option value="active">Active</option><option value="overdue">Overdue</option><option value="closed">Closed</option></select></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th>Checkout</th><th>Borrower</th><th>Issued</th><th>Due</th><th>Items</th><th>Status</th><th></th></tr></thead><tbody>{data?.results.map(checkout => <tr key={checkout.id}><td className="strong">#{checkout.id}</td><td>{checkout.borrower_name}<small>{checkout.borrower_phone}</small></td><td>{dateTime(checkout.issued_at)}</td><td>{checkout.due_date}</td><td>{checkout.items.length}</td><td><Badge value={checkout.status} /></td><td><button className="text-button" onClick={() => setSelectedId(checkout.id)}>Open</button></td></tr>)}</tbody></table>{loading && <p className="empty">Loading checkouts…</p>}{!loading && !data?.results.length && <p className="empty">No checkouts found.</p>}</div><Pager page={page} count={data?.count || 0} onChange={setPage} />
    {creating && <CheckoutForm close={() => setCreating(false)} saved={() => { setCreating(false); reload() }} />}
    {selectedId && <CheckoutDetail id={selectedId} revision={revision} close={() => setSelectedId(null)} reload={reload} />}
  </>
}

function CheckoutForm({ close, saved }: { close: () => void; saved: () => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [borrowerSearch, setBorrowerSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [assetSearch, setAssetSearch] = useState('')
  const [borrowers, setBorrowers] = useState<Borrower[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [borrowerId, setBorrowerId] = useState(0)
  const [picked, setPicked] = useState<Borrower | null>(null)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newType, setNewType] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (mode !== 'existing' || picked || borrowerSearch.trim().length < 2) {
      setBorrowers([])
      setSearching(false)
      return
    }
    let active = true
    setBorrowers([])
    setSearching(true)
    const timer = setTimeout(() => {
      api<Page<Borrower>>(`/borrowers/?q=${encodeURIComponent(borrowerSearch.trim())}`)
        .then(data => { if (active) setBorrowers(data.results) })
        .catch((reason: unknown) => { if (active) setError(String(reason)) })
        .finally(() => { if (active) setSearching(false) })
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [borrowerSearch, mode, picked])
  useEffect(() => { allPages<Asset>('/assets/?status=available').then(setAssets).catch((reason: unknown) => setError(String(reason))) }, [])
  function switchMode(next: 'existing' | 'new') {
    if (next === 'new') {
      setPicked(null)
      setBorrowerId(0)
      if (!newName && borrowerSearch.trim()) setNewName(borrowerSearch.trim())
    }
    setError('')
    setMode(next)
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    if (mode === 'existing' && !borrowerId) { setError('Find a borrower or register a new one.'); return }
    if (mode === 'new' && (!newName.trim() || !newPhone.trim())) { setError('Name and phone are required for a new borrower.'); return }
    if (!selected.length) { setError('Select at least one available asset.'); return }
    setBusy(true)
    try {
      const who = mode === 'new'
        ? { borrower_data: { name: newName.trim(), phone: newPhone.trim(), borrower_type: newType, notes: newNotes } }
        : { borrower: borrowerId }
      await api('/checkouts/', { method: 'POST', body: JSON.stringify({ ...who, asset_ids: selected, due_date: dueDate, notes }) })
      saved()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const visibleAssets = assets.filter(asset => `${asset.name} ${asset.accessory_items.map(item => item.name).join(' ')}`.toLowerCase().includes(assetSearch.toLowerCase()))
  return <div className="overlay" role="presentation"><div className="dialog checkout-dialog" role="dialog" aria-modal="true" aria-label="Create checkout">
    <div className="dialog-head"><h2>Create checkout</h2><button onClick={close} aria-label="Close">×</button></div>
    <form onSubmit={submit} className="checkout-form">
      <div className="dialog-body form-stack">
        {error && <Notice>{error}</Notice>}
        <section className="intake-section" aria-label="Borrower selection">
          <h3>Borrower <span className="required-mark">*</span></h3>
          {mode === 'existing' && picked ? <div className="selected-contact"><div><strong>{picked.name}</strong><small>{picked.phone}{picked.borrower_type ? ` · ${picked.borrower_type}` : ''}</small></div><button type="button" onClick={() => { setPicked(null); setBorrowerId(0) }}><X size={15} /> Change</button></div> : <>
            <div className="choice-tabs" role="tablist" aria-label="Borrower type"><button type="button" role="tab" aria-selected={mode === 'existing'} className={mode === 'existing' ? 'selected' : ''} onClick={() => switchMode('existing')}><Search size={16} /> Existing borrower</button><button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'selected' : ''} onClick={() => switchMode('new')}><UserPlus size={16} /> New borrower</button></div>
            {mode === 'existing' ? <div className="form-stack picker-content"><div className="search"><Search size={17} /><input aria-label="Search borrowers" autoComplete="off" placeholder="Search by name or phone…" value={borrowerSearch} onChange={e => setBorrowerSearch(e.target.value)} /></div>
              {borrowerSearch.trim().length < 2 && <p className="hint">Type at least 2 characters to search borrowers.</p>}
              {searching && <p className="hint">Searching borrowers…</p>}
              {borrowerSearch.trim().length >= 2 && !searching && borrowers.length > 0 && <ul className="borrower-results" aria-label="Matching borrowers">{borrowers.map(borrower => <li key={borrower.id}><button type="button" onClick={() => { setPicked(borrower); setBorrowerId(borrower.id); setError('') }}><Check size={16} /><span><strong>{borrower.name}</strong><small>{borrower.phone}{borrower.borrower_type ? ` · ${borrower.borrower_type}` : ''}</small></span></button></li>)}</ul>}
              {borrowerSearch.trim().length >= 2 && !searching && borrowers.length === 0 && <div className="no-match"><span>No borrower matches “{borrowerSearch.trim()}”.</span><button type="button" onClick={() => switchMode('new')}><UserPlus size={15} /> Register them</button></div>}
            </div> : <div className="inline-register"><div className="register-grid"><Field label="Name *"><input required value={newName} onChange={e => setNewName(e.target.value)} /></Field><Field label="Phone *"><input required type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} /></Field><Field label="Borrower type"><select value={newType} onChange={e => setNewType(e.target.value)}><option value="">Unspecified</option>{['employee', 'student', 'customer', 'guest', 'other'].map(value => <option key={value} value={value}>{value}</option>)}</select></Field><Field label="Borrower notes"><input value={newNotes} onChange={e => setNewNotes(e.target.value)} /></Field></div></div>}
          </>}
        </section>
        <div className="checkout-meta-grid"><Field label="Due date *"><input required type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field><Field label="Items selected"><output className="selected-count">{selected.length} asset{selected.length === 1 ? '' : 's'}</output></Field></div>
        <section className="intake-section" aria-label="Asset selection"><h3>Assets <span className="required-mark">*</span></h3><div className="search"><Search size={17} /><input aria-label="Search available assets" value={assetSearch} onChange={e => setAssetSearch(e.target.value)} placeholder="Search by asset name…" /></div><div className="asset-picker" aria-label="Available assets">{visibleAssets.length ? visibleAssets.map(asset => <label key={asset.id} className="pick-row"><input type="checkbox" checked={selected.includes(asset.id)} onChange={e => setSelected(current => e.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} /><span><strong>{asset.name}</strong>{asset.accessory_items.length > 0 && <small>{asset.accessory_items.map(item => item.name).join(', ')}</small>}</span></label>) : <p className="empty">No available assets found.</p>}</div></section>
        <Field label="Checkout notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
      <div className="dialog-footer"><button type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create checkout'}</button></div>
    </form>
  </div></div>
}

function CheckoutDetail({ id, revision, close, reload }: { id: number; revision: number; close: () => void; reload: () => void }) {
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [error, setError] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [outcomeItem, setOutcomeItem] = useState<CheckoutItem | null>(null)
  const [outcome, setOutcome] = useState<'returned' | 'damaged' | 'lost'>('returned')
  const [notes, setNotes] = useState('')
  const [missingAccessoryIds, setMissingAccessoryIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<Checkout>(`/checkouts/${id}/`).then(data => { setCheckout(data); setDueDate(data.due_date) }).catch((reason: unknown) => setError(String(reason)))
  }, [id, revision])
  async function saveDate() {
    setBusy(true); setError('')
    try { await api(`/checkouts/${id}/`, { method: 'PATCH', body: JSON.stringify({ due_date: dueDate }) }); reload() }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  async function resolve() {
    if (!outcomeItem) return
    setBusy(true); setError('')
    try { await api(`/checkout-items/${outcomeItem.id}/resolve/`, { method: 'POST', body: JSON.stringify({ outcome, notes, missing_accessory_ids: outcome === 'lost' ? [] : missingAccessoryIds }) }); setOutcomeItem(null); setNotes(''); setMissingAccessoryIds([]); reload() }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="overlay" role="presentation"><div className="dialog wide" role="dialog" aria-modal="true" aria-label={`Checkout ${id}`}><div className="dialog-head"><h2>Checkout #{id}</h2><button onClick={close} aria-label="Close">×</button></div>{error && <Notice>{error}</Notice>}{!checkout ? <p>Loading…</p> : <div className="form-stack">
    <div className="detail-grid"><div><span className="label">Borrower</span><strong>{checkout.borrower_name}</strong><span>{checkout.borrower_phone}</span></div><div><span className="label">Issued</span><strong>{dateTime(checkout.issued_at)}</strong><span>By {checkout.issued_by_name}</span></div><div><span className="label">Status</span><Badge value={checkout.status} /></div></div>
    <div className="due-editor"><Field label="Due date"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field><button disabled={busy || dueDate === checkout.due_date || !dueDate} onClick={saveDate}>Update due date</button></div>
    {checkout.notes && <p className="hint">Notes: {checkout.notes}</p>}
    <h3>Items</h3><div className="item-list">{checkout.items.map(item => <div className="item-row" key={item.id}><div><strong>{item.asset_name}</strong>{item.accessory_snapshot.length > 0 && <small>Included: {item.accessory_snapshot.map(accessory => accessory.name).join(', ')}</small>}{item.missing_accessories.length > 0 && <small className="missing-accessories">Missing: {item.missing_accessories.map(accessory => accessory.name).join(', ')}</small>}{item.closed_at && <small>Resolved {dateTime(item.closed_at)} by {item.closed_by_name}</small>}{item.notes && <small>{item.notes}</small>}</div><Badge value={item.status} />{item.status === 'out' && <button onClick={() => { setOutcomeItem(item); setOutcome('returned'); setMissingAccessoryIds([]) }}>Record outcome</button>}</div>)}</div>
    <h3>Activity</h3><div className="event-list">{checkout.events.map(event => <div key={event.id}><strong>{event.kind.replaceAll('_', ' ')}</strong><span>{event.actor_name} · {dateTime(event.created_at)}</span>{event.kind === 'due_date_changed' && <small>{String(event.details.from)} → {String(event.details.to)}</small>}</div>)}</div>
    {outcomeItem && <div className="resolve-panel"><h3>Resolve {outcomeItem.asset_name}</h3><Field label="Outcome"><select value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)}><option value="returned">Returned in good condition</option><option value="damaged">Returned damaged</option><option value="lost">Lost</option></select></Field>{outcome !== 'lost' && <fieldset className="accessory-field"><legend>Confirm returned accessories</legend>{outcomeItem.accessory_snapshot.length ? <div className="accessory-options">{outcomeItem.accessory_snapshot.map(accessory => { const isMissing = missingAccessoryIds.includes(accessory.id); return <label className="checkbox-line" key={accessory.id}><input type="checkbox" checked={!isMissing} onChange={e => setMissingAccessoryIds(current => e.target.checked ? current.filter(id => id !== accessory.id) : [...current, accessory.id])} />{accessory.name}</label> })}</div> : <p className="hint">No accessories were recorded for this asset.</p>}<p className="hint">Uncheck any accessory that did not come back. The asset will stay unavailable until an Admin resolves it.</p></fieldset>}<Field label="Notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field><div className="form-actions"><button onClick={() => setOutcomeItem(null)}>Cancel</button><button className="primary" disabled={busy} onClick={resolve}>Save outcome</button></div></div>}
  </div>}</div></div>
}

function Accounts({ revision, reload }: { revision: number; reload: () => void }) {
  const { data, error, loading } = usePage<User>('/users/', revision)
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  return <><PageHeader title="Staff accounts" description="Only admins can create or change IT office accounts." action={<button className="primary" onClick={() => setEditing('new')}><Plus size={17} /> Add staff</button>} />{error && <Notice>{error}</Notice>}<div className="panel table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>{data?.results.map(user => <tr key={user.id}><td className="strong">{user.name}</td><td>{user.email}</td><td><Badge value={user.role} /></td><td>{user.is_active ? 'Yes' : 'No'}</td><td><button className="text-button" onClick={() => setEditing(user)}>Edit</button></td></tr>)}</tbody></table>{loading && <p className="empty">Loading staff…</p>}</div>{editing && <AccountForm user={editing === 'new' ? null : editing} close={() => setEditing(null)} saved={() => { setEditing(null); reload() }} />}</>
}

function AccountForm({ user, close, saved }: { user: User | null; close: () => void; saved: () => void }) {
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [role, setRole] = useState(user?.role || 'staff')
  const [active, setActive] = useState(user?.is_active ?? true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await api(user ? `/users/${user.id}/` : '/users/', { method: user ? 'PATCH' : 'POST', body: JSON.stringify({ name, email, role, is_active: active, ...(password ? { password } : {}) }) }); saved() }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="overlay" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-label="Staff account"><div className="dialog-head"><h2>{user ? 'Edit staff account' : 'Add staff account'}</h2><button onClick={close} aria-label="Close">×</button></div><form className="form-stack" onSubmit={submit}>{error && <Notice>{error}</Notice>}<Field label="Name"><input required value={name} onChange={e => setName(e.target.value)} /></Field><Field label="Email"><input required type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="Role"><select value={role} onChange={e => setRole(e.target.value as User['role'])}><option value="staff">Staff</option><option value="admin">Admin</option></select></Field><Field label={user ? 'New password (leave blank to keep)' : 'Initial password'}><input type="password" minLength={8} required={!user} value={password} onChange={e => setPassword(e.target.value)} /></Field>{user && <label className="checkbox-line"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active account</label>}<div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy}>Save account</button></div></form></div></div>
}

function PasswordDialog({ close }: { close: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    try { await api('/auth/password/', { method: 'POST', body: JSON.stringify({ current_password: current, new_password: next }) }); setDone(true) }
    catch (reason) { setError(String(reason)) }
  }
  return <div className="overlay"><div className="dialog" role="dialog" aria-modal="true" aria-label="Change password"><div className="dialog-head"><h2>Change password</h2><button onClick={close} aria-label="Close">×</button></div>{done ? <><Notice tone="success">Password updated.</Notice><button onClick={close}>Close</button></> : <form onSubmit={submit} className="form-stack">{error && <Notice>{error}</Notice>}<Field label="Current password"><input type="password" required value={current} onChange={e => setCurrent(e.target.value)} /></Field><Field label="New password"><input type="password" required minLength={8} value={next} onChange={e => setNext(e.target.value)} /></Field><div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary">Update password</button></div></form>}</div></div>
}

function SignIn({ signedIn }: { signedIn: (user: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { signedIn(await login(email, password)) }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="sign-in-page"><div className="sign-in-brand"><img src={logo} alt="TGC" /><span>Tanzania Gemmological Centre</span><h1>IT Store</h1><p>A clear record of every item that leaves the office, and every item that returns.</p></div><form className="sign-in-card" onSubmit={submit}><h2>Staff sign in</h2><p>Use your IT office account to continue.</p>{error && <Notice>{error}</Notice>}<Field label="Email"><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field><button className="primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></div>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(hasSession())
  const [section, setSection] = useState<Section>('dashboard')
  const [revision, setRevision] = useState(0)
  const [changingPassword, setChangingPassword] = useState(false)
  useEffect(() => {
    if (!hasSession()) return
    api<User>('/auth/me/').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    const expired = () => setUser(null)
    window.addEventListener('itstore:session-expired', expired)
    return () => window.removeEventListener('itstore:session-expired', expired)
  }, [])
  const reload = () => setRevision(value => value + 1)
  async function signOut() { try { await logout() } finally { setUser(null) } }
  if (loading) return <div className="loading-screen">Loading IT Store…</div>
  if (!user) return <SignIn signedIn={setUser} />
  const nav: { key: Section; label: string; icon: typeof Boxes }[] = [
    { key: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { key: 'assets', label: 'Assets', icon: Boxes },
    { key: 'borrowers', label: 'Borrowers', icon: Users },
    { key: 'checkouts', label: 'Checkouts', icon: ClipboardList },
    ...(user.role === 'admin' ? [{ key: 'users' as Section, label: 'Staff accounts', icon: Wrench }] : []),
  ]
  return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><img src={logo} alt="TGC" /><div><strong>IT Store</strong><small>Tanzania Gemmological Centre</small></div></div><nav aria-label="Main navigation">{nav.map(item => <button key={item.key} className={section === item.key ? 'active' : ''} onClick={() => setSection(item.key)}><item.icon size={19} />{item.label}</button>)}</nav><div className="sidebar-foot"><span>IT office inventory</span></div></aside><div className="workspace"><header className="topbar"><span className="topbar-location">IT Office / {nav.find(item => item.key === section)?.label}</span><div className="topbar-actions"><span className="signed-user">{user.name} <small>{user.role}</small></span><button onClick={() => setChangingPassword(true)}>Password</button><button onClick={signOut} title="Sign out"><LogOut size={17} /> Sign out</button></div></header><main>{section === 'dashboard' && <Dashboard revision={revision} navigate={setSection} />}{section === 'assets' && <Assets user={user} revision={revision} reload={reload} />}{section === 'borrowers' && <Borrowers revision={revision} reload={reload} />}{section === 'checkouts' && <Checkouts revision={revision} reload={reload} />}{section === 'users' && user.role === 'admin' && <Accounts revision={revision} reload={reload} />}</main></div>{changingPassword && <PasswordDialog close={() => setChangingPassword(false)} />}</div>
}
