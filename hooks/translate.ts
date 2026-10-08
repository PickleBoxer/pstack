// Pure mapping from upstream's Cursor vocabulary to Claude Code, kept free of `$` so tests can call it directly

export type Models = {
  search: string
  code: string
  judgment: string
}

const AGENT_TYPES: Record<string, string> = {
  generalPurpose: 'general-purpose',
  'poteto-agent': 'pstack:poteto-agent',
  'Comment Sicko': 'pstack:Comment Sicko',
}

const INHERIT = new Set(['inherit', 'inherit-parent', 'auto'])

export function modelsFrom(options: Readonly<Record<string, unknown>>): Models {
  const pick = (key: string, fallback: string) => (typeof options[key] === 'string' ? (options[key] as string) : fallback)

  return {
    search: pick('search_model', 'haiku'),
    code: pick('code_model', 'sonnet'),
    judgment: pick('judgment_model', 'opus'),
  }
}

export function agentType(type: string): string {
  return AGENT_TYPES[type] ?? type
}

// undefined means omit `model`, so the subagent runs on its own or the parent's model
export function agentModel(model: string | undefined, models: Models): string | undefined {
  if (model === undefined || INHERIT.has(model)) {
    return undefined
  }

  const mapped = model.startsWith('grok-') ? models.code : model.startsWith('claude-opus-') ? models.judgment : model

  return INHERIT.has(mapped) ? undefined : mapped
}

function named(model: string): string {
  return INHERIT.has(model) ? 'the parent model (omit `model`)' : `\`${model}\``
}

export function harnessNote(root: string, models: Models): string {
  return [
    'pstack was written for Cursor. You are in Claude Code, so translate its instructions as you follow them:',
    `- Another pstack skill: Read \`${root}/skills/<name>/SKILL.md\` and follow it. Principles are the exception: load one with the Skill tool as \`pstack:principle-<slug>\`. The Skill tool refuses every other pstack skill. Read pstack files one per Read call, in parallel when there are several, never through \`cat\`, \`sed\` or \`head\` in Bash.`,
    '- `Task` tool or call: the `Agent` tool. Subagent types: `generalPurpose` is `general-purpose`, `poteto-agent` is `pstack:poteto-agent`, `Comment Sicko` is `pstack:Comment Sicko`. Readonly agent mode: the `Explore` agent. `environment: "cloud"`: `isolation: "worktree"`.',
    '- `AskQuestion`: `AskUserQuestion`.',
    `- Models: \`~/.cursor/rules/pstack-models.mdc\` and \`/setup-pstack\` do not exist here, so use the defaults below. Grok slugs mean ${named(models.code)}. \`claude-opus-*\` slugs mean ${named(models.judgment)}. Fast searches (the recall fan-out, readonly exploration) use ${named(models.search)}. \`inherit\`, \`inherit-parent\` and \`auto\` mean omit \`model\`. A panel of Opus and Grok is one judgment-model and one code-model agent.`,
    '- Not available: cursor-team-kit (`deslop`, `control-ui`, `control-cli`), `/make-bot-ui`, and Cursor\'s `create-skill` (use `skill-creator` if installed). Use the project\'s own verification skill or browser tools instead, and say what you skipped.',
    "- The user's CLAUDE.md files and rules win over pstack's Autonomy guidance. If they say never commit, do not commit.",
  ].join('\n')
}
