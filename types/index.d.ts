// Whether poteto mode is on for the session's project, mirrored from $.store
export type PstackPoteto = boolean

declare module 'claude-code' {
  interface PluginState {
    pstack: { poteto: PstackPoteto }
  }
}
