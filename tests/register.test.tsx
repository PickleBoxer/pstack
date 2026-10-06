import type { AgentSpawnInput, CommandRunInput, FsEntry, On, PromptSubmitInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { descriptionFrom, grouped } from '../hooks/catalog'
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

function entry(name: string, kind: 'file' | 'dir'): FsEntry {
  return { name, kind, size: 0, mtimeMs: 0, isLink: false }
}

type Shown = { toasts: string[] }

// A session in PROJECT whose store starts with `stored`; returns the toasts it shows
async function session($: Engine, on: On, stored: Record<string, unknown> = {}, filled: string[] = []): Promise<Shown> {
  const shown: Shown = { toasts: [] }
  engine(on)
  on('ui.toast', async (_$, e) => (shown.toasts.push(e.text), { value: undefined }))
  mock.store(on, stored)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.root', async () => ({ value: PROJECT }))
  on('fs.list', async () => ({
    value: [
      ...['how', 'poteto-mode', 'principle-prove-it-works', 'brand-new'].map(name => entry(name, 'dir')),
      entry('notes.md', 'file'),
    ],
  }))
  on('fs.read', async (_$, e) => ({
    value: e.path.endsWith('poteto-mode/SKILL.md') ? POTETO_SKILL : `---\ndescription: "About ${e.path.split('/').at(-2)}"\n---\n`,
  }))
  on('prompt.fill', async (_$, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  on('command.describe', async (_$, e) => ({ description: e.description, isHidden: e.isHidden }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('command.run', async () => ({ text: 'engine' }))
  await $.session.start({ cwd: PROJECT, surface: 'terminal', isInteractive: true })

  return shown
}

describe('poteto mode', () => {
  test('reads the reminder from poteto-mode frontmatter', () => {
    expect(reminderFrom(POTETO_SKILL)).toBe('New task? Apply it.')
    expect(reminderFrom('# no frontmatter')).toContain('apply /poteto-mode')
  })

  test('/poteto toggles the reminder on plain prompts', async ($, on) => {
    const { toasts } = await session($, on)

    const off = await $.prompt.submit(typed('fix the login bug'))
    const turnedOn = await $.command.run(typedCommand('poteto'))
    const on1 = await $.prompt.submit(typed('fix the login bug'))
    const command = await $.prompt.submit(typed('/clear'))
    const turnedOff = await $.command.run(typedCommand('poteto'))
    const off2 = await $.prompt.submit(typed('fix the login bug'))

    expect(off.context).toBeUndefined()
    expect(turnedOn.text).toBeUndefined()
    expect(on1.context?.[0]).toContain('Poteto mode is on. New task? Apply it.')
    expect(command.context).toBeUndefined()
    expect(turnedOff.text).toBeUndefined()
    expect(off2.context).toBeUndefined()
    expect(toasts).toEqual(['poteto mode on', 'poteto mode off'])
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

  test('the footer shows poteto on and off after the other modes and toggles on press', async ($, on) => {
    const { toasts } = await session($, on)
    const props = { modes: ['focus'] }

    for (const surface of ['terminal', 'desktop'] as const) {
      const footer = await $.ui.mount({ plugin: 'pstack', surface, component: 'SessionMode', requestId: 'mode', props })
      expect(await footer.find({ type: 'Text', text: 'focus & ' })).toBeDefined()
      expect(await footer.find({ type: 'Text', text: ' ♛ off' })).toBeDefined()

      await footer.press({ key: 'poteto' })
      expect(await footer.find({ type: 'Text', text: ' ♛ on' })).toBeDefined()
      expect((await $.prompt.submit(typed('fix the login bug'))).context?.[0]).toContain('Poteto mode is on')

      await footer.press({ key: 'poteto' })
      await footer.unmount()
    }

    expect(toasts).toEqual(['poteto mode on', 'poteto mode off', 'poteto mode on', 'poteto mode off'])
  })
})

const PANE_PROPS = {
  title: 'pstack',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

function describeInput(command: string) {
  return { command, description: 'd', isHidden: false, immediate: false, provider: { plugin: 'pstack', tier: 'user' as const } }
}

describe('/pstack pane', () => {
  test('reads quoted and plain descriptions', () => {
    expect(descriptionFrom('---\nname: tdd\ndescription: "Use only when asked"\n---')).toBe('Use only when asked')
    expect(descriptionFrom('---\ndescription: Explain how X works\n---')).toBe('Explain how X works')
    expect(descriptionFrom('no frontmatter')).toBe('')
  })

  test('groups skills in plan order, principles together, unknown ones in Other', () => {
    const names = ['why', 'principle-b', 'how', 'zzz', 'poteto-help', 'poteto-mode', 'principle-a']
    const groups = grouped(names.map(name => ({ name, description: '' })))

    expect(groups.map(group => [group.title, group.skills.map(skill => skill.name)])).toEqual([
      ['Start here', ['poteto-mode', 'poteto-help']],
      ['Understand', ['how', 'why']],
      ['Principles', ['principle-a', 'principle-b']],
      ['Other', ['zzz']],
    ])
  })

  test('shows groups as tabs, the pressed tab skills below, and fills the prompt on press', async ($, on) => {
    const filled: string[] = []
    await session($, on, {}, filled)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'pstack', surface, component: 'Pane', requestId: 'pstack', props: PANE_PROPS })

      expect((await ui.find({ key: 'group-Start here' }))?.text).toBe('Start here')
      expect((await ui.find({ key: 'group-Other' }))?.text).toBe('Other')
      expect(await ui.find({ key: 'run-poteto-mode' })).toBeDefined()
      expect(await ui.find({ key: 'run-how' })).toBeUndefined()

      await ui.press({ key: 'group-Understand' })
      expect(await ui.find({ type: 'Text', text: 'About how' })).toBeDefined()
      expect(await ui.find({ key: 'run-poteto-mode' })).toBeUndefined()
      expect(await ui.find({ key: 'run-notes.md' })).toBeUndefined()

      await ui.press({ key: 'run-how' })
      await ui.press({ key: 'group-Start here' })
      await ui.unmount()
    }

    expect(filled).toEqual(['/pstack:how ', '/pstack:how '])
  })

  test('hide removes a skill from the / menu and remembers it', async ($, on) => {
    const stored: Record<string, unknown> = {}
    await session($, on, stored)
    const ui = await $.ui.mount({ plugin: 'pstack', surface: 'terminal', component: 'Pane', requestId: 'pstack', props: PANE_PROPS })
    await ui.press({ key: 'group-Understand' })

    const before = await $.command.describe(describeInput('pstack:how'))
    await ui.press({ key: 'hide-how' })
    const hidden = await $.command.describe(describeInput('pstack:how'))
    const other = await $.command.describe(describeInput('how'))
    const label = (await ui.find({ key: 'hide-how' }))?.text
    await ui.press({ key: 'hide-how' })
    const shown = await $.command.describe(describeInput('pstack:how'))

    expect(before.isHidden).toBe(false)
    expect(hidden.isHidden).toBe(true)
    expect(other.isHidden).toBe(false)
    expect(label).toBe('show')
    expect(shown.isHidden).toBe(false)
  })

  test('starts with the hidden skills from the store', async ($, on) => {
    await session($, on, { hidden: ['why', 42] })

    const why = await $.command.describe(describeInput('pstack:why'))

    expect(why.isHidden).toBe(true)
  })
})
