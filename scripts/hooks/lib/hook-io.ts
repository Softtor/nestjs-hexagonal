import { z } from 'zod';

/**
 * Stdin contract of the Claude Code hook events this plugin subscribes to
 * (hooks.md, "Common input fields" plus the per-event tables). Unknown
 * fields are kept so a newer Claude Code never breaks parsing.
 */
export const HookInputSchema = z
  .object({
    hook_event_name: z.string(),
    session_id: z.string().default('unknown'),
    cwd: z.string().optional(),
    transcript_path: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.json().optional(),
    tool_response: z.json().optional(),
    tool_use_id: z.string().optional(),
    agent_id: z.string().optional(),
    agent_type: z.string().optional(),
    stop_hook_active: z.boolean().optional(),
    last_assistant_message: z.string().optional(),
  })
  .loose();

export type HookInput = z.infer<typeof HookInputSchema>;

export type ParsedHookInput = { ok: true; input: HookInput } | { ok: false; error: string };

export function parseHookInput(raw: string): ParsedHookInput {
  if (raw.trim() === '') {
    return { ok: false, error: 'empty stdin' };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `stdin is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = HookInputSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `stdin does not match the hook input contract: ${parsed.error.issues.map((issue) => issue.message).join('; ')}` };
  }
  return { ok: true, input: parsed.data };
}

const WriteInputSchema = z.object({ file_path: z.string().min(1), content: z.string() }).loose();
const EditInputSchema = z
  .object({ file_path: z.string().min(1), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().default(false) })
  .loose();
const AgentResponseSchema = z.object({ status: z.string().optional(), agentId: z.string().optional() }).loose();

export type WriteInput = z.infer<typeof WriteInputSchema>;
export type EditInput = z.infer<typeof EditInputSchema>;
export type FileToolInput = { tool: 'Write'; input: WriteInput } | { tool: 'Edit'; input: EditInput };

export function fileToolInput(hookInput: HookInput): FileToolInput | null {
  if (hookInput.tool_name === 'Write') {
    const parsed = WriteInputSchema.safeParse(hookInput.tool_input);
    return parsed.success ? { tool: 'Write', input: parsed.data } : null;
  }
  if (hookInput.tool_name === 'Edit') {
    const parsed = EditInputSchema.safeParse(hookInput.tool_input);
    return parsed.success ? { tool: 'Edit', input: parsed.data } : null;
  }
  return null;
}

export function agentToolResponse(hookInput: HookInput): { status: string | undefined; agentId: string | undefined } | null {
  if (hookInput.tool_name !== 'Agent') {
    return null;
  }
  const parsed = AgentResponseSchema.safeParse(hookInput.tool_response);
  return parsed.success ? { status: parsed.data.status, agentId: parsed.data.agentId } : null;
}

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PreToolUseOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision?: PermissionDecision;
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
}

export interface ContextOutput {
  hookSpecificOutput: { hookEventName: 'PostToolUse' | 'SubagentStart' | 'SubagentStop'; additionalContext: string };
}

export interface BlockOutput {
  decision: 'block';
  reason: string;
}

export interface SystemMessageOutput {
  systemMessage: string;
}

export type HookOutput = PreToolUseOutput | ContextOutput | BlockOutput | SystemMessageOutput;

export function denyOutput(reason: string): PreToolUseOutput {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}

/** Advisory PreToolUse output: no permission decision, so the normal permission flow still applies. */
export function preToolUseContextOutput(additionalContext: string): PreToolUseOutput {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext } };
}

export function contextOutput(hookEventName: ContextOutput['hookSpecificOutput']['hookEventName'], additionalContext: string): ContextOutput {
  return { hookSpecificOutput: { hookEventName, additionalContext } };
}

export function blockOutput(reason: string): BlockOutput {
  return { decision: 'block', reason };
}

export function systemMessageOutput(systemMessage: string): SystemMessageOutput {
  return { systemMessage };
}

/**
 * Strings that must never reach stdout, stderr or the JSONL log: the API key
 * values and the raw bodies handed to the hook (file contents, replacements).
 * Bodies shorter than the evidence cap are not tracked because a finding's
 * evidence line legitimately quotes up to 160 characters of the file.
 */
export interface ForbiddenOutput {
  secrets: string[];
  bodies: string[];
}

export const BODY_LEAK_MIN_LENGTH = 200;

export function secretsFromEnv(env: Record<string, string | undefined>): string[] {
  return [env.CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY, env.TYPESAFE_API_KEY].filter((value): value is string => value !== undefined && value !== '');
}

export function forbiddenOutput(env: Record<string, string | undefined>, bodies: Array<string | undefined>): ForbiddenOutput {
  return {
    secrets: secretsFromEnv(env),
    bodies: bodies.filter((body): body is string => body !== undefined && body.length >= BODY_LEAK_MIN_LENGTH),
  };
}

export type LeakKind = 'secret' | 'body';

function escapedForms(value: string): string[] {
  const escaped = JSON.stringify(value).slice(1, -1);
  return escaped === value ? [value] : [value, escaped];
}

/** Checks the raw value and its JSON-escaped form, because the output is serialized JSON. */
export function findLeak(text: string, forbidden: ForbiddenOutput): LeakKind | null {
  for (const secret of forbidden.secrets) {
    if (escapedForms(secret).some((form) => text.includes(form))) {
      return 'secret';
    }
  }
  for (const body of forbidden.bodies) {
    if (escapedForms(body).some((form) => text.includes(form))) {
      return 'body';
    }
  }
  return null;
}

export function serializeOutput(output: HookOutput): string {
  return `${JSON.stringify(output)}\n`;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
