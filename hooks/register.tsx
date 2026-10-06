import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PstackLoaded, PstackSkill } from '../types'
import { descriptionFrom, grouped } from './catalog'
import { POTETO_OFF, potetoSection, storeKey } from './poteto'
import { agentModel, agentType, harnessNote, modelsFrom } from './translate'

// The org's security plugin can bypass user-tier skill.prompt hooks, so the note rides prompt.submit and Read instead
const PSTACK_COMMAND = /^\/pstack:(\S+)/
const PANE = 'pstack'
const HIDDEN_KEY = 'hidden'
const LOADED_TAB = 'Loaded'
const WORDMARK = ['█▀█ █▀ ▀█▀ ▄▀█ █▀▀ █▄▀', '█▀▀ ▄█  █  █▀█ █▄▄ █ █']

const poteto = atom({ plugin: 'pstack', key: 'poteto' } as const, false)
const skills = atom({ plugin: 'pstack', key: 'skills' } as const, [])
const hidden = atom({ plugin: 'pstack', key: 'hidden' } as const, [])
const group = atom({ plugin: 'pstack', key: 'group' } as const, '')
const loaded = atom({ plugin: 'pstack', key: 'loaded' } as const, [])
const pinned = atom({ plugin: 'pstack', key: 'pinned' } as const, false)

// Mirrors the project's stored choice into session state, which prompt.submit reads
async function loadPoteto($: EngineInterface, isDefault: boolean): Promise<boolean> {
  const stored = await $.store.get(storeKey(await $.session.root()))
  const isOn = typeof stored === 'boolean' ? stored : isDefault
  await update($, poteto, () => isOn)

  return isOn
}

