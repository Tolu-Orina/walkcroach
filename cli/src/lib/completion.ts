/**
 * Shell completions (C5.3).
 *
 * Generated from the live Commander tree rather than hand-written, so a
 * completion script cannot describe a command that no longer exists. The
 * golden surface test already pins that tree, which makes this correct by
 * construction: adding a flag updates the completions in the same commit.
 *
 * Static scripts, printed to stdout for the user to source. The alternative —
 * a shell function that shells out to `walkcroach` on every Tab — adds a
 * process launch to every keystroke and a way for a broken install to hang
 * the terminal.
 */
import type { Command } from 'commander';

export type Shell = 'bash' | 'zsh' | 'fish';

export const SHELLS: Shell[] = ['bash', 'zsh', 'fish'];

export function isShell(value: string): value is Shell {
  return (SHELLS as string[]).includes(value);
}

export type CommandNode = {
  name: string;
  description: string;
  options: string[];
  subcommands: CommandNode[];
};

/** Long flags only: nobody completes `-V`, and the noise costs more than it gives. */
function longFlags(cmd: Command): string[] {
  const flags = cmd.options
    .flatMap((o) => o.flags.split(/[ ,|]+/))
    .filter((f) => f.startsWith('--'));
  return [...new Set([...flags, '--help'])].sort();
}

export function describeTree(cmd: Command): CommandNode {
  return {
    name: cmd.name(),
    description: cmd.description(),
    options: longFlags(cmd),
    subcommands: cmd.commands
      .map((c) => describeTree(c as Command))
      .filter((c) => c.name !== 'help')
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Shell-safe single-quoted string. */
function q(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function bash(tree: CommandNode): string {
  const top = tree.subcommands.map((c) => c.name).join(' ');
  const perCommand = tree.subcommands
    .map((c) => {
      const subs = c.subcommands.map((s) => s.name).join(' ');
      const opts = [...new Set([...c.options, ...tree.options])].join(' ');
      return `    ${c.name})\n      opts="${opts}"\n      subs="${subs}"\n      ;;`;
    })
    .join('\n');

  return `# walkcroach bash completion
# Install:  walkcroach completion bash > /etc/bash_completion.d/walkcroach
#     or:   walkcroach completion bash >> ~/.bashrc
_walkcroach_completions() {
  local cur prev cmd opts subs
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"
  opts="${tree.options.join(' ')}"
  subs=""

  if [ "\$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( \$(compgen -W "${top} \${opts}" -- "\${cur}") )
    return 0
  fi

  case "\${cmd}" in
${perCommand}
    *)
      ;;
  esac

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
  else
    COMPREPLY=( \$(compgen -W "\${subs}" -- "\${cur}") )
  fi
  return 0
}
complete -F _walkcroach_completions walkcroach
`;
}

function zsh(tree: CommandNode): string {
  const top = tree.subcommands
    .map((c) => `    ${q(`${c.name}:${c.description.replace(/:/g, ' -')}`)}`)
    .join('\n');

  const perCommand = tree.subcommands
    .map((c) => {
      const opts = [...new Set([...c.options, ...tree.options])]
        .map((o) => q(o))
        .join(' ');
      const subs = c.subcommands.length
        ? `\n        _values 'subcommand' ${c.subcommands
            .map((s) => q(s.name))
            .join(' ')}`
        : '';
      return `      ${c.name})\n        _values 'option' ${opts}${subs}\n        ;;`;
    })
    .join('\n');

  return `#compdef walkcroach
# walkcroach zsh completion
# Install:  walkcroach completion zsh > "\${fpath[1]}/_walkcroach"
_walkcroach() {
  local -a commands
  commands=(
${top}
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "\${words[2]}" in
${perCommand}
      *)
        ;;
  esac
}
compdef _walkcroach walkcroach
`;
}

function fish(tree: CommandNode): string {
  const lines: string[] = [
    '# walkcroach fish completion',
    '# Install:  walkcroach completion fish > ~/.config/fish/completions/walkcroach.fish',
    '',
    'complete -c walkcroach -f',
    '',
  ];

  for (const cmd of tree.subcommands) {
    lines.push(
      `complete -c walkcroach -n __fish_use_subcommand -a ${cmd.name} -d ${q(cmd.description)}`,
    );
    for (const sub of cmd.subcommands) {
      lines.push(
        `complete -c walkcroach -n "__fish_seen_subcommand_from ${cmd.name}" ` +
          `-a ${sub.name} -d ${q(sub.description)}`,
      );
    }
    for (const opt of cmd.options) {
      const long = opt.replace(/^--/, '').replace(/[ <>[\]].*$/, '');
      if (!long) continue;
      lines.push(
        `complete -c walkcroach -n "__fish_seen_subcommand_from ${cmd.name}" -l ${long}`,
      );
    }
  }

  lines.push('');
  for (const opt of tree.options) {
    const long = opt.replace(/^--/, '').replace(/[ <>[\]].*$/, '');
    if (long) lines.push(`complete -c walkcroach -l ${long}`);
  }

  return `${lines.join('\n')}\n`;
}

export function generateCompletion(shell: Shell, program: Command): string {
  const tree = describeTree(program);
  if (shell === 'bash') return bash(tree);
  if (shell === 'zsh') return zsh(tree);
  return fish(tree);
}
