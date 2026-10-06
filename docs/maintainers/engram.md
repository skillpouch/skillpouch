# Engram code graph

`.engram/graph.json` and `.engram/GRAPH_REPORT.md` are a knowledge graph of
this repository (modules, functions, imports, communities) for maintainers
and coding agents. Only these two portable files are committed — never
branch, worktree or cache state (`.engram/.gitignore`).

- Read: open `GRAPH_REPORT.md` (god nodes, communities), or query with
  `engram query "<question>" --graph .engram/graph.json`,
  `engram explain <node>`, `engram path <a> <b>`.
- Refresh after a milestone: `pnpm engram` (code-only rebuild, no LLM), then
  commit the two files. Engram never blocks backend work or CI.
