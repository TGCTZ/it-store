import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Boxes, Check, ClipboardList, LogOut, Plus, Search, Settings, Trash2, UserPlus, Users, X } from 'lucide-react'
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

function PageHeader({ title, description, action, className = '' }: { title: string; description: string; action?: ReactNode; className?: string }) {
  return <div className={`page-header ${className}`}><div className="page-heading"><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function Assets({ revision, reload }: { revision: number; reload: () => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Asset | 'new' | null>(null)
  const [managingAccessories, setManagingAccessories] = useState(false)
  const path = `/assets/?page=${page}&q=${encodeURIComponent(q)}&status=${status}`
  const { data, error, loading } = usePage<Asset>(path, revision)
  async function deleteAsset(asset: Asset) {
    if (!window.confirm(`Delete ${asset.name}? Assets with checkout history must be retired instead.`)) return
    try { await api(`/assets/${asset.id}/`, { method: 'DELETE' }); toast('Asset deleted.'); reload() }
    catch (reason) { toast(errorMessage(reason instanceof Error ? reason.message : reason), 'error') }
  }
  return <>
    <PageHeader className="assets-page-header" title="Assets" description="Each device or tool has a unique name and a record of its included accessories." action={<button className="primary" onClick={() => setEditing('new')}><Plus size={17} /> Add asset</button>} />
    <div className="toolbar assets-toolbar"><div className="search"><Search size={18} /><input aria-label="Search assets" placeholder="Search by name" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} /></div><select aria-label="Filter assets" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['available', 'checked_out', 'missing_accessories', 'needs_repair', 'lost', 'retired'].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select><button className="manage-accessories-button" onClick={() => setManagingAccessories(true)}>Manage accessories</button></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th>Name</th><th>Included accessories</th><th>Status</th><th></th></tr></thead><tbody>{data?.results.map(asset => <tr key={asset.id}><td className="strong">{asset.name}</td><td>{asset.accessory_items.length ? asset.accessory_items.map(item => item.name).join(', ') : '—'}</td><td><Badge value={asset.status} /></td><td className="row-actions"><button className="text-button" onClick={() => setEditing(asset)}>Edit</button><button className="text-button destructive" onClick={() => deleteAsset(asset)}><Trash2 size={14} /> Delete</button></td></tr>)}</tbody></table>{loading && <p className="empty">Loading assets…</p>}{!loading && !data?.results.length && <p className="empty">No assets found.</p>}</div>
    <Pager page={page} count={data?.count || 0} onChange={setPage} />
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
    <fieldset className="accessory-field"><legend>Included accessories</legend>{accessories.length ? <div className="accessory-options">{accessories.map(option => <label className="checkbox-line" key={option.id}><input type="checkbox" checked={accessoryIds.includes(option.id)} onChange={e => setAccessoryIds(current => e.target.checked ? [...current, option.id] : current.filter(id => id !== option.id))} />{option.name}</label>)}</div> : <p className="hint">No accessory options yet. Add them from Manage accessories.</p>}</fieldset>
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
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  const { data, error, loading } = usePage<Person>(`/people/?page=${page}&q=${encodeURIComponent(q)}`, revision)
  async function deletePerson(person: Person) {
    if (!window.confirm(`Delete ${person.first_name} ${person.last_name}? People with checkout history cannot be deleted.`)) return
    try { await api(`/people/${person.id}/`, { method: 'DELETE' }); toast('Person deleted.'); reload() }
    catch (reason) { toast(errorMessage(reason instanceof Error ? reason.message : reason), 'error') }
  }
  return <>
    <PageHeader title="People" description="Save recipient contact details for future checkouts." action={<button className="primary" onClick={() => setEditing('new')}><Plus size={17} /> Add person</button>} />
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search people" placeholder="Search name or phone" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} /></div></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th>First name</th><th>Last name</th><th>Phone</th><th>Recipient type</th><th></th></tr></thead><tbody>{data?.results.map(person => <tr key={person.id}><td className="strong">{person.first_name}</td><td>{person.last_name}</td><td>{person.phone}</td><td>{person.recipient_type || '—'}</td><td className="row-actions"><button className="text-button" onClick={() => setEditing(person)}>Edit</button><button className="text-button destructive" onClick={() => deletePerson(person)}><Trash2 size={14} /> Delete</button></td></tr>)}</tbody></table>{loading && <p className="empty">Loading people…</p>}{!loading && !data?.results.length && <p className="empty">No people found.</p>}</div><Pager page={page} count={data?.count || 0} onChange={setPage} />
    {editing && <PersonForm person={editing === 'new' ? null : editing} close={() => setEditing(null)} saved={() => { toast(editing === 'new' ? 'Person added.' : 'Person updated.'); setEditing(null); reload() }} />}
  </>
}

function PersonForm({ person, close, saved }: { person: Person | null; close: () => void; saved: () => void }) {
  const toast = useToast()
  const [firstName, setFirstName] = useState(person?.first_name || '')
  const [lastName, setLastName] = useState(person?.last_name || '')
  const [phone, setPhone] = useState(person?.phone || '')
  const [type, setType] = useState(person?.recipient_type || 'employee')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
    {error && <Notice>{error}</Notice>}<div className="person-name-grid"><Field label="First name"><input required value={firstName} onChange={e => setFirstName(e.target.value)} /></Field><Field label="Last name"><input required value={lastName} onChange={e => setLastName(e.target.value)} /></Field></div><div className="person-contact-grid"><Field label="Phone number"><input required type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field><Field label="Recipient type"><select required value={type} onChange={e => setType(e.target.value)}>{['employee', 'student', 'guest'].map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></Field></div><div className="form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save person'}</button></div>
  </form></div></div>
}

function Checkouts({ revision, reload }: { revision: number; reload: () => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [returningItem, setReturningItem] = useState<CheckoutItem | null>(null)
  const [returnedAccessoryIds, setReturnedAccessoryIds] = useState<number[]>([])
  const [returnBusy, setReturnBusy] = useState(false)
  const { data, error, loading } = usePage<Checkout>(`/checkouts/?page=${page}&q=${encodeURIComponent(q)}&status=${status}`, revision)
  async function confirmReturn() {
    if (!returningItem) return
    setReturnBusy(true)
    const missingAccessoryIds = returningItem.accessory_snapshot
      .filter(accessory => !returnedAccessoryIds.includes(accessory.id))
      .map(accessory => accessory.id)
    try {
      await api(`/checkout-items/${returningItem.id}/resolve/`, { method: 'POST', body: JSON.stringify({ outcome: 'returned', missing_accessory_ids: missingAccessoryIds }) })
      toast(missingAccessoryIds.length
        ? `${returningItem.asset_name} returned with missing accessories; it needs resolution.`
        : `${returningItem.asset_name} returned with all listed accessories.`)
      setReturningItem(null)
      reload()
    } catch (reason) { toast(errorMessage(reason instanceof Error ? reason.message : reason), 'error') }
    finally { setReturnBusy(false) }
  }
  return <>
    <PageHeader title="Checkouts" description="Track issued items and partial returns." action={<button className="primary" onClick={() => setCreating(true)}><Plus size={17} /> New checkout</button>} />
    <div className="toolbar"><div className="search"><Search size={18} /><input aria-label="Search checkouts" placeholder="Search recipient or phone" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} /></div><select aria-label="Filter checkout items by status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All item statuses</option><option value="checked_out">Checked out</option><option value="returned">Returned</option><option value="partially_returned">Partially returned</option><option value="returned_damaged">Returned damaged</option><option value="lost">Lost</option></select></div>
    {error && <Notice>{error}</Notice>}
    <div className="panel table-wrap"><table><thead><tr><th>Checkout No</th><th>Full name</th><th>Phone number</th><th>Asset name</th><th>Status</th><th></th></tr></thead><tbody>{data?.results.flatMap(checkout => checkout.items.map(item => <tr key={item.id}><td className="strong">#{checkout.id}</td><td>{checkout.recipient_first_name} {checkout.recipient_last_name}</td><td>{checkout.recipient_phone}</td><td>{item.asset_name}</td><td><Badge value={item.status} /></td><td className="row-actions">{item.status === 'checked_out' && <button className="text-button return-button" onClick={() => { setReturningItem(item); setReturnedAccessoryIds(item.accessory_snapshot.map(accessory => accessory.id)) }}>Mark returned</button>}<button className="text-button" onClick={() => setSelectedId(checkout.id)}>Open</button></td></tr>))}</tbody></table>{loading && <p className="empty">Loading checkouts…</p>}{!loading && !data?.results.length && <p className="empty">No checkouts found.</p>}</div><Pager page={page} count={data?.count || 0} onChange={setPage} />
    {creating && <CheckoutForm close={() => setCreating(false)} saved={() => { toast('Checkout created.'); setCreating(false); reload() }} />}
    {selectedId && <CheckoutDetail id={selectedId} revision={revision} close={() => setSelectedId(null)} reload={reload} />}
    {returningItem && <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget && !returnBusy) setReturningItem(null) }}><div className="dialog return-confirm-dialog" role="dialog" aria-modal="true" aria-label={`Confirm return for ${returningItem.asset_name}`}><div className="dialog-head"><h2>Confirm asset return</h2><button disabled={returnBusy} onClick={() => setReturningItem(null)} aria-label="Close">×</button></div><div className="form-stack"><p><strong>{returningItem.asset_name}</strong> is being returned. Confirm which listed accessories came back.</p>{returningItem.accessory_snapshot.length ? <fieldset className="accessory-field"><legend>Accessories received</legend><div className="accessory-options">{returningItem.accessory_snapshot.map(accessory => <label className="checkbox-line" key={accessory.id}><input type="checkbox" checked={returnedAccessoryIds.includes(accessory.id)} onChange={event => setReturnedAccessoryIds(current => event.target.checked ? [...current, accessory.id] : current.filter(id => id !== accessory.id))} />{accessory.name}</label>)}</div><p className="hint">Uncheck any missing accessory. The asset will remain unavailable until an Admin resolves it.</p></fieldset> : <p className="hint">No accessories were listed for this asset.</p>}<div className="form-actions"><button disabled={returnBusy} onClick={() => setReturningItem(null)}>Cancel</button><button className="primary" disabled={returnBusy} onClick={confirmReturn}>{returnBusy ? 'Saving…' : 'Confirm return'}</button></div></div></div></div>}
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
  const [selected, setSelected] = useState<number[]>([])
  const [accessoriesByAsset, setAccessoriesByAsset] = useState<Record<number, number[]>>({})
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
    if (!selected.length) { setError('Select at least one available asset.'); return }
    setBusy(true)
    try {
      const who = mode === 'new'
        ? { recipient_data: { first_name: newFirstName.trim(), last_name: newLastName.trim(), phone: newPhone.trim(), recipient_type: newType } }
        : { recipient: recipientId }
      const asset_accessories = selected.map(asset => ({
        asset,
        accessory_ids: accessoriesByAsset[asset] ?? [],
      }))
      await api('/checkouts/', { method: 'POST', body: JSON.stringify({ ...who, asset_ids: selected, asset_accessories }) })
      saved()
    } catch (reason) { const message = errorMessage(reason instanceof Error ? reason.message : reason); setError(message); toast(message, 'error') } finally { setBusy(false) }
  }
  const visibleAssets = assets.filter(asset => `${asset.name} ${asset.accessory_items.map(item => item.name).join(' ')}`.toLowerCase().includes(assetSearch.toLowerCase()))
  return <div className="overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget) close() }}><div className="dialog checkout-dialog" role="dialog" aria-modal="true" aria-label="Create checkout">
    <div className="dialog-head"><h2>Create checkout</h2><button onClick={close} aria-label="Close">×</button></div>
    <form onSubmit={submit} className="checkout-form">
      <div className="dialog-body form-stack">
        {error && <Notice>{error}</Notice>}
        <section className="intake-section" aria-label="Recipient selection">
          <h3>Recipient <span className="required-mark">*</span></h3>
          {mode === 'existing' && pickedPerson ? <div className="selected-contact"><div><strong>{pickedPerson.first_name}</strong><small>{pickedPerson.last_name} · {pickedPerson.phone}{pickedPerson.recipient_type ? ` · ${pickedPerson.recipient_type}` : ''}</small></div><button type="button" onClick={() => { setPickedPerson(null); setRecipientId(0) }}><X size={15} /> Change</button></div> : <>
            <div className="choice-tabs" role="tablist" aria-label="Recipient"><button type="button" role="tab" aria-selected={mode === 'existing'} className={mode === 'existing' ? 'selected' : ''} onClick={() => switchMode('existing')}><Search size={16} /> Existing person</button><button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'selected' : ''} onClick={() => switchMode('new')}><UserPlus size={16} /> New person</button></div>
            {mode === 'existing' ? <div className="form-stack picker-content"><div className="search"><Search size={17} /><input aria-label="Search people" autoComplete="off" placeholder="Search by name or phone…" value={personSearch} onChange={e => setPersonSearch(e.target.value)} /></div>
              {personSearch.trim().length < 2 && <p className="hint">Type at least 2 characters to search people.</p>}
              {searching && <p className="hint">Searching people…</p>}
              {personSearch.trim().length >= 2 && !searching && people.length > 0 && <ul className="people-results" aria-label="Matching people">{people.map(person => <li key={person.id}><button type="button" onClick={() => { setPickedPerson(person); setRecipientId(person.id); setError('') }}><Check size={16} /><span><strong>{person.first_name}</strong><small>{person.last_name} · {person.phone}{person.recipient_type ? ` · ${person.recipient_type}` : ''}</small></span></button></li>)}</ul>}
              {personSearch.trim().length >= 2 && !searching && people.length === 0 && <div className="no-match"><span>No person matches “{personSearch.trim()}”.</span><button type="button" onClick={() => switchMode('new')}><UserPlus size={15} /> Register person</button></div>}
            </div> : <div className="inline-register"><div className="register-grid"><Field label="First name *"><input required value={newFirstName} onChange={e => setNewFirstName(e.target.value)} /></Field><Field label="Last name *"><input required value={newLastName} onChange={e => setNewLastName(e.target.value)} /></Field><Field label="Phone *"><input required type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} /></Field><Field label="Recipient type"><select required value={newType} onChange={e => setNewType(e.target.value)}>{['employee', 'student', 'guest'].map(value => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></Field></div></div>}
          </>}
        </section>
        <p className="hint">{selected.length} asset{selected.length === 1 ? '' : 's'} selected</p>
        <section className="intake-section" aria-label="Asset selection"><h3>Assets <span className="required-mark">*</span></h3><div className="search"><Search size={17} /><input aria-label="Search available assets" value={assetSearch} onChange={e => setAssetSearch(e.target.value)} placeholder="Search by asset name…" /></div><div className="asset-picker" aria-label="Available assets">{visibleAssets.length ? visibleAssets.map(asset => {
          const isSelected = selected.includes(asset.id)
          const selectedAccessoryIds = accessoriesByAsset[asset.id] ?? []
          return <div key={asset.id} className="pick-row">
            <label className="pick-main"><input type="checkbox" checked={isSelected} onChange={e => {
              if (e.target.checked) {
                setSelected(current => current.includes(asset.id) ? current : [...current, asset.id])
                setAccessoriesByAsset(current => ({ ...current, [asset.id]: asset.accessory_items.map(item => item.id) }))
              } else {
                setSelected(current => current.filter(id => id !== asset.id))
                setAccessoriesByAsset(current => { const next = { ...current }; delete next[asset.id]; return next })
              }
            }} /><strong>{asset.name}</strong></label>
            {isSelected && asset.accessory_items.length > 0 && <fieldset className="pick-accessories"><legend>Accessories going with this asset</legend>{asset.accessory_items.map(item => <label key={item.id}><input type="checkbox" checked={selectedAccessoryIds.includes(item.id)} onChange={e => setAccessoriesByAsset(current => ({
              ...current,
              [asset.id]: e.target.checked
                ? [...(current[asset.id] ?? []), item.id]
                : (current[asset.id] ?? []).filter(id => id !== item.id),
            }))} />{item.name}</label>)}</fieldset>}
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
    <div className="detail-grid"><div><span className="label">Recipient</span><strong>{checkout.recipient_first_name}</strong><span>{checkout.recipient_last_name}</span><span>{checkout.recipient_phone}</span></div><div><span className="label">Issued</span><strong>{dateTime(checkout.issued_at)}</strong><span>By {checkout.issued_by_name}</span></div></div>
    {checkout.notes && <p className="hint">Notes: {checkout.notes}</p>}
    <h3>Items</h3><div className="item-list">{checkout.items.map(item => <div className="item-row" key={item.id}><div><strong>{item.asset_name}</strong>{item.accessory_snapshot.length > 0 && <fieldset className="accessory-display"><legend>Accessories issued</legend><div className="accessory-display-options">{item.accessory_snapshot.map(accessory => { const missing = item.missing_accessories.some(entry => entry.id === accessory.id); return <span className={`accessory-display-item ${missing ? 'is-missing' : ''}`} key={accessory.id}><span>{accessory.name}</span><small>{missing ? 'Missing' : 'Included'}</small></span> })}</div></fieldset>}{item.missing_accessories.length > 0 && <div className="missing-accessories-alert"><strong>{item.missing_accessories.length} missing {item.missing_accessories.length === 1 ? 'accessory' : 'accessories'} · Admin resolution required</strong></div>}{item.notes && <small>{item.notes}</small>}{item.missing_accessories.length > 0 && <><button className="text-button return-button" onClick={() => { setRestoringItemId(restoringItemId === item.id ? null : item.id); setReceivedAccessoryIds([]) }}>{restoringItemId === item.id ? 'Close' : 'Record accessories received'}</button>{restoringItemId === item.id && <fieldset className="accessory-field recovery-accessory-field"><legend>Accessories received now</legend><div className="accessory-options">{item.missing_accessories.map(accessory => <label className="checkbox-line" key={accessory.id}><input type="checkbox" checked={receivedAccessoryIds.includes(accessory.id)} onChange={event => setReceivedAccessoryIds(current => event.target.checked ? [...current, accessory.id] : current.filter(id => id !== accessory.id))} />{accessory.name}</label>)}</div><p className="hint">Tick each missing accessory that has now been returned.</p><div className="form-actions"><button type="button" disabled={busy} onClick={() => { setRestoringItemId(null); setReceivedAccessoryIds([]) }}>Cancel</button><button className="primary" disabled={busy || !receivedAccessoryIds.length} onClick={() => recordAccessoriesReceived(item)}>Save received accessories</button></div></fieldset>}</> }</div><Badge value={item.status} />{item.status === 'checked_out' && <button onClick={() => { setOutcomeItem(item); setOutcome('returned'); setMissingAccessoryIds([]) }}>Record outcome</button>}</div>)}</div>
    {activityEvents.length > 0 && <><h3>Activity</h3><div className="event-list">{activityEvents.map(event => <div key={event.id}><strong>{event.kind.replaceAll('_', ' ')}</strong><span>{event.actor_name} · {dateTime(event.created_at)}</span></div>)}</div></>}
    {outcomeItem && <div className="resolve-panel"><h3>Resolve {outcomeItem.asset_name}</h3><Field label="Outcome"><select value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)}><option value="returned">Returned</option><option value="returned_damaged">Returned damaged</option><option value="lost">Lost</option></select></Field>{outcome !== 'lost' && <fieldset className="accessory-field"><legend>Confirm returned accessories</legend>{outcomeItem.accessory_snapshot.length ? <div className="accessory-options">{outcomeItem.accessory_snapshot.map(accessory => { const isMissing = missingAccessoryIds.includes(accessory.id); return <label className="checkbox-line" key={accessory.id}><input type="checkbox" checked={!isMissing} onChange={e => setMissingAccessoryIds(current => e.target.checked ? current.filter(id => id !== accessory.id) : [...current, accessory.id])} />{accessory.name}</label> })}</div> : <p className="hint">No accessories were recorded for this asset.</p>}<p className="hint">Uncheck any accessory that did not come back. The asset will stay unavailable until an Admin resolves it.</p></fieldset>}<Field label="Notes (optional)"><textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field><div className="form-actions"><button onClick={() => setOutcomeItem(null)}>Cancel</button><button className="primary" disabled={busy} onClick={resolve}>Save outcome</button></div></div>}
  </div>}</div></div>
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
