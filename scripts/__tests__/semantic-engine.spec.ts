import './helpers/no-network.ts';
import { assertNetworkForbidden } from './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { readRulebookFile } from '../lib/compose.ts';
import type { JevAnswer, JevAskResult, JevClient, JevRequest } from '../lib/jev-client.ts';
import { planSemanticRequests, runSemanticRules, splitByBudget, type PlannedRequest } from '../lib/semantic-engine.ts';
import type { SourceFile } from '../lib/static-engine.ts';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const { rulebook } = readRulebookFile(join(PLUGIN_ROOT, 'rulebooks', 'hexagonal.rulebook.yaml'));
const rules = rulebook.rules;

const handlerFile: SourceFile = {
  path: 'src/orders/application/commands/cancel-order.handler.ts',
  content: `@CommandHandler(CancelOrderCommand)\nexport class CancelOrderHandler {\n  async execute(command: CancelOrderCommand): Promise<void> {\n    const order = await this.repository.findById(command.orderId);\n    if (!order) {\n      throw new OrderNotFoundError(command.orderId);\n    }\n    order.cancel(command.reason);\n    await this.repository.save(order);\n  }\n}\n`,
};

const portFile: SourceFile = {
  path: 'src/orders/application/ports/payment-gateway.port.ts',
  content: `export interface PaymentGatewayPort {\n  charge(orderId: string, amount: number): Promise<{ transactionId: string }>;\n}\nexport const PAYMENT_GATEWAY_PORT = Symbol('PaymentGatewayPort');\n`,
};

interface FakeClient extends JevClient {
  requests: JevRequest[];
  decisions: Array<Record<string, string> | undefined>;
}

function fakeClient(answer: (key: string) => JevAnswer, extra: Partial<Extract<JevAskResult, { ok: true }>> = {}): FakeClient {
  const requests: JevRequest[] = [];
  const decisions: FakeClient['decisions'] = [];
  return {
    requests,
    decisions,
    ask(request, hooks) {
      requests.push(request);
      const answers: Record<string, JevAnswer> = {};
      for (const key of Object.keys(request.questions)) {
        answers[key] = answer(key);
      }
      const result: JevAskResult = {
        ok: true,
        answers,
        model: 'jev-1.13.0',
        usage: { inputTokens: 100, outputTokens: 2 },
        latencyMs: 12,
        cached: false,
        uncalibrated: false,
        ...extra,
      };
      decisions.push(hooks?.onResult?.(result, request));
      return Promise.resolve(result);
    },
  };
}

const noneChoice: JevAnswer = { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9, other: 0.1 } };

function noulFor(p: number): (key: string) => JevAnswer {
  return (key) => (key === 'hex/no-overengineering' ? noneChoice : { type: 'noul', noul: p });
}

function failingClient(): JevClient {
  return {
    ask: () => Promise.resolve({ ok: false, error: 'rate-limited', status: 429, detail: 'HTTP 429 after 3 retries' }),
  };
}

describe('planSemanticRequests', () => {
  it('groups the semantic rules in scope of a file by slice and keys questions by rule id', () => {
    const plan = planSemanticRequests(rules, [handlerFile, portFile]);
    const handlerRequests = plan.requests.filter((request) => request.path === handlerFile.path);
    expect(handlerRequests.map((request) => request.slice).sort()).toEqual(['declaration', 'file']);
    const declaration = handlerRequests.find((request) => request.slice === 'declaration');
    expect(Object.keys(declaration?.questions ?? {})).toEqual(['hex/handler-no-business-rules']);
    const file = handlerRequests.find((request) => request.slice === 'file');
    expect(Object.keys(file?.questions ?? {})).toEqual(['hex/no-overengineering']);
    expect(file?.questions['hex/no-overengineering']?.type).toBe('choice');
    expect(plan.applied[handlerFile.path]).toEqual(['hex/handler-no-business-rules', 'hex/no-overengineering']);
    const port = plan.requests.find((request) => request.path === portFile.path);
    expect(port?.state).toMatchObject({ path: portFile.path, layer: 'application', slice: 'file', code: portFile.content });
    expect(port?.state.preamble).toContain('port (interface plus Symbol token)');
  });

  it('keeps the code out of the questions', () => {
    const plan = planSemanticRequests(rules, [handlerFile]);
    for (const request of plan.requests) {
      for (const question of Object.values(request.questions)) {
        expect(question.instructions).not.toContain('CancelOrderHandler');
      }
    }
  });

  it('splits a request whose questions overflow the 64k budget', () => {
    const questions: PlannedRequest['questions'] = {};
    for (let i = 0; i < 6; i += 1) {
      questions[`hex/q${i}`] = { type: 'noul', instructions: 'y'.repeat(60_000) };
    }
    const request: PlannedRequest = {
      path: 'a.ts',
      slice: 'file',
      state: { preamble: '', path: 'a.ts', layer: 'any', slice: 'file', code: 'x' },
      startLine: 1,
      truncated: false,
      rules: [],
      questions,
    };
    const batches = splitByBudget(request);
    expect(batches.length).toBe(2);
    expect(Object.keys(batches[0]?.questions ?? {})).toHaveLength(4);
    expect(batches.flatMap((batch) => Object.keys(batch.questions))).toEqual(Object.keys(questions));
  });
});

