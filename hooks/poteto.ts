// Cursor pins poteto mode's SKILL.md into the system prompt as a Custom Mode; here /poteto toggles that pin per project

export function potetoSection(root: string, skill: string, note: string): string {
  const body = skill.replace(/^---\n[\s\S]*?\n---\n*/, '').trim()

  return [
    `Poteto mode is on for this project. The poteto-mode skill below is pinned: follow it on every turn, no Read of its SKILL.md needed. Its playbooks and references live under \`${root}/skills/poteto-mode/\`.`,
    note,
    body,
  ].join('\n\n')
}

export function storeKey(projectRoot: string): string {
  return `poteto:${projectRoot}`
}
