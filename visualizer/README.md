# Delta-Nets and λ-Calculi Interactive Visualizer

This project visualizes Δ-nets and λ-calculi expressions.

### Usage

Start the project:

```
deno task start
```

This will watch the project directory and restart as necessary.

### About the λ-calculi parser

The λ-calculi parser in [`lib/parser.gen.ts`](lib/parser.gen.ts) was generated using [tsPEG](https://www.npmjs.com/package/tspeg) (3.3.1) based on the grammar in [`lib/lambda.grammar`](lib/lambda.grammar).

```
npm install -g tspeg
tspeg lib/lambda.grammar lib/parser.gen.ts
```
