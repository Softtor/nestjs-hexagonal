/** Plugin option first (`userConfig`), then the shell variable; an empty string counts as absent. */
export function apiKey(env: Record<string, string | undefined>): string | undefined {
  for (const value of [env.CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY, env.TYPESAFE_API_KEY]) {
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return undefined;
}
