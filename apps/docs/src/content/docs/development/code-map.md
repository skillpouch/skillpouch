---
title: Code map
description: The Engram knowledge graph of the repository, for maintainers and coding agents.
---

`.engram/graph.json` and `.engram/GRAPH_REPORT.md` are a knowledge graph of
the repository: modules, functions, imports and the groups they form. Only
these two files are committed, never branch, worktree or cache state.

- **Read it:** open `.engram/GRAPH_REPORT.md` for the most connected parts
  and the groups, or query it:

  ```sh
  engram query "<question>" --graph .engram/graph.json
  engram explain <node>
  engram path <a> <b>
  ```

- **Refresh it** after a milestone with `pnpm engram` (a code-only rebuild),
  then commit the two files. It never blocks other work or CI.
