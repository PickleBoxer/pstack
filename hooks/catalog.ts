// The /pstack pane's grouping of upstream skills; a skill upstream adds later lands in Other until it is placed here

import type { PstackSkill } from '../types'

const GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Start here', ['poteto-mode', 'poteto-help']],
  ['Understand', ['how', 'why', 'teach', 'recall', 'blast-radius', 'bro']],
  ['Design', ['architect', 'arena', 'interrogate', 'figure-it-out']],
  [
    'Build and verify',
    ['tdd', 'swarm', 'create-verification-skill', 'maintain-verification-skill', 'benchmark-checklist', 'show-me-your-work'],
  ],
  ['Clean and write', ['unslop', 'no-comments', 'technical-writing', 'typescript-best-practices']],
  ['Improve the setup', ['correct', 'reflect', 'automate-me']],
]

export type Group = { title: string; skills: PstackSkill[] }

export function descriptionFrom(skill: string): string {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? ''

  return description.replace(/^(["'])(.*)\1$/, '$2')
}

function groupOf(name: string): string {
  if (name.startsWith('principle-')) {
    return 'Principles'
  }

  return GROUPS.find(([, names]) => names.includes(name))?.[0] ?? 'Other'
}

export function grouped(skills: readonly PstackSkill[]): Group[] {
  const titles = [...GROUPS.map(([title]) => title), 'Principles', 'Other']
  const order = (name: string) => GROUPS.flatMap(([, names]) => names).indexOf(name)

  return titles
    .map(title => ({
      title,
      skills: skills
        .filter(skill => groupOf(skill.name) === title)
        .sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name)),
    }))
    .filter(group => group.skills.length > 0)
}
