import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PstackSkill } from '../types'
import { descriptionFrom, grouped } from './catalog'
import { potetoContext, reminderFrom, storeKey } from './poteto'
import { agentModel, agentType, harnessNote, modelsFrom } from './translate'

// The org's security plugin can bypass user-tier skill.prompt hooks, so the note rides prompt.submit and Read instead
const PSTACK_COMMAND = /^\/pstack:\S/
const LABEL = '♛ poteto'
const PANE = 'pstack'
const HIDDEN_KEY = 'hidden'

const poteto = atom({ plugin: 'pstack', key: 'poteto' } as const, false)
const skills = atom({ plugin: 'pstack', key: 'skills' } as const, [])
const hidden = atom({ plugin: 'pstack', key: 'hidden' } as const, [])

// Mirrors the project's stored choice into session state, which the footer draws from
async function loadPoteto($: EngineInterface, isDefault: boolean): Promise<boolean> {
  const stored = await $.store.get(storeKey(await $.session.root()))
  const isOn = typeof stored === 'boolean' ? stored : isDefault
  await update($, poteto, () => isOn)

  return isOn
}

// Every folder under skills/ with its frontmatter description, read once per session
async function loadSkills($: EngineInterface): Promise<void> {
  const entries = await $.fs.list(`${$.plugin.root}/skills`).catch(() => [])
  const found: PstackSkill[] = await Promise.all(
    entries
      .filter(entry => entry.kind === 'dir')
      .map(async entry => ({
        name: entry.name,
        description: descriptionFrom(String(await $.fs.read(`${$.plugin.root}/skills/${entry.name}/SKILL.md`).catch(() => ''))),
      })),
  )
  await update($, skills, () => found)

  const stored = await $.store.get(HIDDEN_KEY)
  await update($, hidden, () => (Array.isArray(stored) ? stored.filter(name => typeof name === 'string') : []))
}

async function toggleHidden($: EngineInterface, name: string): Promise<void> {
  const next = await update($, hidden, names => (names.includes(name) ? names.filter(one => one !== name) : [...names, name]))
  await $.store.set(HIDDEN_KEY, next)
  $.ui.invalidate('command.describe')
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
    await $.command.register({ name: 'pstack', description: 'Browse, run and hide pstack skills' })
    await loadPoteto($, isPotetoDefault)
    await loadSkills($)

    return next(e)
  })

  on('command.run', { command: 'poteto' }, async $ => {
    const isOn = !(await loadPoteto($, isPotetoDefault))
    await $.store.set(storeKey(await $.session.root()), isOn)
    await update($, poteto, () => isOn)

    return { text: isOn ? 'poteto mode on' : 'poteto mode off' }
  })

  on('command.run', { command: 'pstack' }, async $ => {
    await $.ui.open({ id: PANE, title: 'pstack', closeOnEscape: true })

    return { text: 'pstack pane opened' }
  })

  on('command.describe', async ($, e, next) => {
    const name = e.command.startsWith('pstack:') ? e.command.slice('pstack:'.length) : undefined

    if (name === undefined || !(await read($, hidden)).includes(name)) {
      return next(e)
    }

    return next({ ...e, isHidden: true })
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, skills)
    const hiddenNames = await read($, hidden)

    if (all.length === 0) {
      return <Text dimColor>No pstack skills found under {$.plugin.root}/skills.</Text>
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>Press a skill to put it in the prompt. Hidden skills stay out of the / menu but still run when typed.</Text>
        {grouped(all).map(group => (
          <Box key={group.title} flexDirection="column" marginTop={1}>
            <Text bold>{group.title}</Text>
            {group.skills.map(skill => {
              const isHidden = hiddenNames.includes(skill.name)

              return (
                <Box key={skill.name} flexDirection="row" gap={1}>
                  <Button
                    key={`run-${skill.name}`}
                    plain
                    dimColor={isHidden}
                    label={`/${skill.name}`}
                    onPress={() => void $.prompt.fill({ text: `/pstack:${skill.name} `, mode: 'replace' })}
                  />
                  <Box flexGrow={1} flexShrink={1} overflow="hidden">
                    <Text dimColor wrap="truncate-end">
                      {skill.description}
                    </Text>
                  </Box>
                  <Button
                    key={`hide-${skill.name}`}
                    plain
                    dimColor
                    label={isHidden ? 'show' : 'hide'}
                    onPress={() => void toggleHidden($, skill.name)}
                  />
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  })
}
