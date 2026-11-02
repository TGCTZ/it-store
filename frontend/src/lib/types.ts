export type AssetStatus = 'available' | 'checked_out' | 'needs_repair' | 'lost' | 'missing_accessories' | 'retired'
export type ItemStatus = 'checked_out' | 'returned' | 'partially_returned' | 'returned_damaged' | 'lost'

export interface AccessoryOption {
  id: number
  name: string
}

export interface AccessorySnapshot {
  id: number
  name: string
}

export interface User {
  id: number
  name: string
  email: string
  is_active: boolean
}

export interface Asset {
  id: number
  asset_id: string
  name: string
  notes: string
  accessory_ids: number[]
  accessory_items: AccessoryOption[]
  missing_accessory_ids: number[]
  status: AssetStatus
}

export interface Person {
  id: number
  first_name: string
  last_name: string
  phone: string
  recipient_type: string
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
  recipient: number
  recipient_first_name: string
  recipient_last_name: string
  recipient_phone: string
  items: CheckoutItem[]
  events: Event[]
  issued_at: string
  issued_by_name: string
  notes: string
}

export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

