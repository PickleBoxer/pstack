// Whether poteto mode is on for the session's project, mirrored from $.store
export type PstackPoteto = boolean

// One skill folder under skills/, as the /pstack pane lists it
export type PstackSkill = { name: string; description: string }

declare module 'claude-code' {
  interface PluginState {
    pstack: {
      poteto: PstackPoteto
      skills: PstackSkill[]
      // Skill names hidden from the / menu, mirrored from $.store
      hidden: string[]
    }
  }
}