describe('runSemanticRules', () => {
  it('sends one request per file and slice group, decides per rule and fills the log decision', async () => {
    const client = fakeClient(noulFor(0.8));
    const result = await runSemanticRules(rules, [handlerFile], { client, fitted: null, uncalibrated: false });
    expect(result.requests).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'hex/handler-no-business-rules',
      severity: 'FAIL',
      path: handlerFile.path,
      line: 1,
      class: 'semantic',
      decision: 'advise',
      calibrated: false,
      evidence: 'jev noul=0.80 decision=advise',
    });
    expect(client.decisions.flatMap((decision) => Object.entries(decision ?? {}))).toEqual(
      expect.arrayContaining([
        ['hex/handler-no-business-rules', 'advise'],
        ['hex/no-overengineering', 'pass'],
      ]),
    );
    assertNetworkForbidden();
  });

  it('uses fitted thresholds when present and reports deny as calibrated', async () => {
    const client = fakeClient(noulFor(0.97));
    const fitted = { pin: 'jev-1.13.0', generatedAt: 'now', rules: { 'hex/port-no-infra-leak': { deny: 0.9, ask: 0.75, advise: 0.55, uncertain: { lo: 0.35, hi: 0.65 } } } };
    const result = await runSemanticRules(rules, [portFile], { client, fitted, uncalibrated: false });
    expect(result.findings).toEqual([expect.objectContaining({ ruleId: 'hex/port-no-infra-leak', decision: 'deny', calibrated: true })]);
  });

  it('turns every outcome into uncalibrated when the model does not match the pin or the rulebook is mismatched', async () => {
    const mismatch = fakeClient(noulFor(0.99), { model: 'jev-2.0.0', uncalibrated: true });
    const fitted = { pin: 'jev-1.13.0', generatedAt: 'now', rules: { 'hex/port-no-infra-leak': { deny: 0.9, advise: 0.55 } } };
    const viaModel = await runSemanticRules(rules, [portFile], { client: mismatch, fitted, uncalibrated: false });
    expect(viaModel.findings[0]?.decision).toBe('uncalibrated');
    const viaRulebook = await runSemanticRules(rules, [portFile], { client: fakeClient(noulFor(0.99)), fitted, uncalibrated: true });
    expect(viaRulebook.findings[0]?.decision).toBe('uncalibrated');
  });

  it('fails open with a warning when the client errors', async () => {
    const result = await runSemanticRules(rules, [portFile], { client: failingClient(), fitted: null, uncalibrated: false });
    expect(result.findings).toEqual([]);
    expect(result.warnings).toEqual([`${portFile.path}: jev rate-limited 429 (HTTP 429 after 3 retries); skipped hex/port-no-infra-leak, hex/no-overengineering`]);
  });

  it('lists uncertain answers as findings with decision uncertain', async () => {
    const client = fakeClient(noulFor(0.5));
    const result = await runSemanticRules(rules, [portFile], { client, fitted: null, uncalibrated: false });
    expect(result.findings).toEqual([expect.objectContaining({ decision: 'uncertain', evidence: 'jev noul=0.50 decision=uncertain' })]);
  });
});

describe('runSemanticRules with answers of the wrong primitive', () => {
  it('skips the rule with a warning instead of throwing, and keeps the other answers', async () => {
    const client = fakeClient((key) => (key === 'hex/no-overengineering' ? { type: 'noul', noul: 0.9 } : { type: 'noul', noul: 0.8 }));
    const result = await runSemanticRules(rules, [handlerFile], { client, fitted: null, uncalibrated: false });
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(['hex/handler-no-business-rules']);
    expect(result.warnings).toEqual([`${handlerFile.path}: jev answered noul for hex/no-overengineering (expected choice); skipped`]);
    expect(result.undecided).toEqual([{ path: handlerFile.path, ruleIds: ['hex/no-overengineering'], reason: 'invalid-response' }]);
    expect(client.decisions.flatMap((decision) => Object.keys(decision ?? {}))).not.toContain('hex/no-overengineering');
  });

  it('lists the rules of a failed batch as undecided', async () => {
    const result = await runSemanticRules(rules, [portFile], { client: failingClient(), fitted: null, uncalibrated: false });
    expect(result.undecided).toEqual([{ path: portFile.path, ruleIds: ['hex/port-no-infra-leak', 'hex/no-overengineering'], reason: 'rate-limited' }]);
  });
});
