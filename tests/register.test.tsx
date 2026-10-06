import type { AgentSpawnInput, CommandRunInput, On, PromptSubmitInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { reminderFrom } from '../hooks/poteto'
import { agentModel, agentType, harnessNote, modelsFrom } from '../hooks/translate'

const DEFAULTS = modelsFrom({})

// Full engine inputs, as a session raises them
function typed(text: string): PromptSubmitInput {
  return { text, wait: false, origin: { kind: 'composer' } }
}

function typedCommand(command: string): CommandRunInput {
  return { command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }
}

function spawn(subagentType: string, model: string): AgentSpawnInput {
  return {
    tool_use_id: 'toolu_1',
    prompt: 'work',
    description: 'work',
    subagentType,
    model,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  }
}

// Stands for the engine beneath the mod: echoes what reached it
function engine(on: On, spawned: AgentSpawnInput[] = []): void {
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ result: { type: 'text' }, text: 'file body' }))
  on('agent.spawn', async (_$, e) => {
    spawned.push(e)

    return { model: e.model ?? 'parent' }
  })
}

// The note names the plugin root, which the test otherwise cannot see
async function pluginRoot($: Engine): Promise<string> {
  const { context } = await $.prompt.submit(typed('/pstack:how probe'))
  const root = context?.[0]?.match(/Read `(.+)\/skills\/<name>\/SKILL\.md`/)?.[1]

  expect(root).toBeDefined()

  return root as string
}

describe('translate', () => {
  test('maps cursor agent types and leaves others alone', () => {
    expect(agentType('generalPurpose')).toBe('general-purpose')
    expect(agentType('poteto-agent')).toBe('pstack:poteto-agent')
    expect(agentType('Comment Sicko')).toBe('pstack:Comment Sicko')
    expect(agentType('Explore')).toBe('Explore')
  })

  test('maps grok and opus slugs to the configured models', () => {
    expect(agentModel('grok-4.7-xhigh-fast', DEFAULTS)).toBe('sonnet')
    expect(agentModel('claude-opus-5-5-xhigh', DEFAULTS)).toBe('opus')
    expect(agentModel('haiku', DEFAULTS)).toBe('haiku')
    expect(agentModel(undefined, DEFAULTS)).toBeUndefined()
  })

  test('inherit aliases and an inherit option omit the model', () => {
    expect(agentModel('inherit-parent', DEFAULTS)).toBeUndefined()
    expect(agentModel('auto', DEFAULTS)).toBeUndefined()
    expect(agentModel('grok-4.7-xhigh-fast', { ...DEFAULTS, code: 'inherit' })).toBeUndefined()
  })

  test('the note names the configured models', () => {
    const note = harnessNote('/p', { search: 'haiku', code: 'fable', judgment: 'inherit' })

    expect(note).toContain('Grok slugs mean `fable`')
    expect(note).toContain('`claude-opus-*` slugs mean the parent model')
    expect(note).toContain('use `haiku`')
  })
})

describe('prompt.submit', () => {
  test('adds the note to pstack commands only', async ($, on) => {
    engine(on)

    const pstack = await $.prompt.submit(typed('/pstack:teach how skills work'))
    const other = await $.prompt.submit(typed('how do skills work'))
    const lookalike = await $.prompt.submit(typed('/pstack-ish thing'))

    expect(pstack.context?.[0]).toContain('pstack was written for Cursor')
    expect(other.context).toBeUndefined()
    expect(lookalike.context).toBeUndefined()
  })
})

describe('tool.call Read', () => {
  test('adds the note once per turn when reading a pstack skill', async ($, on) => {
    engine(on)
    const root = await pluginRoot($)
    await $.turn.start({ text: '', turnId: 't1' })

    const first = await $.tool.call({ tool: 'Read', file_path: `${root}/skills/how/SKILL.md` })
    const second = await $.tool.call({ tool: 'Read', file_path: `${root}/skills/why/SKILL.md` })
    await $.turn.start({ text: '', turnId: 't2' })
    const nextTurn = await $.tool.call({ tool: 'Read', file_path: `${root}/agents/poteto-agent.md` })

    expect(first.context?.[0]).toContain('pstack was written for Cursor')
    expect(second.context).toBeUndefined()
    expect(nextTurn.context?.[0]).toContain('pstack was written for Cursor')
  })

  test('skips the Read note when the pstack command already carried it this turn', async ($, on) => {
    engine(on)
    const root = await pluginRoot($)

    const read = await $.tool.call({ tool: 'Read', file_path: `${root}/skills/how/SKILL.md` })

    expect(read.context).toBeUndefined()
  })

  test('leaves files outside pstack alone', async ($, on) => {
    engine(on)
    await $.turn.start({ text: '', turnId: 't1' })

    const read = await $.tool.call({ tool: 'Read', file_path: '/tmp/elsewhere/skills/how/SKILL.md' })

    expect(read.context).toBeUndefined()
  })
})

