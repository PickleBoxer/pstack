import type { Register } from 'claude-code'

import { agentModel, agentType, harnessNote, modelsFrom } from './translate'

// The org's security plugin can bypass user-tier skill.prompt hooks, so the note rides prompt.submit and Read instead
const PSTACK_COMMAND = /^\/pstack:\S/

export const register: Register = (on, options) => {
  const models = modelsFrom(options)
  // Loops (main is '') that already carry the note this turn
  const noted = new Set<string>()

  on('turn.start', ($, e, next) => {
    noted.clear()

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (!PSTACK_COMMAND.test(e.text)) {
      return next(e)
    }

    noted.add('')

    return next({ ...e, context: [...(e.context ?? []), harnessNote($.plugin.root, models)] })
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    const loop = e.agentId ?? ''
    const isPstackFile = e.file_path.startsWith(`${$.plugin.root}/skills/`) || e.file_path.startsWith(`${$.plugin.root}/agents/`)

    if (!isPstackFile || result.deny !== undefined || noted.has(loop)) {
      return result
    }

    noted.add(loop)

    return { ...result, context: [...(result.context ?? []), harnessNote($.plugin.root, models)] }
  })

  on('agent.spawn', ($, e, next) =>
    next({ ...e, subagentType: agentType(e.subagentType), model: agentModel(e.model, models) }),
  )
}
