import { AstNode, SystemType } from "../ast.ts";
import { Node2D } from "../render.ts";
import { Signal } from "@preact/signals";

import lambdacalc from "./lambdacalc.ts";
import deltanets from "./deltanets.ts";

// Export all methods
export const METHODS: Record<string, Method<any, any>> = {
  deltanets,
  lambdacalc,
};

// Method type
export type Method<Elem, Data> = {
  name: string;
  init: (ast: AstNode, systemType: SystemType, relativeLevel: boolean) => MethodState<Elem, Data>;
  render: (
    state: Signal<MethodState<Elem, Data>>,
    expression: Signal<string>,
    systemType: SystemType,
    relativeLevel: boolean,
  ) => Node2D;
  state: Signal<MethodState<Elem, Data> | null>;
};

// Method state type
export type MethodState<Elem, Data> = {
  reset?: () => void;
  back?: () => void;
  forward?: () => void;
  forwardParallel?: () => void;
  last?: () => void;
  idx: number; // Current stack position shown
  stack: Elem[]; // A stack of ASTs or Graphs so we can go back to previous states
  data: Data;
};
