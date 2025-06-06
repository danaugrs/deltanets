import { ASTKinds, type EXPR, parse, SyntaxErr } from "./parser.gen.ts";
import { fancyNameToName, nameToFancyName } from "./util.ts";

// A `Node` is either an `Abstraction`, an `Application` or a `Variable`.
// TODO: rename to "Expression"
export type AstNode = Abstraction | Application | Variable;

// An abstraction is a parameter name and a body.
export type Abstraction = {
  type: "abs";
  parent?: AstNode;
  name: string;
  body: AstNode;
  extra?: any;
};

// An application of a function to an argument.
export type Application = {
  type: "app";
  parent?: AstNode;
  func: AstNode;
  arg: AstNode;
  extra?: any;
};

// A variable is a node with a name.
export type Variable = {
  type: "var";
  parent?: AstNode;
  name: string;
  extra?: any;
};

export type Definitions = { [name: string]: AstNode };

// Parses a lambda calculi expression into an `AST`.
// Returns an array of `SyntaxErr` instead if there are parsing errors.
export function parseSource(
  source: string,
): { ast?: AstNode | null, errs?: SyntaxErr[] } {
  // Parse using tsPEG
  const rawAst = parse(source);

  // If there are parsing errors, return them
  if (rawAst.errs.length > 0) {
    return { errs: rawAst.errs };
  }

  const definitions: Definitions = {}
  let lastExpr: EXPR | null = null;

  // Loop through statements, storing definitions and the last expression
  // Definitions are expected to only reference previous definitions
  // If a definition is referenced before it is defined, it is assumed to be a free variable
  for (const stmt of rawAst.ast!.statements) {
    if (stmt.stmt.kind === ASTKinds.DEF) {
      definitions[stmt.stmt.identifier.identifier] =
        parseRawExpressionNode(stmt.stmt.value, definitions);
    } else {
      lastExpr = stmt.stmt;
    }
  }

  // Parse the last expression (if any)
  if (lastExpr !== null) {
    return { ast: parseRawExpressionNode(lastExpr, definitions) };
  }

  return { ast: null };
}

// Parses a raw AST node, updating the AST in place.
// Returns the index of the newly inserted node.
function parseRawExpressionNode(rawNode: EXPR, definitions: Definitions, parent?: any): AstNode {
  if (
    rawNode.kind === ASTKinds.APPLICATION
  ) {
    // Application
    const node: Partial<AstNode> = { type: "app", parent };
    node.func = parseRawExpressionNode(rawNode.func, definitions, node);
    node.arg = parseRawExpressionNode(rawNode.arg, definitions, node);
    return node as AstNode;
  } else if (rawNode.kind === ASTKinds.IDENT) {
    // Check if it's a definition
    const definition = definitions[rawNode.identifier];
    if (definition) {
      return clone(definition, parent);
    }
    // Otherwise it's a variable
    return {
      type: "var",
      parent,
      name: nameToFancyName(rawNode.identifier),
    };
  } else if (rawNode.kind === ASTKinds.ABSTRACTION) {
    // Abstraction
    const node: Partial<AstNode> = {
      type: "abs",
      parent,
      name: nameToFancyName(rawNode.parameter.identifier),
    };
    node.body = parseRawExpressionNode(rawNode.body, definitions, node);
    return node as AstNode;
  } else if (rawNode.kind === ASTKinds.GROUP) {
    // Group (simply pass through)
    return parseRawExpressionNode(rawNode.group, definitions, parent);
  } else {
    /*Could be any of (
      astNode.kind === ASTKinds.main_2 ||
      astNode.kind === ASTKinds.term_1 ||
      astNode.kind === ASTKinds.term_3 ||
      astNode.kind === ASTKinds.identifier ||
      astNode.kind === ASTKinds.$EOF
      )*/
    throw `Unreachable (${rawNode})`;
  }
}

