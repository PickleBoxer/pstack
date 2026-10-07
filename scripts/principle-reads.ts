#!/usr/bin/env bun
// Runs organic tasks headless with poteto mode on and reports which principle leaves the model read and which it cited.
// Usage: bun scripts/principle-reads.ts [--runs N] [--model M] [--max-turns N] [case ...]
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

type Principle = `principle-${string}`

type Case = {
  name: string
  project: string
  expect: Principle[]
  prompt: string
  files: Record<string, string>
}

type Run = {
  name: string
  dir: string
  delivered: boolean
  read: Principle[]
  cited: Principle[]
  hit: boolean
  citedUnread: Principle[]
}

const cases: Case[] = [
  {
    name: 'flaky-cache',
    project: 'ledger',
    expect: ['principle-fix-root-causes'],
    prompt: 'the cache test in this repo fails every few runs on CI. can you fix it?',
    files: {
      'package.json': JSON.stringify({ name: 'ledger', type: 'module', scripts: { test: 'node --test' } }, null, 2),
      'src/cache.js': `const entries = new Map()

export async function remember(key, load) {
  if (entries.has(key)) {
    return entries.get(key)
  }

  const value = await load()
  entries.set(key, value)

  return value
}
`,
      'test/cache.test.js': `import { test } from 'node:test'
import assert from 'node:assert'
import { remember } from '../src/cache.js'

test('loads each key once', async () => {
  let loads = 0
  const load = () => new Promise(resolve => setTimeout(() => resolve(++loads), 5))

  const first = remember('rates', load)
  const second = new Promise(resolve => setTimeout(() => resolve(remember('rates', load)), Math.random() * 10))

  await Promise.all([first, second])
  assert.strictEqual(loads, 1)
})
`,
    },
  },
  {
    name: 'discount-codes',
    project: 'storefront',
    expect: ['principle-model-the-domain', 'principle-foundational-thinking', 'principle-type-system-discipline'],
    prompt:
      'add discount codes to checkout. we need percentage codes, fixed amount codes, and codes that expire. an expired or unknown code should be rejected with a clear error.',
    files: {
      'package.json': JSON.stringify({ name: 'storefront', type: 'module', scripts: { test: 'node --test' } }, null, 2),
      'src/checkout.js': `export function total(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}
`,
    },
  },
  {
    name: 'tangled-report',
    project: 'billing-reports',
    expect: ['principle-minimize-reader-load', 'principle-laziness-protocol', 'principle-subtract-before-you-add'],
    prompt: 'src/report.js is really hard to follow. can you clean it up without changing what it prints?',
    files: {
      'package.json': JSON.stringify({ name: 'billing-reports', type: 'module' }, null, 2),
      'src/report.js': `let state = { rows: [], totals: {} }

function getRows() { return state.rows }
function setRows(rows) { state.rows = rows }
function wrapRow(r) { return { data: r } }
function unwrapRow(w) { return w.data }
function addToTotal(key, amount) { state.totals[key] = (state.totals[key] || 0) + amount }

function process(input) {
  setRows(input.map(wrapRow))
  for (const w of getRows()) {
    const r = unwrapRow(w)
    if (r.type === 'invoice') { addToTotal('invoice', r.amount) }
    else if (r.type === 'refund') { addToTotal('refund', -r.amount) }
    else if (r.type === 'credit') { addToTotal('credit', -r.amount) }
  }
}

function format() {
  return Object.entries(state.totals).map(([k, v]) => k + ': ' + v.toFixed(2)).join('\\n')
}

export function report(input) {
  state = { rows: [], totals: {} }
  process(input)
  return format()
}
`,
    },
  },
]

const root = join(dirname(import.meta.path), '..')

