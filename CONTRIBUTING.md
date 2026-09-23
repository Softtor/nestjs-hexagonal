# Contributing

Thanks for helping grow nestjs-hexagonal — especially after the first community stars.

## Before you start

1. Read [CLAUDE.md](CLAUDE.md) architecture rules
2. Skim [ROADMAP.md](ROADMAP.md) and pick a track (or propose a new one in an issue)
3. Prefer extending an existing skill over inventing a parallel pattern

## Ways to contribute

| Kind | Where | Notes |
|---|---|---|
| Skill / reference | `skills/<name>/` | `SKILL.md` + `references/` templates |
| Agent | `agents/*.md` | Frontmatter `model` must stay pinned (`claude-opus-5-5` / `claude-sonnet-5`; `claude-haiku-4-5` or `haiku` only for read-only scanners) unless the change is intentional |
| Shared examples | `shared/**/*.ts.example` | No NestJS in domain examples |
| Bounded context sample | `examples/` | Mirror Order BC layering |
| Docs / DX | `README.md`, `.github/` | Issue templates, checklists, i18n |

## Skill checklist

- [ ] Triggers and `argument-hint` match real user phrases
- [ ] Patterns respect: AggregateRoot + `apply`, pure repository, EventPublisher only in Handler
- [ ] Module exports only port tokens
- [ ] `class-validator` only in presentation request DTOs
- [ ] Write ops return `void` or `{ id: string }`
- [ ] TDD: test snippet before implementation snippet
- [ ] No over-engineering (no generic relays, no use case for trivial `findById`)

## Agent checklist

- [ ] `model` is an explicit ID (`claude-opus-5-5` or `claude-sonnet-5`) when capability matters; `haiku` only for read-only scanning
- [ ] Description states when to dispatch the agent
- [ ] Body says where the rules come from (the rulebook slice injected at `SubagentStart`) and loads the matching skill for code patterns
- [ ] Body has the "When the SubagentStop hook blocks" section and runs `nestjs-hexagonal-check` on the files it created before finishing
- [ ] Opus 5.5 for decisions (domain, review, event debug); Sonnet 5 for execution layers

## Frontmatter, references and links (CI)

`bun scripts/validate-frontmatter.ts` runs as the `frontmatter` job of `.github/workflows/ci.yml` and fails the pull request when:

- an `agents/*.md` file lacks `name`, `description`, `model` or a non-empty `tools` list, its frontmatter is not valid YAML, or its `model` is outside `claude-opus-5-5`, `claude-sonnet-5`, `claude-haiku-4-5`, `haiku`;
- a `skills/*/SKILL.md` lacks `name` or `description`, or its `name` differs from the directory name;
- a `nestjs-hexagonal:<id>` reference in agents, skills, README, CLAUDE.md, CONTRIBUTING.md, ROADMAP.md or CHANGELOG.md names neither a skill nor an agent;
- a relative Markdown link in those files does not resolve (links inside fenced code blocks are ignored).

Run it locally before opening the PR; `bun test ./scripts` also validates the real tree through `scripts/__tests__/validate-frontmatter.spec.ts`.

## PR process

1. Fork and branch from `main`
2. Keep the diff focused on one track
3. Update README / ROADMAP if you add a skill or agent
4. Open a PR describing problem, approach, and architecture rule impact

## Reporting ideas

Use the issue templates under `.github/ISSUE_TEMPLATE/`:

- **Skill proposal** — new pattern pack
- **Feature / adapter** — persistence, transport, messaging
- **Good first issue** — docs and small examples

## Local plugin smoke test

```bash
claude --plugin-dir /path/to/nestjs-hexagonal
```

Then invoke `nestjs-hexagonal:using-nestjs-hexagonal` and confirm routing still matches your change.