// Clones a node and its descendants.
export function clone(astNode: AstNode, parent?: any): AstNode {
  if (astNode.type === "abs") {
    const node: Partial<AstNode> = {
      type: "abs",
      parent,
      name: astNode.name,
    };
    node.body = clone(astNode.body, node);
    return node as AstNode;
  } else if (astNode.type === "app") {
    const node: Partial<AstNode> = {
      type: "app",
      parent,
    };
    node.func = clone(astNode.func, node);
    node.arg = clone(astNode.arg, node);
    return node as AstNode;
  } else {
    return {
      type: "var",
      parent,
      name: astNode.name,
    };
  }
}

// Replaces a node with a new node. Returns true if the node is now the root node.
export const replace = (astNode: AstNode, newNode: AstNode): boolean => {
  if (astNode.parent) {
    if (astNode.parent.type === "abs") {
      astNode.parent.body = newNode;
    } else if (astNode.parent.type === "app") {
      if (astNode.parent.func === astNode) {
        astNode.parent.func = newNode;
      } else {
        astNode.parent.arg = newNode;
      }
    }
  }
  newNode.parent = astNode.parent;
  return !newNode.parent;
};

// Executes a function for each descendant.
export function forEachDescendant(
  astNode: AstNode,
  f: (astNode: AstNode) => boolean, // If true - terminate search under this node
) {
  if (f(astNode)) {
    return;
  }
  if (astNode.type === "abs") {
    forEachDescendant(astNode.body, f);
  } else if (astNode.type === "app") {
    forEachDescendant(astNode.func, f);
    forEachDescendant(astNode.arg, f);
  }
}

// Collect all bound variables with a given name under the provided node.
export function boundVars(astNode: AstNode, name: string): Variable[] {
  const bVars: Variable[] = [];
  forEachDescendant(astNode, (astNode) => {
    if (astNode.type === "var" && astNode.name === name) {
      bVars.push(astNode);
    }
    return false;
  });
  return bVars;
}

// Returns the free variables in an AST.
export const freeVars = (node: AstNode): string[] => {
  const freeVars: string[] = [];
  const visit = (node: AstNode, boundVars: string[] = []) => {
    if (node.type === "abs") {
      visit(node.body, [...boundVars, node.name]);
    } else if (node.type === "app") {
      visit(node.func, boundVars);
      visit(node.arg, boundVars);
    } else if (/* node.type === "var" &&*/ !boundVars.includes(node.name)) {
      freeVars.push(node.name);
    }
  };
  visit(node);
  return freeVars;
};

// Returns whether an abstraction is closed i.e. does not access any bound variables from outside abstractions.
export const isAbstractionClosed = (node: Abstraction): boolean => {
  const freeVarsInBody = new Set(freeVars(node.body));
  return freeVarsInBody.size === 1 && freeVarsInBody.has(node.name);
};

