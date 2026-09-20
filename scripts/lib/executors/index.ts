import { registerExecutor } from '../static-engine.ts';
import { noOverengineeringStaticExecutor } from './no-overengineering-static.ts';
import { patternConsistentExecutor } from './pattern-consistent.ts';

export function registerBuiltinExecutors(): void {
  registerExecutor('hex/pattern-consistent', patternConsistentExecutor);
  registerExecutor('hex/no-overengineering-static', noOverengineeringStaticExecutor);
}
