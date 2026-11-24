import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const read = (path: string) => readFileSync(here(path), 'utf8');

const MARKETPLACE = './marketplace/';
const PLUGIN = `${MARKETPLACE}plugins/release-tools/`;
const SKILL = `${PLUGIN}skills/release-checklist/`;
const EVALS = `${PLUGIN}evals/`;

/**
 * Reads the YAML frontmatter of a Markdown file, for the subset these files use: `key: value`, `key: [a, b]` and
 * `key:` followed by `- item` lines. Returns null when the file has no frontmatter.
 */
function readFrontmatter(markdown: string): { fields: Record<string, string | string[]>; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return null;
  const fields: Record<string, string | string[]> = {};
  let list: string[] | undefined;
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const item = /^\s+-\s+(.+)$/.exec(line)?.[1];
    if (item !== undefined && list) {
      list.push(item);
      continue;
    }
    const [, key, value] = /^([\w-]+):\s*(.*)$/.exec(line) ?? [];
    if (key === undefined || value === undefined) throw new Error(`Unexpected frontmatter line: ${line}`);
    list = value === '' ? [] : undefined;
    fields[key] =
      list ??
      (/^\[.*\]$/.test(value)
        ? value
            .slice(1, -1)
            .split(',')
            .map((part) => part.trim())
        : value);
  }
  return { fields, body: markdown.slice(match[0].length) };
}

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

describe('release-checklist SKILL.md', () => {
  const skill = readFrontmatter(read(`${SKILL}SKILL.md`));
  const description = String(skill?.fields.description);

  it('has a kebab-case name that matches its folder', () => {
    expect(skill?.fields.name).toBe('release-checklist');
    expect(skill?.fields.name).toMatch(KEBAB_CASE);
  });

  it('has a description within the listing limit that says when to use it and when not', () => {
    expect(description.length).toBeLessThanOrEqual(1_536);
    expect(description).toMatch(/^Checks whether a service is ready to release/);
    expect(description).toMatch(/Use when .*(tagging|production)/);
    expect(description).toMatch(/Do not use for .*release notes/);
  });

  it('keeps the description a plain YAML scalar (no ": " or " #", which would end or break it)', () => {
    expect(description).not.toMatch(/: | #/);
  });

  it('pre-approves only the bundled script and read-only git commands', () => {
    expect(skill?.fields['allowed-tools']).toEqual([
      'Bash(node ${CLAUDE_SKILL_DIR}/scripts/check-pending-migrations.mjs *)',
      'Bash(git log *)',
      'Bash(git describe *)',
    ]);
  });

  it('has numbered steps and runs a script that exists next to it', () => {
    const body = skill?.body ?? '';
    expect(body.match(/^\d+\. \*\*/gm)).toHaveLength(7);
    const [, script] = /node \$\{CLAUDE_SKILL_DIR\}\/(\S+)/.exec(body) ?? [];
    expect(script).toBe('scripts/check-pending-migrations.mjs');
    expect(existsSync(here(`${SKILL}${script}`))).toBe(true);
  });
});

describe('plugin and marketplace manifests', () => {
  const pluginSchema = z.object({
    name: z.string().regex(KEBAB_CASE),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().min(1),
    author: z.object({ name: z.string().min(1) }),
  });
  const marketplaceSchema = z.object({
    name: z.string().regex(KEBAB_CASE),
    owner: z.object({ name: z.string().min(1) }),
    description: z.string().min(1),
    plugins: z.array(z.object({ name: z.string(), source: z.string().startsWith('./'), description: z.string() })),
  });

  it('plugin.json names the plugin in kebab-case with a version and a description', () => {
    expect(pluginSchema.parse(JSON.parse(read(`${PLUGIN}.claude-plugin/plugin.json`))).name).toBe('release-tools');
  });

  it('marketplace.json points every entry at a plugin folder whose manifest has the same name', () => {
    const marketplace = marketplaceSchema.parse(JSON.parse(read(`${MARKETPLACE}.claude-plugin/marketplace.json`)));
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual(['release-tools']);
    for (const entry of marketplace.plugins) {
      const manifest = pluginSchema.parse(JSON.parse(read(`${MARKETPLACE}${entry.source}/.claude-plugin/plugin.json`)));
      expect(manifest.name).toBe(entry.name);
    }
  });
});

describe('plugin eval cases', () => {
  const cases = readdirSync(here(EVALS));
  const graderTypes = new Set(['regex', 'tool_order', 'tool_used', 'file_exists', 'llm', 'baseline']);

  it('has a case that must trigger the skill and one that must not', () => {
    expect(cases.sort()).toEqual([
      'release-request-gets-a-readiness-report',
      'versioning-question-does-not-start-the-checklist',
    ]);
    const mustNot = readFrontmatter(
      read(`${EVALS}versioning-question-does-not-start-the-checklist/graders/skill-is-not-used.md`),
    );
    expect(mustNot?.fields).toEqual({ type: 'tool_used', tool: 'Skill', min: '0', max: '0', arm: 'both' });
  });

  it.each(cases)('%s has a prompt with limits and graders of known types', (name) => {
    const prompt = readFrontmatter(read(`${EVALS}${name}/prompt.md`));
    expect(prompt?.fields).toMatchObject({ max_turns: expect.any(String), timeout_seconds: expect.any(String) });
    expect(prompt?.fields.allowed_tools).toContain('Skill');
    expect(prompt?.body.trim()).not.toBe('');
    const graders = readdirSync(here(`${EVALS}${name}/graders`));
    expect(graders.length).toBeGreaterThanOrEqual(2);
    for (const grader of graders) {
      const type = readFrontmatter(read(`${EVALS}${name}/graders/${grader}`))?.fields.type;
      expect(graderTypes.has(String(type))).toBe(true);
    }
  });
});

describe('flawed wiki prompt', () => {
  const problem = read('./release-process.problem.md');

  it('has no frontmatter, so nothing can discover it: it runs only when someone remembers to paste it', () => {
    expect(readFrontmatter(problem)).toBeNull();
  });

  it('asks the model to tag and deploy by itself, with a hardcoded version', () => {
    expect(problem).toContain('git tag v2.3.1 && git push --tags');
    expect(problem).toContain('make deploy ENV=prod');
  });
});
