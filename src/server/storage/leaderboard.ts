import { Storage } from '@dcl/sdk/server'

const HUNTERS_KEY = 'leaderboard_hunters_v1'
const PROPS_KEY = 'leaderboard_props_v1'
const MAX_ENTRIES = 10

export type LeaderboardEntry = {
  address: string
  displayName: string
  value: number
}

export class LeaderboardStore {
  private huntersTop: LeaderboardEntry[] = []
  private propsTop: LeaderboardEntry[] = []

  async load(): Promise<void> {
    try {
      const [huntersRaw, propsRaw] = await Promise.all([
        Storage.get<string>(HUNTERS_KEY),
        Storage.get<string>(PROPS_KEY)
      ])
      if (huntersRaw) this.huntersTop = this.parseEntries(huntersRaw)
      if (propsRaw) this.propsTop = this.parseEntries(propsRaw)
      console.log(`[Server][Leaderboard] Loaded: ${this.huntersTop.length} hunters, ${this.propsTop.length} props entries`)
    } catch (error) {
      console.error('[Server][Leaderboard] Failed to load:', error)
    }
  }

  async persist(): Promise<void> {
    try {
      await Promise.all([
        Storage.set(HUNTERS_KEY, JSON.stringify(this.huntersTop)),
        Storage.set(PROPS_KEY, JSON.stringify(this.propsTop))
      ])
      console.log('[Server][Leaderboard] Persisted')
    } catch (error) {
      console.error('[Server][Leaderboard] Failed to persist:', error)
    }
  }

  update(type: 'hunters' | 'props', address: string, displayName: string, value: number): boolean {
    const list = type === 'hunters' ? this.huntersTop : this.propsTop
    return this.updateTop(list, address, displayName, value)
  }

  getHuntersTop(): LeaderboardEntry[] {
    return this.huntersTop
  }

  getPropsTop(): LeaderboardEntry[] {
    return this.propsTop
  }

  getCurrentValue(type: 'hunters' | 'props', address: string): number {
    const normalized = address.toLowerCase()
    const list = type === 'hunters' ? this.huntersTop : this.propsTop
    return list.find((entry) => entry.address === normalized)?.value ?? 0
  }

  private parseEntries(raw: string): LeaderboardEntry[] {
    try {
      const parsed = JSON.parse(raw) as unknown[]
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((entry): entry is LeaderboardEntry => !!entry && typeof (entry as LeaderboardEntry).address === 'string')
        .map((entry) => ({
          address: entry.address.toLowerCase(),
          displayName: typeof entry.displayName === 'string' && entry.displayName ? entry.displayName : entry.address.slice(0, 8),
          value: typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : 0
        }))
        .slice(0, MAX_ENTRIES)
    } catch {
      return []
    }
  }

  private updateTop(list: LeaderboardEntry[], address: string, displayName: string, value: number): boolean {
    if (value <= 0) return false

    const normalized = address.toLowerCase()
    const existing = list.find((entry) => entry.address === normalized)
    if (existing) {
      if (value <= existing.value) return false
      existing.value = value
      existing.displayName = displayName
    } else {
      if (list.length >= MAX_ENTRIES && value <= (list[list.length - 1]?.value ?? 0)) return false
      list.push({ address: normalized, displayName, value })
    }

    list.sort((a, b) => b.value - a.value)
    if (list.length > MAX_ENTRIES) list.splice(MAX_ENTRIES)
    return true
  }
}

export function createLeaderboardStore(): LeaderboardStore {
  return new LeaderboardStore()
}
