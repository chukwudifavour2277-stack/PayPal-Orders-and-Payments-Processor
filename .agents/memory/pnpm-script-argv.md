---
name: pnpm script argument forwarding
description: A workspace-script CLI quirk when forwarding arguments through pnpm.
---

When invoking a package script with `pnpm --filter <package> <script> -- <args>`, the script may receive the standalone `--` in `process.argv`. CLI parsers should ignore one leading separator.

**Why:** In this workspace, the documented `-- --help` invocation initially failed because the parser treated the forwarded separator as an option missing its value.

**How to apply:** Keep standalone script CLIs tolerant of an optional leading `--` when users forward arguments through pnpm.
