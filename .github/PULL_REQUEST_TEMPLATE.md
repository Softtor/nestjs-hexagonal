## Summary

## Architecture impact

- [ ] Domain stays free of NestJS
- [ ] Repositories remain pure persistence
- [ ] EventDispatcher stays in Handler, not UseCase
- [ ] Module exports only port tokens
- [ ] No over-engineering / generic relays

## Checklist

- [ ] Skills / agents / examples updated as needed
- [ ] README or ROADMAP updated if user-facing
- [ ] Model pins remain `claude-opus-5-5` / `claude-sonnet-5` unless intentionally changed

- [ ] Event publication follows the actual transaction commit; use cases and repositories never publish
- [ ] Pending events are acknowledged only on success; partial failures retain the rest
- [ ] Named EventBus publications have factories; original instance identity is preserved
- [ ] Dispatcher changes cover sync, Promise and cold Observable completion and errors
