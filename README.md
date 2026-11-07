# Evenkeel

A place to set things down and stop carrying them: capture anything in a line, file it in a tap,
break it into steps, and see what today holds without being nagged about what didn't happen.
Replacing Todoist first; notes and calendar come later. Desktop and Android, at
https://evenkeel.evans.tools (once deployed).

- **[DESIGN.md](DESIGN.md)**: what it is and why (the spec).
- **[CLAUDE.md](CLAUDE.md)**: how the code is put together, for working on it with Claude.
- **[docs/runbook.md](docs/runbook.md)**: running it on NOSTROMO and hosting it on the mini PC.

## Run it

```sh
npm install
npm run dev      # http://localhost:5175 (server on 8789)
npm test
```

Same stack and conventions as foodlab and sideshow: TypeScript, React + Vite, Node + Hono, SQLite.
