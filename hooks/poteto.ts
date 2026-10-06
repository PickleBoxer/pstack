// Poteto mode: Cursor pins it as a Custom Mode, here /poteto toggles a per-project reminder

const FALLBACK = "New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't."

// Upstream keeps the mode's reminder in poteto-mode's frontmatter, so it follows upstream edits
export function reminderFrom(skill: string): string {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''

  return frontmatter.match(/^reminder:\s*(.+)$/m)?.[1]?.trim() || FALLBACK
}

export function potetoContext(root: string, reminder: string): string {
  return `Poteto mode is on. ${reminder} To apply /poteto-mode, Read \`${root}/skills/poteto-mode/SKILL.md\` and follow it; the Skill tool refuses pstack skills.`
}

export function storeKey(projectRoot: string): string {
  return `poteto:${projectRoot}`
}
