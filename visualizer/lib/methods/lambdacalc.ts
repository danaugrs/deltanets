import { batch, Signal, signal } from "@preact/signals";
import {
  AstNode,
  astToString,
  boundVars,
  clone,
  freeVars,
  replace,
  substitute,
  SystemType,
} from "../ast.ts";
import * as d3 from "d3";
import { Edge, Enclosure, Label, Node2D, Pos } from "../render.ts";
import { Method, MethodState } from "./index.ts";
import { prettifyExpr } from "../util.ts";

// Lambda calculus (naive copying)
// When an abstraction is applied, the argument is copied N times, where N is
// the number of times the function's bound variable is used inside its body.
const method: Method<AstNode> = {
  // The original lambda calculus introduced by Church was the 'relevant' lambda calculus which doesn't allow for weakening/erasure. This is why I add the '+' below to indicate that the lambda calculus started at 1936 but was extended afterwards.
  name: "λ-Calculus (1936+)",
  state: signal(null),
  init,
  render,
};
export default method;

// The naive method's state is just a stack of ASTs.
type State = MethodState<AstNode>;

// Initialize the state by copying the initial AST.
// Ignores configuration options - they are hidden in the UI.
function init(ast: AstNode, systemType: SystemType, relativeLevel: boolean): State {
  return { idx: 0, stack: [clone(ast)] };
}

// Render the AST as a tree but with enclosures around abstractions.
// These enclosures connect each abstraction with all of its bound variables.
// Reduction callbacks update the internal AST.
function render(
  state: Signal<State>,
  expression: Signal<string>,
  systemType: SystemType,
  relativeLevel: boolean,
): Node2D {
  const currState = state.peek()!;
  const tree = renderAstNode(state, expression, currState.stack[currState.idx]);

  // If forward is undefined, set it to reduce the next redex in normal-order
  if (currState.forward === undefined && tree.redexes.length > 0) {
    currState.forward = tree.redexes[0];
  }

  return tree.node2D;
}

const DX = 25;
const DY = 40;

