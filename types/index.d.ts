// Whether poteto mode is on for the session's project, mirrored from $.store
export type PstackPoteto = boolean

// One skill folder under skills/, as the /pstack pane lists it
export type PstackSkill = { name: string; description: string }

// A pstack skill whose text sits in the main conversation: its files read, or typed as /pstack:<name>
export type PstackLoaded = { name: string; via: 'read' | 'run' | 'skill' }

declare module 'claude-code' {
  interface PluginState {
    pstack: {
      poteto: PstackPoteto
      skills: PstackSkill[]
      // Skill names hidden from the / menu, mirrored from $.store
      hidden: string[]
      // The group the /pstack pane shows on the right; '' is the first group
      group: string
      // Cleared at compaction and at session start; the pinned poteto-mode is derived from poteto instead
      loaded: PstackLoaded[]
      // Whether the conversation holds the poteto-mode text; cleared at compaction and session start
      pinned: boolean
    }
  }
}
