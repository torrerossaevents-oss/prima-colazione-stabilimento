---
name: find-skills
description: Use automatically at the start of every new project, feature or substantial task (before writing code or documents), and whenever the user asks "how do I do X", "find a skill for X", "is there a skill that can...", or wants to extend capabilities. Finds the best installable skill for the job in the open agent skills ecosystem (skills.sh). Source: vercel-labs/skills, MIT license.
---

<!--
Originale: https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md
Commit e781cb4d07433dfe1d19e924ed45cc61738c55ec (10/11/2026), licenza MIT (Vercel, Inc.), vedi LICENSE in questa cartella.
Modifiche per Torre Rossa: descrizione (uso automatico all'inizio di ogni progetto) e sezione "Regole di Teo". Il resto è l'originale.
-->

## Regole di Teo (valgono prima di tutto il resto)

1. **Uso automatico.** All'inizio di ogni nuovo progetto, funzione o compito importante, prima di scrivere codice, cerca da solo la skill più adatta, senza aspettare che Teo lo chieda. Per domande veloci o piccole correzioni non serve.
2. **Proponi, non installare da solo.** Mostra a Teo al massimo 3 skill: nome, a cosa serve, fonte, numero di installazioni, link a skills.sh e perché è utile per questo lavoro. Installa solo dopo il suo OK.
   *Eccezione:* quando un incarico scritto di Teo autorizza esplicitamente la ricerca e l'installazione autonoma (come l'incarico del 13/11/2026, `docs/PROMPT_CLAUDE_OTTIMIZZAZIONE.txt`), installa senza OK separato le skill pertinenti, dopo i controlli del punto 3, e registra fonte, commit e licenza in `STATO.md`.
3. **Controlla prima di proporre.** Leggi il SKILL.md della skill e segnala in parole semplici se esegue comandi o script, scarica file o manda dati verso l'esterno. Scarta le skill di autori sconosciuti con poche installazioni.
4. **Le regole del repository vincono.** `CLAUDE.md`, `AGENTS.md` e `STATO.md` del progetto prevalgono sempre su qualunque skill installata: credenziali, dati dei clienti, invii reali, branch `claude/...`, PR in bozza e revisione Codex restano come sono.
5. **Installa nel progetto, non solo sul computer**, così la skill arriva su GitHub e la vedono entrambi gli account:
   `npx skills add <owner/repo> --skill <nome> --agent claude-code --copy -y`
   (senza `-g`: finisce in `.claude/skills/<nome>/`; `--copy` evita i collegamenti simbolici che su GitHub non funzionano). Poi commit su un branch `claude/...` e PR in bozza, come sempre.
6. **Se `npx` non funziona** (sessione senza rete per i pacchetti): cerca con la ricerca web "skills.sh <argomento>", poi scarica la skill con `git clone --depth 1 https://github.com/<owner>/<repo>` e copia la sua cartella in `.claude/skills/`.
7. **Se nessuna skill serve davvero**, dillo in una riga e procedi con il lavoro.

---

# Find Skills

This skill helps you discover and install skills from the open agent skills ecosystem.

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain (design, testing, deployment, etc.)

## What is the Skills CLI?

The Skills CLI (`npx skills`) is the package manager for the open agent skills ecosystem. Skills are modular packages that extend agent capabilities with specialized knowledge, workflows, and tools.

**Key commands:**

- `npx skills find [query] [--owner <owner>]` - Search for skills interactively or by keyword, optionally scoped to a GitHub owner
- `npx skills add <package>` - Install a skill from GitHub or other sources
- `npx skills update` - Update all installed skills

**Browse skills at:** https://skills.sh/

## How to Help Users Find Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. The domain (e.g., React, testing, design, deployment)
2. The specific task (e.g., writing tests, creating animations, reviewing PRs)
3. Whether this is a common enough task that a skill likely exists

### Step 2: Check the Leaderboard First

Before running a CLI search, check the [skills.sh leaderboard](https://skills.sh/) to see if a well-known skill already exists for the domain. The leaderboard ranks skills by total installs, surfacing the most popular and battle-tested options.

For example, top skills for web development include:
- `vercel-labs/agent-skills` — React, Next.js, web design (100K+ installs each)
- `anthropics/skills` — Frontend design, document processing (100K+ installs)

### Step 3: Search for Skills

If the leaderboard doesn't cover the user's need, run the find command:

```bash
npx skills find [query] [--owner <owner>]
```

For example:

- User asks "how do I make my React app faster?" → `npx skills find react performance`
- User asks "can you help me with PR reviews?" → `npx skills find pr review`
- User asks "I need to create a changelog" → `npx skills find changelog`

### Step 4: Verify Quality Before Recommending

**Do not recommend a skill based solely on search results.** Always verify:

1. **Install count** — Prefer skills with 1K+ installs. Be cautious with anything under 100.
2. **Source reputation** — Official sources (`vercel-labs`, `anthropics`, `microsoft`) are more trustworthy than unknown authors.
3. **GitHub stars** — Check the source repository. A skill from a repo with <100 stars should be treated with skepticism.

### Step 5: Present Options to the User

When you find relevant skills, present them to the user with:

1. The skill name and what it does
2. The install count and source
3. The install command they can run
4. A link to learn more at skills.sh

Example response:

```
I found a skill that might help! The "react-best-practices" skill provides
React and Next.js performance optimization guidelines from Vercel Engineering.
(185K installs)

To install it:
npx skills add vercel-labs/agent-skills@react-best-practices

Learn more: https://skills.sh/vercel-labs/agent-skills/react-best-practices
```

### Step 6: Offer to Install

If the user wants to proceed, you can install the skill for them:

```bash
npx skills add <owner/repo@skill> -g -y
```

The `-g` flag installs globally (user-level) and `-y` skips confirmation prompts.

## Common Skill Categories

When searching, consider these common categories:

| Category        | Example Queries                          |
| --------------- | ---------------------------------------- |
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing         | testing, jest, playwright, e2e           |
| DevOps          | deploy, docker, kubernetes, ci-cd        |
| Documentation   | docs, readme, changelog, api-docs        |
| Code Quality    | review, lint, refactor, best-practices   |
| Design          | ui, ux, design-system, accessibility     |
| Productivity    | workflow, automation, git                |

## Tips for Effective Searches

1. **Use specific keywords**: "react testing" is better than just "testing"
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or "ci-cd"
3. **Check popular sources**: Many skills come from `vercel-labs/agent-skills` or `ComposioHQ/awesome-claude-skills`

## When No Skills Are Found

If no relevant skills exist:

1. Acknowledge that no existing skill was found
2. Offer to help with the task directly using your general capabilities
3. Suggest the user could create their own skill with `npx skills init`

Example:

```
I searched for skills related to "xyz" but didn't find any matches.
I can still help you with this task directly! Would you like me to proceed?

If this is something you do often, you could create your own skill:
npx skills init my-xyz-skill
```
