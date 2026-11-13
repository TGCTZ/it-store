import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Boxes, Check, ClipboardList, Eye, LogOut, Pencil, Plus, Search, Settings, Trash2, UserPlus, Users, X } from 'lucide-react'
import { api, errorMessage, hasSession, login, logout } from './lib/api'
import type { AccessoryOption, Asset, AssetStatus, Checkout, CheckoutItem, Page, Person, User } from './lib/types'
import logo from './assets/tgc-logo.webp'

type Section = 'assets' | 'people' | 'checkouts'

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

type ToastTone = 'success' | 'error'
const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {})

function useToast() {
  return useContext(ToastContext)
}

function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null)
  const nextId = useRef(0)
  const showToast = (message: string, tone: ToastTone = 'success') => setToast({ id: ++nextId.current, message, tone })
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])
  return <ToastContext.Provider value={showToast}>{children}{toast && <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}</ToastContext.Provider>
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ')
}

function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value.replaceAll('_', '-')}`}>{statusLabel(value)}</span>
}

function Pager({ page, count, pageSize, onChange, onPageSizeChange }: { page: number; count: number; pageSize: number; onChange: (page: number) => void; onPageSizeChange: (size: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (count === 0) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, count)
  return <div className="pager">
    <span>Showing {first}–{last} of {count}</span>
    <div className="pager-controls">
      <label>Rows per page <select value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  </div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

function fullName(firstName: string, lastName: string) {
  return `${firstName.trim()} ${lastName.trim()}`.trim().toLocaleUpperCase()
}

function assetName(name: string) {
  return name.toLocaleUpperCase()
}

function dateOnly(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Dar_es_Salaam', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)) : '—'
}

function weekday(value: string | null) {
  return value ? new Intl.DateTimeFormat('en', { timeZone: 'Africa/Dar_es_Salaam', weekday: 'long' }).format(new Date(value)) : ''
}

function todayDateInput() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Dar_es_Salaam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function firstDayOfMonthInput() {
  return `${todayDateInput().slice(0, 8)}01`
}

function PageHeader({ title, description, action, className = '' }: { title: string; description: string; action?: ReactNode; className?: string }) {
  return <div className={`page-header ${className}`}><div className="page-heading"><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function Assets({ revision, reload }: { revision: number; reload: () => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editing, setEditing] = useState<Asset | 'new' | null>(null)
  const [managingAccessories, setManagingAccessories] = useState(false)
  const path = `/assets/?page=${page}&page_size=${pageSize}&q=${encodeURIComponent(q)}&status=${status}`
  const { data, error, loading } = usePage<Asset>(path, revision)
  async function deleteAsset(asset: Asset) {
    if (!window.confirm(`Delete ${assetName(asset.name)}? Assets with checkout history must be retired instead.`)) return
    try { await api(`/assets/${asset.id}/`, { method: 'DELETE' }); toast('Asset deleted.'); reload() }
    catch (reason) { toast(errorMessage(reason instanceof Error ? reason.message : reason), 'error') }
  }
  return <>
    <PageHeader className="assets-page-header" title="Assets" description="Each device or tool has a unique name and a record of its included accessories." action={<button className="primary" onClick={() => setEditing('new')}><Plus size={17} /> Add asset</button>} />
    <div className="toolbar assets-toolbar"><div className="search"><Search size={18} /><input aria-label="Search assets" placeholder="Search by name" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />{q && <button type="button" className="search-clear" aria-label="Clear asset search" title="Clear search" onClick={() => { setQ(''); setPage(1) }}><X size={16} /></button>}</div><select aria-label="Filter assets" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['available', 'checked_out', 'missing_accessories', 'needs_repair', 'lost', 'retired'].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select><button className="manage-accessories-button" onClick={() => setManagingAccessories(true)}>Manage accessories</button></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th>Name</th><th>Included accessories</th><th>Status</th><th></th></tr></thead><tbody>{data?.results.map(asset => <tr key={asset.id}><td className="strong">{assetName(asset.name)}</td><td>{asset.accessory_items.length ? asset.accessory_items.map(item => item.name).join(', ') : '—'}</td><td><Badge value={asset.status} /></td><td className="row-actions"><button className="text-button" onClick={() => setEditing(asset)}>Edit</button><button className="text-button destructive" onClick={() => deleteAsset(asset)}><Trash2 size={14} /> Delete</button></td></tr>)}</tbody></table>{loading && <p className="empty">Loading assets…</p>}{!loading && !data?.results.length && <p className="empty">No assets found.</p>}</div>
    <Pager page={page} count={data?.count || 0} pageSize={pageSize} onChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
    {editing && <AssetForm asset={editing === 'new' ? null : editing} close={() => setEditing(null)} saved={() => { toast(editing === 'new' ? 'Asset added.' : 'Asset updated.'); setEditing(null); reload() }} />}
    {managingAccessories && <AccessoryManager close={() => setManagingAccessories(false)} saved={reload} />}
  </>
}

function AssetForm({ asset, close, saved }: { asset: Asset | null; close: () => void; saved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(asset?.name || '')
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
        body: JSON.stringify({ name, accessory_ids: accessoryIds, ...(asset ? { status } : {}) }),
      })
      saved()
    } catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') } finally { setBusy(false) }
  }
  return <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}><div className="dialog" role="dialog" aria-modal="true" aria-label={asset ? 'Edit asset' : 'Add asset'}><div className="dialog-head"><h2>{asset ? 'Edit asset' : 'Add asset'}</h2><button onClick={close} aria-label="Close">×</button></div><form onSubmit={submit} className="form-stack">
    {error && <Notice>{error}</Notice>}
    <Field label="Name *"><input required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="For example, Projector 1" /></Field>
    <fieldset className="accessory-field"><legend>Included accessories</legend>{accessories.length ? <div className="accessory-options">{accessories.map(option => <label className="checkbox-line" key={option.id}><input type="checkbox" checked={accessoryIds.includes(option.id)} onChange={event => { const checked = event.currentTarget.checked; setAccessoryIds(current => checked ? [...current, option.id] : current.filter(id => id !== option.id)) }} />{option.name}</label>)}</div> : <p className="hint">No accessory options yet. Add them from Manage accessories.</p>}</fieldset>
    {asset && <Field label="Status"><select value={status} disabled={asset.status === 'checked_out'} onChange={e => setStatus(e.target.value as AssetStatus)}>{['available', 'missing_accessories', 'needs_repair', 'lost', 'retired'].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></Field>}
    <div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save asset'}</button></div>
  </form></div></div>
}

function AccessoryManager({ close, saved }: { close: () => void; saved: () => void }) {
  const toast = useToast()
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
    try { await api('/accessories/', { method: 'POST', body: JSON.stringify({ name }) }); setName(''); await reloadOptions(); toast('Accessory option added.'); saved() }
    catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') } finally { setBusy(false) }
  }
  async function updateOption(option: AccessoryOption, nextName: string) {
    setError('')
    try { await api(`/accessories/${option.id}/`, { method: 'PATCH', body: JSON.stringify({ name: nextName }) }); await reloadOptions(); toast('Accessory option updated.'); saved() }
    catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') }
  }
  async function deleteOption(option: AccessoryOption) {
    if (!window.confirm(`Delete ${option.name}? It must first be removed from every asset that uses it.`)) return
    setError('')
    try { await api(`/accessories/${option.id}/`, { method: 'DELETE' }); await reloadOptions(); toast('Accessory option deleted.'); saved() }
    catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') }
  }
  return <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}><div className="dialog wide" role="dialog" aria-modal="true" aria-label="Manage accessories"><div className="dialog-head"><h2>Manage accessories</h2><button onClick={close} aria-label="Close">×</button></div><div className="form-stack">
    {error && <Notice>{error}</Notice>}
    <form className="accessory-create" onSubmit={createOption}><Field label="New accessory option"><input required value={name} onChange={e => setName(e.target.value)} placeholder="For example, Power cable" /></Field><button className="primary" disabled={busy}><Plus size={16} /> Add option</button></form>
    <div className="accessory-option-list">{options.map(option => <AccessoryOptionRow key={option.id} option={option} save={updateOption} remove={deleteOption} />)}</div>
    <div className="form-actions"><button onClick={close}>Done</button></div>
  </div></div></div>
}

function AccessoryOptionRow({ option, save, remove }: { option: AccessoryOption; save: (option: AccessoryOption, name: string) => Promise<void>; remove: (option: AccessoryOption) => Promise<void> }) {
  const [name, setName] = useState(option.name)
  const hasNameChange = name.trim() !== option.name
  return <div className="accessory-option-row"><input aria-label={`Accessory name ${option.name}`} value={name} onChange={e => setName(e.target.value)} /><button disabled={!hasNameChange || !name.trim()} onClick={() => save(option, name)}>Save</button><button className="icon-delete" onClick={() => remove(option)} aria-label={`Delete ${option.name}`} title="Delete accessory"><Trash2 size={15} /></button></div>
}

function People({ revision, reload }: { revision: number; reload: () => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  const { data, error, loading } = usePage<Person>(`/people/?page=${page}&page_size=${pageSize}&q=${encodeURIComponent(q)}`, revision)
  async function deletePerson(person: Person) {
    if (!window.confirm(`Delete ${fullName(person.first_name, person.last_name)}? People with checkout history cannot be deleted.`)) return
    try { await api(`/people/${person.id}/`, { method: 'DELETE' }); toast('Person deleted.'); reload() }
    catch (reason) { toast(errorMessage(reason instanceof Error ? reason.message : reason), 'error') }
  }
  return <>
    <PageHeader title="People" description="Save recipient contact details for future checkouts." action={<button className="primary" onClick={() => setEditing('new')}><Plus size={17} /> Add person</button>} />
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search people" placeholder="Search name or phone" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />{q && <button type="button" className="search-clear" aria-label="Clear people search" title="Clear search" onClick={() => { setQ(''); setPage(1) }}><X size={16} /></button>}</div></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th>Full name</th><th>Phone</th><th>Recipient type</th><th></th></tr></thead><tbody>{data?.results.map(person => <tr key={person.id}><td className="strong">{fullName(person.first_name, person.last_name)}</td><td>{person.phone}</td><td>{person.recipient_type || '—'}</td><td className="row-actions"><button className="text-button" onClick={() => setEditing(person)}>Edit</button><button className="text-button destructive" onClick={() => deletePerson(person)}><Trash2 size={14} /> Delete</button></td></tr>)}</tbody></table>{loading && <p className="empty">Loading people…</p>}{!loading && !data?.results.length && <p className="empty">No people found.</p>}</div><Pager page={page} count={data?.count || 0} pageSize={pageSize} onChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
    {editing && <PersonForm person={editing === 'new' ? null : editing} close={() => setEditing(null)} saved={() => { toast(editing === 'new' ? 'Person added.' : 'Person updated.'); setEditing(null); reload() }} />}
  </>
}

function PersonForm({ person, close, saved }: { person: Person | null; close: () => void; saved: () => void }) {
  const toast = useToast()
  const [firstName, setFirstName] = useState(person?.first_name || '')
  const [lastName, setLastName] = useState(person?.last_name || '')
  const [phone, setPhone] = useState(person?.phone || '')
  const [type, setType] = useState(person?.recipient_type || 'employee')
  const [possibleMatches, setPossibleMatches] = useState<Person[]>([])
  const [checkingMatches, setCheckingMatches] = useState(false)
  const [matchCheckError, setMatchCheckError] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const first = firstName.trim()
    const last = lastName.trim()
    const digits = phone.replace(/\D/g, '')
    if (person || !first || !last || !digits) {
      setPossibleMatches([])
      setCheckingMatches(false)
      setMatchCheckError(false)
      return
    }
    let active = true
    setCheckingMatches(true)
    setMatchCheckError(false)
    setPossibleMatches([])
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        duplicate_check: '1', first_name: first, last_name: last,
        phone: phone.trim(), recipient_type: type,
      })
      api<Page<Person>>(`/people/?${params.toString()}`)
        .then(result => {
          if (!active) return
          const normalizedFirst = first.toLocaleLowerCase()
          const normalizedLast = last.toLocaleLowerCase()
          setPossibleMatches(result.results.filter(existing => {
            return existing.first_name.trim().toLocaleLowerCase() === normalizedFirst &&
              existing.last_name.trim().toLocaleLowerCase() === normalizedLast &&
              existing.phone.replace(/\D/g, '') === digits &&
              existing.recipient_type === type
          }))
        })
        .catch(() => { if (active) { setPossibleMatches([]); setMatchCheckError(true) } })
        .finally(() => { if (active) setCheckingMatches(false) })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [firstName, lastName, phone, type, person])
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api(person ? `/people/${person.id}/` : '/people/', {
        method: person ? 'PATCH' : 'POST', body: JSON.stringify({ first_name: firstName.trim(), last_name: lastName.trim(), phone, recipient_type: type }),
      })
      saved()
    } catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') } finally { setBusy(false) }
  }
  return <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}><div className="dialog" role="dialog" aria-modal="true" aria-label={person ? 'Edit person' : 'Add person'}><div className="dialog-head"><h2>{person ? 'Edit person' : 'Add person'}</h2><button onClick={close} aria-label="Close">×</button></div><form onSubmit={submit} className="form-stack">
    {error && <Notice>{error}</Notice>}<div className="person-name-grid"><Field label="First name"><input required value={firstName} onChange={e => setFirstName(e.target.value)} /></Field><Field label="Last name"><input required value={lastName} onChange={e => setLastName(e.target.value)} /></Field></div><div className="person-contact-grid"><Field label="Phone number"><input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field><Field label="Recipient type"><select required value={type} onChange={e => setType(e.target.value)}>{['employee', 'student', 'guest'].map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></Field></div>
    {checkingMatches && <p className="hint">Checking existing people…</p>}
    {matchCheckError && <p className="hint">Could not check for existing people. You can still save.</p>}
    {possibleMatches.length > 0 && <section className="duplicate-suggestions" aria-live="polite"><strong>Possible existing people</strong><p>All person details match this record.</p><ul>{possibleMatches.map(existing => <li key={existing.id}><span><strong>{fullName(existing.first_name, existing.last_name)}</strong><small>{existing.phone} · {existing.recipient_type}</small></span><small>Exact match</small></li>)}</ul></section>}
    <div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save person'}</button></div>
  </form></div></div>
}

function Checkouts({ revision, reload }: { revision: number; reload: () => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('checked_out')
  const [dateFrom, setDateFrom] = useState(() => firstDayOfMonthInput())
  const [dateTo, setDateTo] = useState(() => todayDateInput())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editingCheckout, setEditingCheckout] = useState<{ checkoutId: number; item: CheckoutItem } | null>(null)
  const [returningItem, setReturningItem] = useState<CheckoutItem | null>(null)
  const [returnedAccessoryIds, setReturnedAccessoryIds] = useState<number[]>([])
  const [returnBusy, setReturnBusy] = useState(false)
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize), q, status })
  if (dateFrom) query.set('date_from', dateFrom)
  if (dateTo) query.set('date_to', dateTo)
  const { data, error, loading } = usePage<Checkout>(`/checkouts/?${query.toString()}`, revision)
  async function confirmReturn() {
    if (!returningItem) return
    setReturnBusy(true)
    const missingAccessoryIds = returningItem.accessory_snapshot
      .filter(accessory => !returnedAccessoryIds.includes(accessory.id))
      .map(accessory => accessory.id)
    try {
      await api(`/checkout-items/${returningItem.id}/resolve/`, { method: 'POST', body: JSON.stringify({ outcome: 'returned', missing_accessory_ids: missingAccessoryIds }) })
      toast(missingAccessoryIds.length
        ? `${assetName(returningItem.asset_name)} returned with missing accessories; it needs resolution.`
        : `${assetName(returningItem.asset_name)} returned with all listed accessories.`)
      setReturningItem(null)
      reload()
    } catch (reason) { toast(errorMessage(reason instanceof Error ? reason.message : reason), 'error') }
    finally { setReturnBusy(false) }
  }
  return <>
    <PageHeader title="Checkouts" description="Track issued items and partial returns." action={<button className="primary" onClick={() => setCreating(true)}><Plus size={17} /> New checkout</button>} />
    <div className="toolbar checkout-toolbar"><div className="search"><Search size={18} /><input aria-label="Search checkouts" placeholder="Search recipient or phone" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />{q && <button type="button" className="search-clear" aria-label="Clear checkout search" title="Clear search" onClick={() => { setQ(''); setPage(1) }}><X size={16} /></button>}</div><select aria-label="Filter checkout items by status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All item statuses</option><option value="checked_out">Checked out</option><option value="returned">Returned</option><option value="partially_returned">Partially returned</option><option value="returned_damaged">Returned damaged</option><option value="lost">Lost</option></select><div className="date-range-filter"><label>From<input aria-label="Filter checkouts from date" type="date" value={dateFrom} max={dateTo || undefined} onChange={e => { setDateFrom(e.target.value); setPage(1) }} /></label><label>To<input aria-label="Filter checkouts to date" type="date" value={dateTo} min={dateFrom || undefined} onChange={e => { setDateTo(e.target.value); setPage(1) }} /></label><button type="button" className="clear-date-filter" disabled={dateFrom === firstDayOfMonthInput() && dateTo === todayDateInput()} onClick={() => { setDateFrom(firstDayOfMonthInput()); setDateTo(todayDateInput()); setPage(1) }}>Clear dates</button></div></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th className="checkout-serial">SN</th><th>Full name</th><th>Phone number</th><th>Asset name</th><th>Issued on</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data?.results.flatMap(checkout => checkout.items.map(item => <tr key={item.id} className="checkout-row" tabIndex={0} aria-label={`Open checkout #${checkout.id} details for ${assetName(item.asset_name)}`} onClick={event => { if (event.target instanceof Element && event.target.closest('button')) return; setSelectedId(checkout.id) }} onKeyDown={event => { if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return; event.preventDefault(); setSelectedId(checkout.id) }}><td className="strong checkout-serial">#{checkout.id}</td><td>{fullName(checkout.recipient_first_name, checkout.recipient_last_name)}</td><td>{checkout.recipient_phone}</td><td>{assetName(item.asset_name)}</td><td><span>{dateOnly(checkout.issued_at)}</span><small className="issued-weekday">{weekday(checkout.issued_at)}</small></td><td><Badge value={item.status} /></td><td className="row-actions">{item.status === 'checked_out' && <><button className="text-button action-edit" onClick={() => setEditingCheckout({ checkoutId: checkout.id, item })}><Pencil size={14} /> Edit</button><button className="text-button action-return" onClick={() => { setReturningItem(item); setReturnedAccessoryIds(item.accessory_snapshot.map(accessory => accessory.id)) }}><Check size={14} /> Mark returned</button></>}<button className="text-button action-open" onClick={() => setSelectedId(checkout.id)}><Eye size={14} /> Open</button></td></tr>))}</tbody></table>{loading && <p className="empty">Loading checkouts…</p>}{!loading && !data?.results.length && <p className="empty">No checkouts found.</p>}</div><Pager page={page} count={data?.count || 0} pageSize={pageSize} onChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1) }} />
    {creating && <CheckoutForm close={() => setCreating(false)} saved={() => { toast('Checkout created.'); setCreating(false); reload() }} />}
    {editingCheckout && <CheckoutEditForm checkoutId={editingCheckout.checkoutId} item={editingCheckout.item} close={() => setEditingCheckout(null)} saved={() => { setEditingCheckout(null); toast('Checkout updated.'); reload() }} />}
    {selectedId && <CheckoutDetail id={selectedId} revision={revision} close={() => setSelectedId(null)} reload={reload} />}
    {returningItem && <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget && !returnBusy) setReturningItem(null) }}><div className="dialog return-confirm-dialog" role="dialog" aria-modal="true" aria-label={`Confirm return for ${assetName(returningItem.asset_name)}`}><div className="dialog-head"><h2>Confirm asset return</h2><button disabled={returnBusy} onClick={() => setReturningItem(null)} aria-label="Close">×</button></div><div className="form-stack"><p><strong>{assetName(returningItem.asset_name)}</strong> is being returned. Confirm which listed accessories came back.</p>{returningItem.accessory_snapshot.length ? <fieldset className="accessory-field"><legend>Accessories received</legend><div className="accessory-options">{returningItem.accessory_snapshot.map(accessory => <label className="checkbox-line" key={accessory.id}><input type="checkbox" checked={returnedAccessoryIds.includes(accessory.id)} onChange={event => { const checked = event.currentTarget.checked; setReturnedAccessoryIds(current => checked ? [...current, accessory.id] : current.filter(id => id !== accessory.id)) }} />{accessory.name}</label>)}</div><p className="hint">Uncheck any missing accessory. The asset will remain unavailable until an Admin resolves it.</p></fieldset> : <p className="hint">No accessories were listed for this asset.</p>}<div className="form-actions"><button disabled={returnBusy} onClick={() => setReturningItem(null)}>Cancel</button><button className="primary action-return-submit" disabled={returnBusy} onClick={confirmReturn}>{returnBusy ? 'Saving…' : 'Confirm return'}</button></div></div></div></div>}
  </>
}

