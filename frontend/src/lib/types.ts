export type Role = 'admin' | 'staff'
export type AssetStatus = 'available' | 'on_loan' | 'damaged' | 'lost' | 'incomplete' | 'retired'
export type ItemStatus = 'out' | 'returned' | 'damaged' | 'lost'

export interface AccessoryOption {
  id: number
  name: string
  is_active: boolean
}

export interface AccessorySnapshot {
  id: number
  name: string
}

export interface User {
  id: number
  name: string
  email: string
  role: Role
  is_active: boolean
}

export interface Asset {
  id: number
  asset_id: string
  name: string
  notes: string
  accessory_ids: number[]
  accessory_items: AccessoryOption[]
  status: AssetStatus
}

export interface Borrower {
  id: number
  name: string
  phone: string
  borrower_type: string
  notes: string
}

export interface CheckoutItem {
  id: number
  asset: number
  asset_label: string
  asset_name: string
  accessory_snapshot: AccessorySnapshot[]
  missing_accessories: AccessorySnapshot[]
  status: ItemStatus
  closed_at: string | null
  closed_by_name: string | null
  notes: string
}

export interface Event {
  id: number
  kind: string
  actor_name: string
  details: Record<string, unknown>
  created_at: string
}

export interface Checkout {
  id: number
  borrower: number
  borrower_name: string
  borrower_phone: string
  items: CheckoutItem[]
  events: Event[]
  issued_at: string
  issued_by_name: string
  due_date: string
  notes: string
  status: 'active' | 'overdue' | 'closed'
}

export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface Summary {
  available: number
  on_loan: number
  overdue: number
  damaged: number
  lost: number
  incomplete: number
  retired: number
}