async function togglePoteto($: EngineInterface, isDefault: boolean): Promise<void> {
  const isOn = !(await loadPoteto($, isDefault))
  await $.store.set(storeKey(await $.session.root()), isOn)
  await update($, poteto, () => isOn)
  $.ui.toast(isOn ? 'poteto mode on' : 'poteto mode off')
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

// Only the pane header shows it, so a manifest that does not parse must not stop session.start
function versionFrom(manifest: string): string {
  try {
    const version: unknown = JSON.parse(manifest).version

    return typeof version === 'string' ? version : ''
  } catch {
    return ''
  }
}

async function markLoaded($: EngineInterface, name: string, via: PstackLoaded['via']): Promise<void> {
  await update($, loaded, list => (list.some(one => one.name === name) ? list : [...list, { name, via }]))
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
  let potetoSkill = ''
  let version = ''

  on('session.start', async ($, e, next) => {
    potetoSkill = String(await $.fs.read(`${$.plugin.root}/skills/poteto-mode/SKILL.md`).catch(() => ''))
    version = versionFrom(String(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => '')))
    await update($, loaded, () => [])
    await update($, pinned, () => false)
    await $.command.register({ name: 'poteto', description: 'Toggle poteto mode for this project' })
    await $.command.register({ name: 'pstack', description: 'Browse, run and hide pstack skills' })
    await loadPoteto($, isPotetoDefault)
    await loadSkills($)

    return next(e)
  })

  on('command.run', { command: 'poteto' }, async $ => {
    await togglePoteto($, isPotetoDefault)

    return {}
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
    const command = e.text.match(PSTACK_COMMAND)?.[1]
    const context = [...(e.context ?? [])]

    if (command !== undefined) {
      noted.add('')
      await markLoaded($, command, 'run')
      context.push(harnessNote($.plugin.root, models))
    }

    // The conversation catches up with the toggle on the next prompt the model reads
    if (command !== undefined || !e.text.startsWith('/')) {
      const isOn = await read($, poteto)

      if (isOn !== (await read($, pinned))) {
        context.push(isOn ? potetoSection($.plugin.root, potetoSkill, harnessNote($.plugin.root, models)) : POTETO_OFF)
        await update($, pinned, () => isOn)
      }
    }

    return next(context.length === (e.context ?? []).length ? e : { ...e, context })
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    const loop = e.agentId ?? ''
    const skillsDir = `${$.plugin.root}/skills/`
    const isPstackFile = e.file_path.startsWith(skillsDir) || e.file_path.startsWith(`${$.plugin.root}/agents/`)

    // A subagent's reads sit in its own context, not the conversation the pane reports on
    if (e.file_path.startsWith(skillsDir) && result.deny === undefined && e.agentId === undefined) {
      await markLoaded($, e.file_path.slice(skillsDir.length).split('/')[0] ?? '', 'read')
    }

    if (!isPstackFile || result.deny !== undefined || noted.has(loop)) {
      return result
    }

    noted.add(loop)

    return { ...result, context: [...(result.context ?? []), harnessNote($.plugin.root, models)] }
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in result)) {
      await update($, loaded, () => [])
      await update($, pinned, () => false)
    }

    return result
  })

  on('agent.spawn', ($, e, next) =>
    next({ ...e, subagentType: agentType(e.subagentType), model: agentModel(e.model, models) }),
  )

  // Draws the footer's modes itself: the desktop skips plain mode labels, and the poteto one is a toggle
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOn = await read($, poteto)

    return (
      <Box flexDirection="row">
        {e.props.modes.map(mode => (
          <Text key={mode} dimColor>
            {mode} &{' '}
          </Text>
        ))}
        <Button
          key="poteto"
          variant="primary"
          dimColor={!isOn}
          label="poteto"
          onPress={() => void togglePoteto($, isPotetoDefault)}
        />
        <Text color={isOn ? 'success' : undefined} dimColor={!isOn}>
          {isOn ? ' ♛ on' : ' ♛ off'}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, skills)
    const hiddenNames = await read($, hidden)
    const isOn = await read($, poteto)

    if (all.length === 0) {
      return <Text dimColor>No pstack skills found under {$.plugin.root}/skills.</Text>
    }

    const isPinned = await read($, pinned)
    const pinnedRows = isPinned ? [{ name: 'poteto-mode', note: 'in context while poteto is on' }] : []
    const sessionLoaded = (await read($, loaded))
      .filter(one => !(isPinned && one.name === 'poteto-mode'))
      .map(one => ({ name: one.name, note: one.via === 'read' ? 'read this session' : 'run this session' }))
    const loadedRows = [...pinnedRows, ...sessionLoaded]
    const loadedNames = new Set(loadedRows.map(one => one.name))

    const groups = grouped(all).slice(0, 8)
    const tabs = [...groups.map(one => ({ title: one.title, label: one.title })), { title: LOADED_TAB, label: `${LOADED_TAB} ${loadedRows.length}` }]
    const chosen = await read($, group)
    const selected = tabs.find(one => one.title === chosen) ?? tabs[0]
    const rows =
      selected?.title === LOADED_TAB
        ? loadedRows.map(one => ({ name: one.name, description: one.note }))
        : (groups.find(one => one.title === selected?.title)?.skills ?? [])

    return (
      <Box flexDirection="column">
        <Box flexDirection="column">
          {WORDMARK.map((line, index) => (
            <Text key={`wordmark-${index}`} color="warning">
              {line}
            </Text>
          ))}
          <Text color={isOn ? 'success' : undefined} dimColor={!isOn} wrap="truncate-end">
            {isOn ? '♛ poteto on: poteto-mode rides the conversation, every task gets the playbooks' : '♛ poteto off: /poteto or the footer toggle pins poteto-mode'}
          </Text>
          <Text dimColor wrap="truncate-end">
            new here? press 1, then /poteto-help
          </Text>
          <Text dimColor wrap="truncate-end">
            {`${loadedRows.length} loaded · ${hiddenNames.length} hidden · ${all.length} skills${version === '' ? '' : ` · v${version}`}`}
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
          {tabs.map((tab, index) => {
            const isSelected = tab.title === selected?.title
            const hotkey = String(index + 1)
            // The terminal draws a plain Button with a hotkey as `1: label`
            const width = hotkey.length + 2 + tab.label.length

            return (
              <Box key={`tab-${tab.title}`} flexDirection="column">
                <Button
                  key={`group-${tab.title}`}
                  plain
                  hotkey={hotkey}
                  dimColor={!isSelected}
                  label={tab.label}
                  onPress={() => void update($, group, () => tab.title)}
                />
                <Text color={isSelected ? 'suggestion' : undefined} dimColor={!isSelected}>
                  {(isSelected ? '━' : '─').repeat(width)}
                </Text>
              </Box>
            )
          })}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {rows.length === 0 && <Text dimColor>No pstack skill is in the context yet.</Text>}
          {rows.map(skill => {
            const isHidden = hiddenNames.includes(skill.name)
            const isLoaded = loadedNames.has(skill.name)

            return (
              <Box key={skill.name} flexDirection="row" gap={1}>
                <Text color={isLoaded ? 'success' : undefined}>{isLoaded ? '●' : ' '}</Text>
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
        <Box marginTop={1}>
          <Text dimColor>Press a skill to put it in the prompt · 1-9 switch tabs · hidden skills stay out of the / menu but still run when typed</Text>
        </Box>
      </Box>
    )
  })
}
