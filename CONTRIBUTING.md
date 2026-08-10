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
| Agent | `agents/*.md` | Frontmatter `model` must stay pinned (`claude-opus-5` / `claude-sonnet-5`) unless the change is intentional |
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

- [ ] `model` is an explicit ID (`claude-opus-5` or `claude-sonnet-5`) when capability matters
- [ ] Description states when to dispatch the agent
- [ ] Body starts by loading the matching skill
- [ ] Opus 5 for decisions (domain, review, event debug); Sonnet 5 for execution layers

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
