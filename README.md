# site-generator-speed — a faster drop-in for makefun-site 1.0.0

`run(input)` in `solve.js` returns exactly what makefun-site 1.0.0's `build`
returns for a case's input — the output tree as a JSON object of every path
and its file text, byte for byte — only faster. `main.ts` is the program the
harness runs: it reads every case from `/input/cases.json`, answers each one
alone with `run`, and writes `/output/answers.json`.

## How it is faster

- Templates are compiled once per case into plain JS functions (a `for` loop's
  element and `loop` become locals; any other name is read from the scope
  chain), instead of walking a node tree on every render.
- Markdown is rendered straight into a string array — no token objects — with
  one regex pass that handles both the escape table and the inline constructs,
  and blocks dispatched on their first character.
- `slugify` and the long date are memoised per run (titles, tags and headings
  repeat a lot); word counting allocates nothing; link resolution is cached
  per source directory.

On the kit's practice set (3 cases, 257–486 files each) this runs in ~150 ms
per set on this machine, against ~530–610 ms for makefun-site itself behind
the same driver — about 3.5× faster — with byte-identical answers on all
3 cases, verified against `practice/reference/expected.json`.

## Layout

- `solve.js` — the entry: a dependency-free ES module exporting `run(input)`.
- `main.ts` — the harness driver (reads `/input/cases.json`, writes
  `/output/answers.json`).

Node 22, no dependencies, nothing installed, no network, deterministic: two
runs on the same set produce byte-identical output.
