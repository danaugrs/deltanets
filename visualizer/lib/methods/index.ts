import { AstNode } from "../ast.ts";
import { Node2D } from "../render.ts";
import { Signal } from "@preact/signals";

import lambdacalc from "./lambdacalc.ts";
import deltanets from "./deltanets.ts";

// Method groups
export const METHOD_GROUPS = {
  optimal: "Optimal",
  betaoptimal: "β-Optimal",
  suboptimal: "Suboptimal",
} as const;

// Export all methods
export const METHODS: Record<string, Method<any>> = {
  deltanets,
  lambdacalc,
};

// Method type
export type Method<Elem> = {
  name: string;
  init: (ast: AstNode) => MethodState<Elem>;
  render: (
    state: Signal<MethodState<Elem>>,
    expression: Signal<string>,
  ) => Node2D;
  state: Signal<MethodState<Elem> | null>;
  // Methods without a group are "tests" and are only shown in the dropdown menu when debug mode is enabled
  group?:keyof typeof METHOD_GROUPS;
};

// Method state type
export type MethodState<Elem> = {
  reset?: () => void;
  back?: () => void;
  forward?: () => void;
  forwardParallel?: () => void;
  last?: () => void;
  idx: number; // Current stack position shown
  stack: Elem[]; // A stack of ASTs or Graphs so we can go back to previous states
};