describe('agent.spawn', () => {
  test('rewrites cursor agent types and models', async ($, on) => {
    const spawned: AgentSpawnInput[] = []
    engine(on, spawned)

    await $.agent.spawn(spawn('generalPurpose', 'grok-4.7-xhigh-fast'))
    await $.agent.spawn(spawn('poteto-agent', 'claude-opus-5-5-xhigh'))
    await $.agent.spawn(spawn('Explore', 'inherit-parent'))

    expect(spawned.map(e => [e.subagentType, e.model])).toEqual([
      ['general-purpose', 'sonnet'],
      ['pstack:poteto-agent', 'opus'],
      ['Explore', undefined],
    ])
  })

  test('uses the configured models', { options: { code_model: 'haiku', judgment_model: 'fable' } }, async ($, on) => {
    const spawned: AgentSpawnInput[] = []
    engine(on, spawned)

    await $.agent.spawn(spawn('general-purpose', 'grok-4.7-xhigh-fast'))
    await $.agent.spawn(spawn('general-purpose', 'claude-opus-5-5-xhigh'))

    expect(spawned.map(e => e.model)).toEqual(['haiku', 'fable'])
  })
})

const POTETO_SKILL = '---\nname: Poteto Mode\nmode: true\nreminder: New task? Apply it.\n---\n\n# Poteto mode\n'
const PROJECT = '/work/app'

// A session in PROJECT whose store starts with `stored`
async function session($: Engine, on: On, stored: Record<string, unknown> = {}): Promise<void> {
  engine(on)
  mock.store(on, stored)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.root', async () => ({ value: PROJECT }))
  on('fs.read', async () => ({ value: POTETO_SKILL }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('command.run', async () => ({ text: 'engine' }))
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })
}

// Records the footer labels that reach the engine; registered before the test's first $ call
function footer(on: On): ($: Engine) => Promise<readonly string[]> {
  let modes: readonly string[] = []
  on('ui.render', async ($, e) => {
    if (e.component === 'SessionMode') {
      modes = e.props.modes
    }
    const { Text } = $.ui.resolve(e)

    return <Text>footer</Text>
  })

  return async $ => {
    await $.ui.render({ surface: 'terminal', component: 'SessionMode', requestId: 'mode', props: { modes: ['focus'] } })

    return modes
  }
}

describe('poteto mode', () => {
  test('reads the reminder from poteto-mode frontmatter', () => {
    expect(reminderFrom(POTETO_SKILL)).toBe('New task? Apply it.')
    expect(reminderFrom('# no frontmatter')).toContain('apply /poteto-mode')
  })

  test('/poteto toggles the reminder on plain prompts', async ($, on) => {
    await session($, on)

    const off = await $.prompt.submit(typed('fix the login bug'))
    const turnedOn = await $.command.run(typedCommand('poteto'))
    const on1 = await $.prompt.submit(typed('fix the login bug'))
    const command = await $.prompt.submit(typed('/clear'))
    const turnedOff = await $.command.run(typedCommand('poteto'))
    const off2 = await $.prompt.submit(typed('fix the login bug'))

    expect(off.context).toBeUndefined()
    expect(turnedOn.text).toBe('poteto mode on')
    expect(on1.context?.[0]).toContain('Poteto mode is on. New task? Apply it.')
    expect(command.context).toBeUndefined()
    expect(turnedOff.text).toBe('poteto mode off')
    expect(off2.context).toBeUndefined()
  })

  test('remembers the choice per project', async ($, on) => {
    await session($, on, { [`poteto:${PROJECT}`]: true, 'poteto:/other': false })

    const prompt = await $.prompt.submit(typed('fix the login bug'))

    expect(prompt.context?.[0]).toContain('Poteto mode is on')
  })

  test('poteto_default turns it on for projects with no choice yet', { options: { poteto_default: true } }, async ($, on) => {
    await session($, on)

    const prompt = await $.prompt.submit(typed('fix the login bug'))

    expect(prompt.context?.[0]).toContain('Poteto mode is on')
  })

  test('the footer shows the label only while on', async ($, on) => {
    const draw = footer(on)
    await session($, on)

    const before = await draw($)
    await $.command.run(typedCommand('poteto'))
    const after = await draw($)

    expect(before).toEqual(['focus'])
    expect(after).toEqual(['focus', '♛ poteto'])
  })
})