function renderAstNode(
  state: Signal<State>,
  expression: Signal<string>,
  astNode: AstNode,
  pos: Pos = { x: 0, y: 0 },
  // RedexCount is used internally to assign a unique class to each redex so we can highlight them.
  redexCount = { rc: 0 },
): {
  node2D: Label;
  vars: Label[];
  redexes: (() => void)[];
} {
  // Create a label and initialize its position
  const node2D = new Label();
  node2D.pos = pos;

  // Store the node2D in the astNode for later use (highlights)
  astNode.extra = { node2D };

  // Initialize the variables list
  let vars: Label[] = [];

  // Initialize the redexes list
  let redexes: (() => void)[] = [];

  // If the astNode is an abstraction
  if (astNode.type === "abs") {
    // Update the label with the name of the abstraction
    node2D.text.value = "λ" + astNode.name;

    // Render the body of the abstraction
    const body = renderAstNode(
      state,
      expression,
      astNode.body,
      { x: 0, y: DY },
      redexCount,
    );
    node2D.add(body.node2D);

    // Create and add edge to body
    node2D.add(new Edge({ x: 0, y: 0 }, { x: 0, y: DY }));

    // Split the variables that are inside this abstraction into those that are bound
    // by this abstraction and those that are free
    const [boundVars, freeVars] = body.vars.reduce(
      ([b, f]: [Label[], Label[]], v) =>
        v.text.value === astNode.name ? [[...b, v], f] : [b, [...f, v]],
      [[], []],
    );

    // Update bounds
    node2D.bounds = {
      min: {
        x: body.node2D.bounds.min.x - DX / 2,
        y: 0,
      },
      max: {
        x: body.node2D.bounds.max.x + DX / 2,
        y: body.node2D.bounds.max.y + DY + DX / 2,
      },
    };

    // Create and add enclosure
    node2D.add(new Enclosure(structuredClone(node2D.bounds), boundVars));

    // Add some padding
    node2D.bounds.min.y -= DX;
    node2D.bounds.max.y += DX / 2;
    node2D.bounds.min.x -= DX / 2;
    node2D.bounds.max.x += DX / 2;

    // Only propagate free variables up
    vars = freeVars;

    // Aggregate redexes
    redexes = body.redexes;
  } // If the astNode is an application
  else if (astNode.type === "app") {
    // Update the label with the application symbol
    node2D.text.value = "@";

    // Render the function and the argument of the application
    const func = renderAstNode(
      state,
      expression,
      astNode.func,
      { x: 0, y: DY },
      redexCount,
    );
    const arg = renderAstNode(
      state,
      expression,
      astNode.arg,
      { x: 0, y: DY },
      redexCount,
    );

    const spread = (func.node2D.bounds.max.x - arg.node2D.bounds.min.x) / 2;
    node2D.bounds.min.x = func.node2D.bounds.min.x - spread;
    node2D.bounds.min.y = -DX;
    node2D.bounds.max.x = spread + arg.node2D.bounds.max.x;
    node2D.bounds.max.y =
      Math.max(func.node2D.bounds.max.y, arg.node2D.bounds.max.y) + DY;

    func.node2D.pos.x = -spread;
    arg.node2D.pos.x = spread;

    node2D.add(func.node2D);
    node2D.add(arg.node2D);

    // Aggregate variables
    vars = [...func.vars, ...arg.vars];

    const funcAstNode = astNode.func;
    const argAstNode = astNode.arg;
    const isFuncAbs = funcAstNode.type === "abs";
    const bVars = isFuncAbs
      ? boundVars(funcAstNode.body, funcAstNode.name)
      : [];

    // If this application is applying an abstraction
    // highlight the edge and trigger beta-reduction when the edge is clicked
    const onClick = isFuncAbs
      ? () => {
        // Deep clone current ast and insert it into the stack below the
        // curent ast, and delete all asts after the current one
        const currState = state.peek()!;
        const astClone = clone(currState.stack[currState.idx]);
        currState.stack = currState.stack.slice(0, currState.idx + 1);
        currState.stack.splice(currState.idx, 0, astClone);
        currState.idx = currState.idx + 1;
        currState.forward = undefined;
        currState.forwardParallel = undefined;

        // Function to go forward to the next state
        const forward = () => {
          const currState = state.peek()!;
          // Move forward one step
          currState.idx = currState.idx + 1;
          // Update other functions
          if (currState.stack.length - 1 === currState.idx) {
            currState.forward = undefined;
            currState.forwardParallel = undefined;
            currState.last = undefined;
          }
          currState.back = back;
          currState.reset = reset;
          // Trigger state update
          batch(() => {
            state.value = { ...currState };
            expression.value = prettifyExpr(
              astToString(currState.stack[currState.idx]),
            );
          });
        };

        // Function to go back to the previous state
        const back = () => {
          const currState = state.peek()!;
          // Move back one step
          currState.idx = currState.idx - 1;
          // Update other functions
          if (currState.idx === 0) {
            currState.back = undefined;
            currState.reset = undefined;
          }
          currState.forward = forward;
          currState.last = last;
          // Trigger state update
          batch(() => {
            state.value = { ...currState };
            expression.value = prettifyExpr(
              astToString(currState.stack[currState.idx]),
            );
          });
        };

        // Function to reset to the initial state
        const reset = () => {
          const currState = state.peek()!;
          // Move back all the way to the beginning
          currState.idx = 0;
          // Update other functions
          currState.back = undefined;
          currState.reset = undefined;
          currState.forward = forward;
          currState.last = last;
          // Trigger state update
          batch(() => {
            state.value = { ...currState };
            expression.value = prettifyExpr(
              astToString(currState.stack[currState.idx]),
            );
          });
        };

        // Function to go to the last state
        const last = () => {
          const currState = state.peek()!;
          // Move forward all the way to the end
          currState.idx = currState.stack.length - 1;
          // Update other functions
          currState.forward = undefined;
          currState.forwardParallel = undefined;
          currState.last = undefined;
          currState.back = back;
          currState.reset = reset;
          // Trigger state update
          batch(() => {
            state.value = { ...currState };
            expression.value = prettifyExpr(
              astToString(currState.stack[currState.idx]),
            );
          });
        };

        // Update functions that are also set to defined values inside `forward` defined above, assuming that `currState.stack.length - 1 === currState.idx`
        currState.back = back;
        currState.reset = reset;

        // Perform beta reduction i.e. substitute occurrances of the variable in the function body by the argument
        const result = substitute(
          funcAstNode.body,
          funcAstNode.name,
          argAstNode,
          freeVars(argAstNode),
        );
        // Substite application by the function body
        const isRoot = replace(astNode, result);
        if (isRoot) {
          // Substitute the current AST with the function body
          currState.stack.splice(currState.idx, 1, result);
        }
        // Trigger state and expression update
        batch(() => {
          state.value = { ...currState };
          expression.value = prettifyExpr(
            astToString(currState.stack[currState.idx]),
          );
        });
      }
      : undefined;

    // Create left edge
    const edge = new Edge(
      { x: 0, y: 0 },
      { x: -spread, y: DY },
      "sw",
      "n",
      onClick,
    );

    // Add the same class to the edge and all bound variables so we can
    // highlight the variables when hovering over the edge
    if (isFuncAbs) {
      redexCount.rc += 1;
      const redexId = redexCount.rc.toString();
      bVars.forEach(
        (
          b,
        ) => (b.extra.node2D.highlightRect.attrs.class = "redex-var-" +
          redexId),
      );
      edge.highlightPath.attrs.class = "redex-edge-" + redexId;
      edge.highlightPath.eventHandlers = {
        ...edge.highlightPath.eventHandlers,
        mouseover: function () {
          d3.select(this as any)
            .attr("stroke-width", "40px")
            .attr("cursor", "pointer");
          d3.selectAll(".redex-var-" + redexId).attr("display", null);
        },
        mouseout: function () {
          d3.select(this as any).attr("stroke-width", "36px");
          d3.selectAll(".redex-var-" + redexId).attr("display", "none");
        },
      };
    }

    // Add left edge
    node2D.add(edge);

    // Create and add right edge
    node2D.add(new Edge({ x: 0, y: 0 }, { x: spread, y: DY }, "se", "n"));

    // Aggregate redexes
    redexes = [...(onClick ? [onClick] : []), ...func.redexes, ...arg.redexes];
  } // If the astNode is a variable
  else if (astNode.type === "var") {
    // Update the label with the name of the variable
    node2D.text.value = astNode.name;

    // Update bounds
    node2D.bounds = { min: { x: -DX, y: -DX }, max: { x: DX, y: DX } };

    // Update the variables list
    vars = [node2D];
  }

  return { node2D, vars, redexes };
}
