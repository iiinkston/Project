# Git Rules

Never commit:
- node_modules
- .pnpm
- dist
- build
- release artifacts
- generated binaries

Before every commit:
1. Run git status
2. Run git diff --stat
3. Verify generated folders are ignored