function CheckoutForm({ close, saved }: { close: () => void; saved: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [personSearch, setPersonSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [assetSearch, setAssetSearch] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [recipientId, setRecipientId] = useState(0)
  const [pickedPerson, setPickedPerson] = useState<Person | null>(null)
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newType, setNewType] = useState('employee')
  const [recipientMatches, setRecipientMatches] = useState<Person[]>([])
  const [checkingRecipientMatches, setCheckingRecipientMatches] = useState(false)
  const [recipientMatchCheckError, setRecipientMatchCheckError] = useState(false)
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null)
  const [selectedAccessoryIds, setSelectedAccessoryIds] = useState<number[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (mode !== 'existing' || pickedPerson || personSearch.trim().length < 2) {
      setPeople([])
      setSearching(false)
      return
    }
    let active = true
    setPeople([])
    setSearching(true)
    const timer = setTimeout(() => {
      api<Page<Person>>(`/people/?q=${encodeURIComponent(personSearch.trim())}`)
        .then(data => { if (active) setPeople(data.results) })
        .catch((reason: unknown) => { if (active) setError(String(reason)) })
        .finally(() => { if (active) setSearching(false) })
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [personSearch, mode, pickedPerson])
  useEffect(() => {
    const first = newFirstName.trim()
    const last = newLastName.trim()
    const digits = newPhone.replace(/\D/g, '')
    if (mode !== 'new' || !first || !last || !digits) {
      setRecipientMatches([])
      setCheckingRecipientMatches(false)
      setRecipientMatchCheckError(false)
      return
    }
    let active = true
    setCheckingRecipientMatches(true)
    setRecipientMatchCheckError(false)
    setRecipientMatches([])
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        duplicate_check: '1', first_name: first, last_name: last,
        phone: newPhone.trim(), recipient_type: newType,
      })
      api<Page<Person>>(`/people/?${params.toString()}`)
        .then(result => {
          if (!active) return
          const normalizedFirst = first.toLocaleLowerCase()
          const normalizedLast = last.toLocaleLowerCase()
          setRecipientMatches(result.results.filter(existing => {
            return existing.first_name.trim().toLocaleLowerCase() === normalizedFirst &&
              existing.last_name.trim().toLocaleLowerCase() === normalizedLast &&
              existing.phone.replace(/\D/g, '') === digits &&
              existing.recipient_type === newType
          }))
        })
        .catch(() => { if (active) { setRecipientMatches([]); setRecipientMatchCheckError(true) } })
        .finally(() => { if (active) setCheckingRecipientMatches(false) })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [newFirstName, newLastName, newPhone, newType, mode])
  useEffect(() => { allPages<Asset>('/assets/?status=available').then(setAssets).catch((reason: unknown) => setError(String(reason))) }, [])
  function switchMode(next: 'existing' | 'new') {
    if (next === 'new') {
      setPickedPerson(null)
      setRecipientId(0)
    }
    setError('')
    setMode(next)
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    if (mode === 'existing' && !recipientId) { setError('Find a person or register a new one.'); return }
    if (mode === 'new' && (!newFirstName.trim() || !newLastName.trim() || !newPhone.trim())) { setError('First name, last name, and phone are required for a new person.'); return }
    if (selectedAssetId === null) { setError('Select one available asset.'); return }
    setBusy(true)
    try {
      const who = mode === 'new'
        ? { recipient_data: { first_name: newFirstName.trim(), last_name: newLastName.trim(), phone: newPhone.trim(), recipient_type: newType } }
        : { recipient: recipientId }
      await api('/checkouts/', { method: 'POST', body: JSON.stringify({ ...who, asset_id: selectedAssetId, accessory_ids: selectedAccessoryIds }) })
      saved()
    } catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') } finally { setBusy(false) }
  }
  const selectedAsset = assets.find(asset => asset.id === selectedAssetId)
  const visibleAssets = assets.filter(asset => asset.id === selectedAssetId || `${asset.name} ${asset.accessory_items.map(item => item.name).join(' ')}`.toLowerCase().includes(assetSearch.toLowerCase()))
  return <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}><div className="dialog checkout-dialog" role="dialog" aria-modal="true" aria-label="Create checkout">
    <div className="dialog-head"><h2>Create checkout</h2><button onClick={close} aria-label="Close">×</button></div>
    <form onSubmit={submit} className="checkout-form">
      <div className="dialog-body form-stack">
        {error && <Notice>{error}</Notice>}
        <section className="intake-section" aria-label="Recipient selection">
          <h3>Recipient <span className="required-mark">*</span></h3>
            {mode === 'existing' && pickedPerson ? <div className="selected-contact"><div><strong>{fullName(pickedPerson.first_name, pickedPerson.last_name)}</strong><small>{pickedPerson.phone}{pickedPerson.recipient_type ? ` · ${pickedPerson.recipient_type}` : ''}</small></div><button type="button" onClick={() => { setPickedPerson(null); setRecipientId(0) }}><X size={15} /> Change</button></div> : <>
            <div className="choice-tabs" role="tablist" aria-label="Recipient"><button type="button" role="tab" aria-selected={mode === 'existing'} className={mode === 'existing' ? 'selected' : ''} onClick={() => switchMode('existing')}><Search size={16} /> Existing person</button><button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'selected' : ''} onClick={() => switchMode('new')}><UserPlus size={16} /> New person</button></div>
            {mode === 'existing' ? <div className="form-stack picker-content"><div className="search"><Search size={17} /><input aria-label="Search people" autoComplete="off" placeholder="Search by name or phone…" value={personSearch} onChange={e => setPersonSearch(e.target.value)} />{personSearch && <button type="button" className="search-clear" aria-label="Clear person search" title="Clear search" onClick={() => setPersonSearch('')}><X size={16} /></button>}</div>
              {personSearch.trim().length < 2 && <p className="hint">Type at least 2 characters to search people.</p>}
              {searching && <p className="hint">Searching people…</p>}
              {personSearch.trim().length >= 2 && !searching && people.length > 0 && <ul className="people-results" aria-label="Matching people">{people.map(person => <li key={person.id}><button type="button" onClick={() => { setPickedPerson(person); setRecipientId(person.id); setError('') }}><Check size={16} /><span><strong>{fullName(person.first_name, person.last_name)}</strong><small>{person.phone}{person.recipient_type ? ` · ${person.recipient_type}` : ''}</small></span></button></li>)}</ul>}
              {personSearch.trim().length >= 2 && !searching && people.length === 0 && <div className="no-match"><span>No person matches “{personSearch.trim()}”.</span><button type="button" onClick={() => switchMode('new')}><UserPlus size={15} /> Register person</button></div>}
            </div> : <div className="inline-register"><div className="register-grid"><Field label="First name *"><input required value={newFirstName} onChange={e => setNewFirstName(e.target.value)} /></Field><Field label="Last name *"><input required value={newLastName} onChange={e => setNewLastName(e.target.value)} /></Field><Field label="Phone *"><input required type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} /></Field><Field label="Recipient type"><select required value={newType} onChange={e => setNewType(e.target.value)}>{['employee', 'student', 'guest'].map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></Field></div>
              {checkingRecipientMatches && <p className="hint">Checking existing people…</p>}
              {recipientMatchCheckError && <p className="hint">Could not check for existing people. You can still save.</p>}
              {recipientMatches.length > 0 && <section className="duplicate-suggestions" aria-live="polite"><strong>Possible existing people</strong><p>Select a person to use their saved details for this checkout.</p><ul>{recipientMatches.map(existing => <li key={existing.id}><button type="button" className="duplicate-suggestion" onClick={() => { setPickedPerson(existing); setRecipientId(existing.id); setPersonSearch(''); setMode('existing'); setRecipientMatches([]); setError('') }}><span><strong>{fullName(existing.first_name, existing.last_name)}</strong><small>{existing.phone} · {existing.recipient_type}</small></span><small>Exact match</small><b>Use this person</b></button></li>)}</ul></section>}
            </div>}
          </>}
        </section>
        <p className="hint">{selectedAsset ? `Selected: ${assetName(selectedAsset.name)}` : 'Select one available asset for this checkout.'}</p>
        <section className="intake-section" aria-label="Asset selection"><h3>Asset <span className="required-mark">*</span></h3><div className="search"><Search size={17} /><input aria-label="Search available assets" value={assetSearch} onChange={e => setAssetSearch(e.target.value)} placeholder="Search by asset name…" />{assetSearch && <button type="button" className="search-clear" aria-label="Clear asset search" title="Clear search" onClick={() => setAssetSearch('')}><X size={16} /></button>}</div><div className="asset-picker" aria-label="Available assets">{visibleAssets.length ? visibleAssets.map(asset => {
          const isSelected = selectedAssetId === asset.id
          return <div key={asset.id} className="pick-row">
            <label className="pick-main"><input type="radio" name="checkout-asset" required checked={isSelected} onChange={() => { setSelectedAssetId(asset.id); setSelectedAccessoryIds(asset.accessory_items.filter(item => !asset.missing_accessory_ids.includes(item.id)).map(item => item.id)) }} /><strong>{assetName(asset.name)}</strong></label>
            {isSelected && asset.accessory_items.length > 0 && <fieldset className="pick-accessories"><legend>Accessories going with this asset</legend>{asset.accessory_items.map(item => {
              const isMissing = asset.missing_accessory_ids.includes(item.id)
              return <label key={item.id} className={isMissing ? 'accessory-missing' : ''}><input type="checkbox" checked={!isMissing && selectedAccessoryIds.includes(item.id)} disabled={isMissing} onChange={event => { const checked = event.currentTarget.checked; setSelectedAccessoryIds(current => checked ? [...current, item.id] : current.filter(id => id !== item.id)) }} />{item.name}{isMissing && <small>Missing</small>}</label>
            })}</fieldset>}
          </div>
        }) : <p className="empty">No available assets found.</p>}</div></section>
      </div>
      <div className="dialog-footer"><button type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create checkout'}</button></div>
    </form>
  </div></div>
}

