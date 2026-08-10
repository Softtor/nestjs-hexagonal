## Summary

## Architecture impact

- [ ] Domain stays free of NestJS (except `AggregateRoot` / `IEvent`)
- [ ] Repositories remain pure persistence
- [ ] EventPublisher stays in Handler, not UseCase
- [ ] Module exports only port tokens
- [ ] No over-engineering / generic relays

## Checklist

- [ ] Skills / agents / examples updated as needed
- [ ] README or ROADMAP updated if user-facing
- [ ] Model pins remain `claude-opus-5` / `claude-sonnet-5` unless intentionally changed
