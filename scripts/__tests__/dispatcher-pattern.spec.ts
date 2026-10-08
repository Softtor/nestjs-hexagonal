import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { classifyPattern } from '../lib/executors/pattern-consistent.ts';

function handler(body: string, decorator = 'CommandHandler'): string {
  return `@${decorator}(Action)\nclass Handler { ${body} }`;
}

describe('dispatcher application pattern classification', () => {
  it('classifies injected dispatcher command and query handlers as B', () => {
    for (const decorator of ['CommandHandler', 'QueryHandler']) {
      expect(classifyPattern(handler('constructor(private readonly events: EventDispatcher) {}', decorator))).toBe('B');
    }
  });

  it('classifies fluent entity and event publication as B', () => {
    for (const publication of [
      'await this.events.from(entity).publish();',
      'await this.events.event(new CreatedEvent(id)).publish();',
      "await this.events.event('order.created').with({ orderId: id }).keyedBy(id).publish();",
      "await dispatch(publisher).event('order.created').with({ orderId: id }).publish();",
      'return dispatch(publisher).from(entity).publish$();',
      'return this.events.event(new CreatedEvent(id)).publish$();',
    ]) {
      expect(classifyPattern(handler(`execute() { ${publication} }`)), publication).toBe('B');
    }
  });

  it('keeps orchestrator priority and the legacy publisher flow', () => {
    expect(classifyPattern(handler('constructor(events: EventDispatcher) {} execute() { new CreateUseCase.UseCase(repo); }'))).toBe('C');
    expect(classifyPattern(handler('constructor(publisher: EventPublisher) {}'))).toBe('B');
    expect(classifyPattern(handler('execute() { entity.commit(); }'))).toBe('B');
  });

  it('ignores comments and string literals describing dispatcher flows', () => {
    expect(classifyPattern(handler(`execute() {
      // EventDispatcher; this.events.from(entity).publish();
      const example = "dispatch(publisher).event(new CreatedEvent(id)).publish$()";
      /* this.events.event(event).publish(); */
    }`))).toBeNull();
    expect(classifyPattern(handler('execute() { return this.repo.findById(id); }', 'QueryHandler'))).toBeNull();
  });

  it('does not combine an unrelated event call and later publication', () => {
    expect(classifyPattern(handler('execute() { logger.event(data); metrics.publish(); }'))).toBeNull();
  });
});