function CheckoutDetail({ id, revision, close, reload }: { id: number; revision: number; close: () => void; reload: () => void }) {
  const toast = useToast()
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [error, setError] = useState('')
  const [outcomeItem, setOutcomeItem] = useState<CheckoutItem | null>(null)
  const [editingItem, setEditingItem] = useState<CheckoutItem | null>(null)
  const [outcome, setOutcome] = useState<'returned' | 'returned_damaged' | 'lost'>('returned')
  const [notes, setNotes] = useState('')
  const [missingAccessoryIds, setMissingAccessoryIds] = useState<number[]>([])
  const [restoringItemId, setRestoringItemId] = useState<number | null>(null)
  const [receivedAccessoryIds, setReceivedAccessoryIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<Checkout>(`/checkouts/${id}/`).then(setCheckout).catch((reason: unknown) => setError(String(reason)))
  }, [id, revision])
  async function resolve() {
    if (!outcomeItem) return
    setBusy(true); setError('')
    try { await api(`/checkout-items/${outcomeItem.id}/resolve/`, { method: 'POST', body: JSON.stringify({ outcome, notes, missing_accessory_ids: outcome === 'lost' ? [] : missingAccessoryIds }) }); toast('Item outcome recorded.'); setOutcomeItem(null); setNotes(''); setMissingAccessoryIds([]); reload() }
    catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') } finally { setBusy(false) }
  }
  async function recordAccessoriesReceived(item: CheckoutItem) {
    if (!receivedAccessoryIds.length) return
    setBusy(true); setError('')
    try {
      await api(`/checkout-items/${item.id}/accessories-received/`, { method: 'POST', body: JSON.stringify({ received_accessory_ids: receivedAccessoryIds }) })
      toast('Returned accessories recorded.')
      setRestoringItemId(null)
      setReceivedAccessoryIds([])
      reload()
    } catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') } finally { setBusy(false) }
  }
  const activityEvents = checkout?.events.filter(event => event.kind !== 'checkout_created') ?? []
  return <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}><div className="dialog wide" role="dialog" aria-modal="true" aria-label={`Checkout ${id}`}><div className="dialog-head"><h2>Checkout #{id}</h2><div className="detail-actions"><button onClick={close} aria-label="Close">×</button></div></div>{error && <Notice>{error}</Notice>}{!checkout ? <p>Loading…</p> : <div className="form-stack">
    <div className="detail-grid"><div><span className="label">Recipient</span><strong>{fullName(checkout.recipient_first_name, checkout.recipient_last_name)}</strong><span>{checkout.recipient_phone}</span></div><div><span className="label">Issued</span><strong>{dateTime(checkout.issued_at)}</strong><span>By {checkout.issued_by_name}</span></div></div>
    <h3>Items</h3><div className="item-list">{checkout.items.map(item => <div className="item-row" key={item.id}>
      <div className="item-row-heading"><strong>{assetName(item.asset_name)}</strong><Badge value={item.status} /></div>
      {item.accessory_snapshot.length > 0 && <fieldset className="accessory-display"><legend>Accessories issued</legend><div className="accessory-display-options">{item.accessory_snapshot.map(accessory => { const missing = item.missing_accessories.some(entry => entry.id === accessory.id); return <span className={`accessory-display-item ${missing ? 'is-missing' : ''}`} key={accessory.id}><span>{accessory.name}</span><small>{missing ? 'Missing' : 'Included'}</small></span> })}</div></fieldset>}
      {item.missing_accessories.length > 0 && <div className="missing-accessories-alert"><strong>{item.missing_accessories.length} missing {item.missing_accessories.length === 1 ? 'accessory' : 'accessories'} · Admin resolution required</strong></div>}
      {item.notes && <small>{item.notes}</small>}
      <div className="item-row-actions">
      {item.status === 'checked_out' && <button className="text-button action-edit" onClick={() => setEditingItem(item)}><Pencil size={14} /> Edit</button>}
      {item.status === 'checked_out' && <button className="text-button action-return" onClick={() => { setOutcomeItem(item); setOutcome('returned'); setMissingAccessoryIds([]) }}><Check size={14} /> Mark returned</button>}
        {item.missing_accessories.length > 0 && <button className="text-button action-accessories" onClick={() => { setRestoringItemId(restoringItemId === item.id ? null : item.id); setReceivedAccessoryIds([]) }}>{restoringItemId === item.id ? 'Hide accessory update' : 'Record accessories received'}</button>}
      </div>
      {restoringItemId === item.id && <fieldset className="accessory-field recovery-accessory-field"><legend>Accessories received now</legend><div className="accessory-options">{item.missing_accessories.map(accessory => <label className="checkbox-line" key={accessory.id}><input type="checkbox" checked={receivedAccessoryIds.includes(accessory.id)} onChange={event => { const checked = event.currentTarget.checked; setReceivedAccessoryIds(current => checked ? [...current, accessory.id] : current.filter(id => id !== accessory.id)) }} />{accessory.name}</label>)}</div><p className="hint">Tick each missing accessory that has now been returned.</p><div className="form-actions"><button type="button" disabled={busy} onClick={() => { setRestoringItemId(null); setReceivedAccessoryIds([]) }}>Cancel</button><button className="primary action-accessories-submit" disabled={busy || !receivedAccessoryIds.length} onClick={() => recordAccessoriesReceived(item)}>Save received accessories</button></div></fieldset>}
    </div>)}</div>
    {activityEvents.length > 0 && <><h3>Activity</h3><div className="event-list">{activityEvents.map(event => <div key={event.id}><strong>{event.kind === 'checkout_updated' ? 'checkout updated' : event.kind.replaceAll('_', ' ')}</strong><span>{event.actor_name} · {dateTime(event.created_at)}</span></div>)}</div></>}
    {outcomeItem && <div className="resolve-panel"><h3>Mark {assetName(outcomeItem.asset_name)} returned</h3><Field label="Return status"><select value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)}><option value="returned">Returned</option><option value="returned_damaged">Returned damaged</option><option value="lost">Lost</option></select></Field>{outcome !== 'lost' && <fieldset className="accessory-field"><legend>Confirm returned accessories</legend>{outcomeItem.accessory_snapshot.length ? <div className="accessory-options">{outcomeItem.accessory_snapshot.map(accessory => { const isMissing = missingAccessoryIds.includes(accessory.id); return <label className="checkbox-line" key={accessory.id}><input type="checkbox" checked={!isMissing} onChange={event => { const checked = event.currentTarget.checked; setMissingAccessoryIds(current => checked ? current.filter(id => id !== accessory.id) : [...current, accessory.id]) }} />{accessory.name}</label> })}</div> : <p className="hint">No accessories were recorded for this asset.</p>}<p className="hint">Uncheck any accessory that did not come back. The asset will stay unavailable until an Admin resolves it.</p></fieldset>}<Field label="Notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field><div className="form-actions"><button onClick={() => setOutcomeItem(null)}>Cancel</button><button className="primary action-return-submit" disabled={busy} onClick={resolve}>{busy ? 'Saving…' : 'Save return details'}</button></div></div>}
  </div>}</div>{editingItem && <CheckoutEditForm checkoutId={id} item={editingItem} close={() => setEditingItem(null)} saved={() => { setEditingItem(null); toast('Checkout updated.'); reload() }} />}</div>
}