const titles = new Map<Principle, string>(
  readdirSync(join(root, 'skills'))
    .filter((name): name is Principle => name.startsWith('principle-'))
    .map(name => [name, readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8').match(/^# (.+)$/m)?.[1] ?? name]),
)

function cites(text: string): Principle[] {
  return [...titles].filter(([slug, title]) => text.includes(slug) || text.includes(title)).map(([slug]) => slug)
}

async function claude(dir: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['claude', '-p', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()

  if ((await proc.exited) !== 0) {
    throw new Error(`claude exited ${proc.exitCode} in ${dir}: ${await new Response(proc.stderr).text()}`)
  }

  return out
}

function setUp(one: Case): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'work-')), one.project)

  for (const [path, body] of Object.entries(one.files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), body)
  }

  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir })
  Bun.spawnSync(['git', 'add', '.'], { cwd: dir })
  Bun.spawnSync(['git', '-c', 'user.name=dev', '-c', 'user.email=dev@example.com', 'commit', '-qm', 'init'], { cwd: dir })

  return dir
}

function transcript(sessionId: string): string {
  const projects = join(homedir(), '.claude', 'projects')
  const match = readdirSync(projects).find(slug => Bun.file(join(projects, slug, `${sessionId}.jsonl`)).size > 0)

  return match === undefined ? '' : readFileSync(join(projects, match, `${sessionId}.jsonl`), 'utf8')
}

async function run(one: Case, flags: string[]): Promise<Run> {
  const dir = setUp(one)
  const sessionId = crypto.randomUUID()

  const toggle = (await claude(dir, ['/poteto', '--session-id', sessionId, '--output-format', 'stream-json', '--verbose', ...flags]))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const pluginRoot: string = toggle.find(event => event.subtype === 'init').plugins.find((plugin: { name: string }) => plugin.name === 'pstack').path

  const events = (await claude(dir, ['--resume', sessionId, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--add-dir', pluginRoot, ...flags, one.prompt]))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))

  const attempts = new Map<string, Principle[]>()
  const read = new Set<Principle>()

  for (const event of events) {
    if (event.parent_tool_use_id) {
      continue
    }

    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_use' && (block.name === 'Read' || block.name === 'Bash')) {
        const target = String(block.input.file_path ?? block.input.command)
        attempts.set(block.id, [...target.matchAll(/skills\/(principle-[a-z-]+)\/SKILL\.md/g)].map(match => match[1] as Principle))
      }

      if (block.type === 'tool_result' && !block.is_error) {
        for (const slug of attempts.get(block.tool_use_id) ?? []) {
          read.add(slug)
        }
      }
    }
  }

  const resultEvent = events.findLast(event => event.type === 'result')
  const cited = cites(String(resultEvent?.result ?? ''))
  const sessions = new Set(events.map(event => event.session_id).filter(Boolean))
  const delivered = [...sessions].some(id => transcript(id).includes('Poteto mode is on for this project'))

  return {
    name: one.name,
    dir,
    delivered,
    read: [...read],
    cited,
    hit: one.expect.some(slug => read.has(slug)),
    citedUnread: cited.filter(slug => !read.has(slug)),
  }
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { runs: { type: 'string', default: '1' }, model: { type: 'string' }, 'max-turns': { type: 'string', default: '40' } },
  allowPositionals: true,
})

const flags = [...(values.model ? ['--model', values.model] : []), '--max-turns', values['max-turns']]
const picked = positionals.length === 0 ? cases : cases.filter(one => positionals.includes(one.name))
const jobs = picked.flatMap(one => Array.from({ length: Number(values.runs) }, () => run(one, flags)))
const runs = await Promise.all(jobs)

for (const one of runs) {
  console.log(
    [
      `${one.hit ? 'HIT ' : 'MISS'} ${one.name}${one.delivered ? '' : ' (poteto not delivered, run invalid)'}`,
      `  read:         ${one.read.join(', ') || 'none'}`,
      `  cited:        ${one.cited.join(', ') || 'none'}`,
      `  cited unread: ${one.citedUnread.join(', ') || 'none'}`,
      `  dir:          ${one.dir}`,
    ].join('\n'),
  )
}

const valid = runs.filter(one => one.delivered)
console.log(`\nexpected leaf read: ${valid.filter(one => one.hit).length}/${valid.length}`)
console.log(`cited without reading: ${valid.filter(one => one.citedUnread.length > 0).length}/${valid.length}`)
