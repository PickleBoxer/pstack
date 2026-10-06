// Cursor pins poteto mode's SKILL.md as a Custom Mode. Desktop sessions raise no prompt.compose, so here it rides a prompt's context once

export function potetoSection(root: string, skill: string, note: string): string {
  const body = skill.replace(/^---\n[\s\S]*?\n---\n*/, '').trim()

  return [
    `Poteto mode is on for this project. Follow the poteto-mode skill below on every turn until a later note says poteto mode is off; no Read of its SKILL.md needed. Its playbooks and references live under \`${root}/skills/poteto-mode/\`.`,
    note,
    body,
  ].join('\n\n')
}

export const POTETO_OFF = 'Poteto mode is now off for this project. Stop following the poteto-mode skill given earlier in this conversation and work in your normal style.'

export function storeKey(projectRoot: string): string {
  return `poteto:${projectRoot}`
}
