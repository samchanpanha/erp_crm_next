'use client'

/**
 * Global company/app settings store (hydrated from /api/settings).
 * Used by the Settings module, the print engine and anywhere the
 * company identity (logo, name, currency…) is displayed.
 */
import { create } from 'zustand'
import { get, put } from '@/components/erp/lib/api'
import { SETTING_DEFAULTS } from '@/lib/template-schema'

export type SettingsMap = Record<string, string>

interface SettingsState {
  settings: SettingsMap
  loaded: boolean
  loading: boolean
  load: (force?: boolean) => Promise<void>
  save: (patch: SettingsMap) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, getState) => ({
  settings: { ...SETTING_DEFAULTS },
  loaded: false,
  loading: false,
  load: async (force = false) => {
    if (getState().loading || (getState().loaded && !force)) return
    set({ loading: true })
    try {
      const data = await get<SettingsMap>('/api/settings')
      set({ settings: { ...SETTING_DEFAULTS, ...data }, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
  save: async (patch) => {
    const data = await put<SettingsMap>('/api/settings', patch)
    set({ settings: { ...getState().settings, ...data } })
  },
}))
