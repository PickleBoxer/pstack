import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { potetoContext, reminderFrom, storeKey } from './poteto'
import { agentModel, agentType, harnessNote, modelsFrom } from './translate'

// The org's security plugin can bypass user-tier skill.prompt hooks, so the note rides prompt.submit and Read instead
const PSTACK_COMMAND = /^\/pstack:\S/
const LABEL = '♛ poteto'

const poteto = atom({ plugin: 'pstack', key: 'poteto' } as const, false)

// Mirrors the project's stored choice into session state, which the footer draws from
async function loadPoteto($: EngineInterface, isDefault: boolean): Promise<boolean> {
  const stored = await $.store.get(storeKey(await $.session.root()))
  const isOn = typeof stored === 'boolean' ? stored : isDefault
  await update($, poteto, () => isOn)

  return isOn
}

export const register: Register = (on, options) => {
  const models = modelsFrom(options)
  const isPotetoDefault = options.poteto_default === true
  // Loops (main is '') that already carry the note this turn
  const noted = new Set<string>()
  let reminder = reminderFrom('')

  on('session.start', async ($, e, next) => {
    reminder = reminderFrom(String(await $.fs.read(`${$.plugin.root}/skills/poteto-mode/SKILL.md`).catch(() => '')))
    await $.command.register({ name: 'poteto', description: 'Toggle poteto mode for this project' })
    await loadPoteto($, isPotetoDefault)

    return next(e)
  })

  on('command.run', { command: 'poteto' }, async $ => {
    const isOn = !(await loadPoteto($, isPotetoDefault))
    await $.store.set(storeKey(await $.session.root()), isOn)
    await update($, poteto, () => isOn)

    return { text: isOn ? 'poteto mode on' : 'poteto mode off' }
  })

  on('turn.start', ($, e, next) => {
    noted.clear()

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (PSTACK_COMMAND.test(e.text)) {
      noted.add('')

      return next({ ...e, context: [...(e.context ?? []), harnessNote($.plugin.root, models)] })
    }

    const isOn = await read($, poteto)

    if (!isOn || e.text.startsWith('/')) {
      return next(e)
    }

    return next({ ...e, context: [...(e.context ?? []), potetoContext($.plugin.root, reminder)] })
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

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const isOn = await read($, poteto)

    return isOn ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, LABEL] } }) : next(e)
  })
}