// Substitutes all variables with a given name in an AST with a new node.
export const substitute = (
  tree: AstNode,
  varToSubstitute: string,
  substituteBy: AstNode,
  varsFreeInArg: string[],
  varsBoundInFunc: string[] = [],
): AstNode => {
  if (tree.type === "abs") {
    // If the abstraction's parameter matches the bound variable we're substituting, we don't need to traverse this abstraction as its bound variable will shadow the one we're substituting
    if (tree.name !== varToSubstitute) {
      // If the variable is free in the argument subtree, we need to alpha-convert the abstraction
      if (varsFreeInArg.includes(tree.name)) {
        const oldName = tree.name;
        // We need to alpha-convert the abstraction's variable to a new one that is neither free in the argument subtree, nor free in the function subtree, nor bound in the function subtree up to this point
        tree.name = newVarName(tree.name, [
          ...varsFreeInArg, // if the new variable is free in the argument, by substituing the argument in it would be captured
          ...freeVars(tree.body), // if the new variable is free in the body, it would become bound by this updated abstraction
          ...varsBoundInFunc, // if the new variable is bound in the function, it would become bound by that outer abstraction inside the function subtree
        ]);
        // Alpha-convert the body of the abstraction to use the new variable
        alphaConvert(tree.body, oldName, tree.name);
      }
      // Clone the bound variable set and add the original abstraction's variable to it
      const newVarsBoundInFunc = [...varsBoundInFunc];
      newVarsBoundInFunc.push(tree.name);
      // Traverse the abstraction's body and update the abstraction to point to a potentially new body
      tree.body = substitute(
        tree.body,
        varToSubstitute,
        substituteBy,
        varsFreeInArg,
        newVarsBoundInFunc,
      );
      tree.body.parent = tree;
    }
  } else if (tree.type === "app") {
    // Substitute inside func
    tree.func = substitute(
      tree.func,
      varToSubstitute,
      substituteBy,
      varsFreeInArg,
      varsBoundInFunc,
    );
    tree.func.parent = tree;
    // Substitute inside arg
    tree.arg = substitute(
      tree.arg,
      varToSubstitute,
      substituteBy,
      varsFreeInArg,
      varsBoundInFunc,
    );
    tree.arg.parent = tree;
  } // If the variable is the one we're substituting, we substitute it by a clone of the argument
  else if (tree.type === "var" && tree.name === varToSubstitute) {
    return clone(substituteBy);
  }
  return tree;
};

// Generates a new identifier that does not collide with any of the ones in `vars`.
export const newVarName = (name: string, vars: string[]): string => {
  let i = 1;
  let newName = nameToFancyName(name + i);
  while (vars.includes(newName)) {
    newName = nameToFancyName(name + i);
    i += 1;
  }
  return newName;
};

// Recursively alpha-converts `name` to `newName`.
export const alphaConvert = (node: AstNode, name: string, newName: string) => {
  if (node.type === "abs") {
    if (node.name !== name) {
      alphaConvert(node.body, name, newName);
    }
  } else if (node.type === "app") {
    alphaConvert(node.func, name, newName);
    alphaConvert(node.arg, name, newName);
  } else if (/*node.type === "var" &&*/ node.name === name) {
    node.name = newName;
  }
};

// Renders an AST node as a string.
export const astToString = (astNode: AstNode): string => {
  if (astNode.type === "abs") {
    return (
      "λ" + fancyNameToName(astNode.name) + "." + astToString(astNode.body)
    );
  } else if (astNode.type === "app") {
    let funcString = astToString(astNode.func);
    let argString = astToString(astNode.arg);
    // Add parentheses where necessary
    if (astNode.func.type === "abs" || astNode.func.type === "app") {
      funcString = "(" + funcString + ")";
    }
    if (astNode.arg.type === "app") {
      argString = "(" + argString + ")";
    }
    return funcString + " " + argString;
  } else {
    // astNode.type === "var"
    return fancyNameToName(astNode.name);
  }
};

export type SystemType = "linear" | "affine" | "relevant" | "full";

export const getExpressionType = (astNode: AstNode): SystemType => {
  let sharing = false;
  let erasure = false;

  const visit = (node: AstNode, boundVars: Map<string, number> = new Map()) => {
    if (node.type === "abs") {
      boundVars.set(node.name, 0);
      visit(node.body, boundVars);
      const count = boundVars.get(node.name);
      if (count !== undefined) {
        if (count === 0) {
          erasure = true;
        } else if (count > 1) {
          sharing = true;
        }
      }
    } else if (node.type === "app") {
      visit(node.func, boundVars);
      visit(node.arg, boundVars);
    } else /* if (node.type === "var") */ {
      const count = boundVars.get(node.name);
      if (count !== undefined) {
        const newCount = count + 1;
        boundVars.set(node.name, newCount);
        if (newCount > 1) {
          sharing = true;
        }
      }
    }
  };
  visit(astNode, new Map());

  console.debug(sharing, erasure);
  if (sharing) {
    if (erasure) {
      return "full";
    } else {
      return "relevant";
    }
  } else {
    if (erasure) {
      return "affine";
    } else {
      return "linear";
    }
  }
};
