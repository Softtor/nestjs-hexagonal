#!/bin/sh
# Entry point for the nestjs-hexagonal-check CLI and for the plugin hooks.
# Pure shell until the gate decides that a runtime is needed.
#
#   run.sh --hook <name> [args]   hook mode: opt-in gate, path containment,
#                                 then check.ts --hook <name> with stdin forwarded
#   run.sh [args]                 CLI mode: forwards to check.ts

set -u

resolve_link() {
  target=$1
  while [ -L "$target" ]; do
    link=$(readlink "$target") || break
    case $link in
      /*) target=$link ;;
      *) target=$(dirname "$target")/$link ;;
    esac
  done
  printf '%s' "$target"
}

real_dir() {
  (cd "$1" 2>/dev/null && pwd -P)
}

real_path() {
  resolved=$(resolve_link "$1")
  dir=$(real_dir "$(dirname "$resolved")") || return 1
  printf '%s/%s' "$dir" "$(basename "$resolved")"
}

self_script=$(real_path "$0")
self_root=$(real_dir "$(dirname "$self_script")/..")

hook_mode=0
if [ "${1:-}" = "--hook" ]; then
  hook_mode=1
fi

if [ "${NESTJS_HEXAGONAL_DISABLE:-}" = "1" ]; then
  if [ "$hook_mode" -eq 0 ]; then
    echo "nestjs-hexagonal-check: NESTJS_HEXAGONAL_DISABLE=1, nothing to do" >&2
  fi
  exit 0
fi

project_dir=${CLAUDE_PROJECT_DIR:-$(pwd)}
input=""

if [ "$hook_mode" -eq 1 ]; then
  rulebook_env=${NESTJS_HEXAGONAL_RULEBOOK:-}
  if [ -n "$rulebook_env" ]; then
    case $rulebook_env in
      /*) rulebook_path=$rulebook_env ;;
      *) rulebook_path="$project_dir/$rulebook_env" ;;
    esac
  else
    rulebook_path=""
  fi
  if [ ! -f "$project_dir/.claude/rulebook.yaml" ] && { [ -z "$rulebook_path" ] || [ ! -f "$rulebook_path" ]; }; then
    exit 0
  fi

  input=$(cat)
  file_path=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  if [ -n "$file_path" ]; then
    case $file_path in
      /*) ;;
      *) file_path="$project_dir/$file_path" ;;
    esac
    probe=$(dirname "$file_path")
    while [ ! -d "$probe" ] && [ "$probe" != "/" ] && [ "$probe" != "." ]; do
      probe=$(dirname "$probe")
    done
    probe_real=$(real_dir "$probe") || exit 0
    project_real=$(real_dir "$project_dir") || exit 0
    case "$probe_real/" in
      "$project_real/"*) ;;
      *) exit 0 ;;
    esac
  fi
fi

project_bin="$project_dir/node_modules/.bin/nestjs-hexagonal-check"
if [ -x "$project_bin" ] && [ "$(real_path "$project_bin")" != "$self_script" ]; then
  export NESTJS_HEXAGONAL_BINARY_SOURCE=node_modules
  if [ "$hook_mode" -eq 1 ]; then
    printf '%s' "$input" | "$project_bin" "$@"
    exit $?
  fi
  exec "$project_bin" "$@"
fi

export NESTJS_HEXAGONAL_BINARY_SOURCE=plugin-root
check_script="$self_root/scripts/check.ts"

deps_found=0
probe_dir=$self_root
while :; do
  if [ -d "$probe_dir/node_modules/zod" ] && [ -d "$probe_dir/node_modules/yaml" ]; then
    deps_found=1
    break
  fi
  parent=$(dirname "$probe_dir")
  if [ "$parent" = "$probe_dir" ]; then
    break
  fi
  probe_dir=$parent
done

if [ "$deps_found" -eq 0 ]; then
  echo "nestjs-hexagonal-check: dependencies missing in $self_root (zod, yaml not found in any parent node_modules); run 'bun install' in $self_root or in the project that installed it (skipping)" >&2
  if [ "$hook_mode" -eq 1 ]; then
    exit 0
  fi
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  set -- bun "$check_script" "$@"
elif command -v node >/dev/null 2>&1; then
  set -- node --experimental-strip-types --no-warnings "$check_script" "$@"
else
  echo "nestjs-hexagonal-check: neither bun nor node found on PATH (skipping)" >&2
  if [ "$hook_mode" -eq 1 ]; then
    exit 0
  fi
  exit 1
fi

if [ "$hook_mode" -eq 1 ]; then
  printf '%s' "$input" | "$@"
  exit $?
fi
exec "$@"