function CheckoutEditForm({ checkoutId, item, close, saved }: { checkoutId: number; item: CheckoutItem; close: () => void; saved: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetId, setAssetId] = useState(item.asset)
  const [accessoryIds, setAccessoryIds] = useState(item.accessory_snapshot.map(accessory => accessory.id))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    allPages<Asset>('/assets/').then(setAssets).catch((reason: unknown) => setError(errorMessage(reason instanceof Error ? reason.message : reason)))
  }, [])
  const selectableAssets = assets.filter(asset => asset.id === item.asset || asset.status === 'available')
  const selectedAsset = selectableAssets.find(asset => asset.id === assetId)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      await api(`/checkouts/${checkoutId}/`, { method: 'PATCH', body: JSON.stringify({ asset_id: assetId, accessory_ids: accessoryIds }) })
      saved()
    } catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : reason)) }
    finally { setBusy(false) }
  }
  return <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget && !busy) close() }}><div className="dialog edit-checkout-dialog" role="dialog" aria-modal="true" aria-label="Edit checkout"><div className="dialog-head"><h2>Edit checkout</h2><button type="button" onClick={close} disabled={busy} aria-label="Close">×</button></div><form className="form-stack" onSubmit={submit}>{error && <Notice>{error}</Notice>}<Field label="Asset"><select value={assetId} onChange={event => { const nextId = Number(event.target.value); setAssetId(nextId); const nextAsset = selectableAssets.find(asset => asset.id === nextId); setAccessoryIds(nextAsset?.accessory_items.filter(option => !nextAsset.missing_accessory_ids.includes(option.id)).map(option => option.id) || []) }}>{selectableAssets.map(asset => <option key={asset.id} value={asset.id}>{assetName(asset.name)}{asset.id === item.asset ? ' (current)' : ''}</option>)}</select></Field>{selectedAsset && <fieldset className="accessory-field"><legend>Accessories issued with this asset</legend>{selectedAsset.accessory_items.length ? <div className="accessory-options">{selectedAsset.accessory_items.map(option => { const unavailable = selectedAsset.missing_accessory_ids.includes(option.id); return <label className={`checkbox-line ${unavailable ? 'accessory-missing' : ''}`} key={option.id}><input type="checkbox" checked={!unavailable && accessoryIds.includes(option.id)} disabled={unavailable} onChange={event => { const checked = event.currentTarget.checked; setAccessoryIds(current => checked ? [...current, option.id] : current.filter(id => id !== option.id)) }} />{option.name}{unavailable && <small>Missing</small>}</label> })}</div> : <p className="hint">No accessories are assigned to this asset.</p>}</fieldset>}<p className="hint">Only active checkouts can be edited. The previous asset will become available if you select a different one.</p><div className="form-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary action-edit-submit" disabled={busy || !selectedAsset}>{busy ? 'Saving…' : 'Save changes'}</button></div></form></div></div>
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
  return <div className="overlay" onClick={event => { if (event.target === event.currentTarget) close() }}><div className="dialog" role="dialog" aria-modal="true" aria-label="Change password"><div className="dialog-head"><h2>Change password</h2><button onClick={close} aria-label="Close">×</button></div>{done ? <><Notice tone="success">Password updated.</Notice><button onClick={close}>Close</button></> : <form onSubmit={submit} className="form-stack">{error && <Notice>{error}</Notice>}<Field label="Current password"><input type="password" required value={current} onChange={e => setCurrent(e.target.value)} /></Field><Field label="New password"><input type="password" required minLength={8} value={next} onChange={e => setNext(e.target.value)} /></Field><div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary">Update password</button></div></form>}</div></div>
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
  return <div className="sign-in-page"><div className="sign-in-stack"><div className="sign-in-brand"><strong>IT STORE</strong><i /></div><form className="sign-in-card" onSubmit={submit}><h2>Sign in</h2>{error && <Notice>{error}</Notice>}<Field label="Email *"><input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="Password *"><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></Field><button className="primary full" disabled={busy}><LogOut size={16} className="login-icon" />{busy ? 'Signing in…' : 'Sign in'}</button></form></div></div>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(hasSession())
  const [section, setSection] = useState<Section>('checkouts')
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
  if (!user) return <SignIn signedIn={nextUser => { setSection('checkouts'); setUser(nextUser) }} />
  const nav: { key: Section; label: string; icon: typeof Boxes }[] = [
    { key: 'checkouts', label: 'Checkouts', icon: ClipboardList },
    { key: 'assets', label: 'Assets', icon: Boxes },
    { key: 'people', label: 'People', icon: Users },
  ]
  return <ToastProvider><div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><img src={logo} alt="IT Store" /><div><strong>IT<br />STORE</strong></div></div><nav aria-label="Main navigation"><button className={`main-nav-link ${section === 'checkouts' ? 'active' : ''}`} onClick={() => setSection('checkouts')}><ClipboardList size={18} />Checkouts</button><div className="nav-separator" /><div className="nav-caption">Ref Data</div>{nav.filter(item => item.key !== 'checkouts').map(item => <button key={item.key} className={section === item.key ? 'active' : ''} onClick={() => setSection(item.key)}><item.icon size={18} />{item.label}</button>)}</nav><div className="sidebar-profile"><div className="profile-initials">{user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</div><div className="profile-details"><strong>{user.name}</strong><small>{user.email}</small></div><button className="profile-settings" onClick={() => setChangingPassword(true)} title="Change password" aria-label="Change password"><Settings size={17} /></button><span className="profile-role">Superadmin</span><button className="profile-signout" onClick={signOut} title="Sign out"><LogOut size={14} /> Sign out</button></div></aside><div className="workspace"><main>{section === 'assets' && <Assets revision={revision} reload={reload} />}{section === 'people' && <People revision={revision} reload={reload} />}{section === 'checkouts' && <Checkouts revision={revision} reload={reload} />}</main></div>{changingPassword && <PasswordDialog close={() => setChangingPassword(false)} />}</div></ToastProvider>
}
