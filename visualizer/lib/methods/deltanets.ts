import { batch, Signal, signal } from "@preact/signals";
import { AstNode, SystemType } from "../ast.ts";
import {
  D,
  Eraser,
  Fan,
  Label,
  Node2D,
  Replicator,
  Root,
  SUBOPTIMAL_HIGHLIGHT_COLOR,
  Wire,
} from "../render.ts";
import { removeFromArrayIf } from "../util.ts";
import { Method, MethodState } from "./index.ts";

// Δ-Nets (absolute indexes)
const method: Method<Graph, Data> = {
  name: "Δ-Nets (2025)",
  state: signal(null),
  init,
  render,
};
export default method;

type Data = { appliedFinalStep: boolean, isFinalStep: boolean };

type State = MethodState<Graph, Data>;

function init(ast: AstNode, systemType: SystemType, relativeLevel: boolean): State {
  const graph: Graph = [];

  // Build graph
  const rootPort = addAstNodeToGraph(ast, graph, new Map(), 0, relativeLevel);

  // Add root node
  const rootNode: Node = { type: "root", label: "root", ports: [rootPort] };
  graph.push(rootNode);
  link(rootPort, { node: rootNode, port: 0 });

  // If all replicators have exactly one auxiliary port, then remove all replicators below, not just those with zero level delta.
  let removeAllReps: boolean = systemType === "linear" || systemType === "affine";
  graph.forEach((node) => {
    if (node.type.startsWith("rep") && node.ports.length !== 2) {
      removeAllReps = false;
    }
  });

  // Remove replicators with a single aux port that has a zero level delta
  const nodesToRemove: Node[] = [];
  graph.forEach((node) => {
    if (node.type.startsWith("rep") &&
      (removeAllReps === true ||
        (node.ports.length === 2 &&
          node.levelDeltas![0] === 0))
    ) {
      link(node.ports[0], node.ports[1]);
      nodesToRemove.push(node);
    }
  });
  for (const node of nodesToRemove) {
    removeFromArrayIf(graph, (n) => n === node);
  }

  return {
    back: undefined,
    forward: undefined,
    idx: 0,
    stack: [graph],
    data: { appliedFinalStep: false, isFinalStep: false },
  };
}

// Returns the redex that contains the pair of nodes (a, b) if it exists, or undefined otherwise.
function getRedex(a: Node, b: Node, redexes: Redex[]): Redex | undefined {
  for (const redex of redexes) {
    if ((redex.a === a && redex.b === b) || (redex.a === b && redex.b === a)) {
      return redex;
    }
  }
  return undefined;
}

// The type of a redex.
type Redex = { a: Node; b: Node; optimal: boolean; reduce: () => void };

// Returns all the redexes (core interactions and canonicalizations) and the current reduction state.
function getRedexes(graph: Graph, systemType: SystemType, relativeLevel: boolean): Redex[] {
  const redexes: Redex[] = [];

  const createRedex = (a: Node, b: Node, optimal: boolean, reduce: () => void) => {
    // Skip if the redex has already been created
    if (redexes.some((redex) => {
      if ((redex.a === a && redex.b === b) || (redex.a === b && redex.b === a)) {
        if (redex.optimal !== optimal) {
          console.error("Error: mismatching optimality for redex", redex, a, b, optimal, reduce);
        }
        return true;
      }
      return false;
    })) {
      return;
    }
    redexes.push({ a, b, optimal, reduce: () => {
      // Ignore if any of the nodes have been removed
      if (graph.find((n) => n === a) === undefined || graph.find((n) => n === b) === undefined) {
        return;
      }
      reduce();
    }});
  }

  // Linear system
  if (systemType === "linear") {
    // There are only app-abs annihilation pairs and they are always optimal
    for (const node of graph) {
      if (node.ports[0].port === 0) {
        if (node.type === "era") {
          console.error("Error: eraser in linear system", node);
        }
        if (node.type.startsWith("rep")) {
          console.error("Error: rep in linear system", node);
        }
        // Skip pairs with variables or with the root node
        if (node.type === "var" || node.ports[0].node.type === "var" || node.type === "root" || node.ports[0].node.type === "root") {
          continue
        }
        // Check for app-abs annihilation pairs
        if (node.type === "abs" && node.ports[0].node.type !== "app" || node.type === "app" && node.ports[0].node.type !== "abs") {
          console.error("Error: non app-abs annihilation pair in linear system", node, node.ports[0].node);
        }
        createRedex(node, node.ports[0].node, true, () => reduceAnnihilate(node, graph));
      }
    }
  }

  // Affine/Relevant/Full systems
  else /*if (systemType === "affine" || systemType === "relevant" || systemType === "full") */ {
    for (const node of graph) {
      if (systemType === "relevant" && node.type === "era") {
        console.error("Error: eraser in relevant system", node);
      }
      if (node.ports[0].port === 0) {
        // Skip pairs with variables or with the root node
        if (node.type === "var" || node.ports[0].node.type === "var" || node.type === "root" || node.ports[0].node.type === "root") {
          continue
        }
        if (node.type === "era") {
          createRedex(node, node.ports[0].node, false, () => reduceErase(node.ports[0].node, graph));
        } else if (node.ports[0].node.type === "era") {
          createRedex(node, node.ports[0].node, false, () => reduceErase(node, graph));
        } else if (
          node.type === "abs" && node.ports[0].node.type === "app"
        ) {
          createRedex(node, node.ports[0].node, false, () => reduceAnnihilate(node, graph));
        } else if (
          ((node.type.startsWith("rep") && (node.ports[0].node.type === "abs" ||
            node.ports[0].node.type === "app")))
        ) {
          // Fan-Rep commutation
          const rep = node.type.startsWith("rep") ? node : node.ports[0].node;
          const level = parseRepLabel(rep.label!).level;
          createRedex(node, node.ports[0].node, false, () => {
            const { nodeClones } = reduceCommute(rep, graph);
            nodeClones[0].label = formatRepLabel(level, "unknown");
            nodeClones[1].label = formatRepLabel(relativeLevel ? level + 1 :level, "unknown");
            nodeClones[1].type = nodeClones[1].type === "rep-in" ? "rep-out" : "rep-in";
          });
        } else if (
          node.type.startsWith("rep") && node.ports[0].node.type.startsWith("rep")
        ) {
          // Rep-Rep commutation
          const a = node;
          const b = node.ports[0].node;
          const { level: top, status: topFlag } = parseRepLabel(a.label!);
          const { level: bottom, status: bottomFlag } = parseRepLabel(b.label!);
          if (top === bottom) {
            createRedex(a, b, false, () => reduceAnnihilate(b, graph));
          } else {
            createRedex(a, b, false, () => {
              const { nodeClones, otherClones } = reduceCommute(b, graph);
              if (top > bottom) {
                // Need to update the levels of the top replicator copies (otherClones) according to the level deltas of the bottom replicator
                otherClones.forEach((node, i) => {
                  node.label = formatRepLabel(
                    top + b.levelDeltas![i],
                    topFlag,
                  );
                });
              } else {
                // Need to update the levels of the bottom replicator copies (nodeClones) according to the level deltas of the top replicator
                nodeClones.forEach((node, i) => {
                  node.label = formatRepLabel(
                    bottom + a.levelDeltas![i],
                    bottomFlag,
                  );
                });
              }
            });
          }
        }
      } else if (
        node.type.startsWith("rep") &&
        node.ports[0].node.type.startsWith("rep") &&
        parseRepLabel(node.ports[0].node.label!).status === "unpaired"
      ) {
        const firstReplicator = node.ports[0].node;
        const secondReplicator = node;
        const secondReplicatorPort = secondReplicator.ports[0].port;

        // Check if the second replicator is unpaired
        let secondUnpaired =
          parseRepLabel(secondReplicator.label!).status === "unpaired";
        // Get the level delta between the two replicators
        const levelDeltaBetween =
          firstReplicator.levelDeltas![secondReplicatorPort - 1];
        // Check for constraint that helps determine whether the second replicator is unpaired
        if (!secondUnpaired) {
          const { level: firstLevel } = parseRepLabel(firstReplicator.label!);
          const { level: secondLevel } = parseRepLabel(secondReplicator.label!);
          const diff = secondLevel - firstLevel;
          if (0 <= diff && diff <= levelDeltaBetween) {
            secondUnpaired = true;
          }
        }

        if (secondUnpaired) {
          (firstReplicator as any).isToBeMerged = true;
          // Merge the two replicators
          createRedex(firstReplicator, secondReplicator, false, () => {
            // Reset isToBeMerged flag
            (firstReplicator as any).isToBeMerged = false;

            firstReplicator.ports.splice(secondReplicatorPort, 1, ...secondReplicator.ports.slice(1));
            firstReplicator.levelDeltas!.splice(secondReplicatorPort - 1, 1, ...secondReplicator.levelDeltas!.map((ld) => ld + levelDeltaBetween));

            // Reorder ports of firstReplicator according to level deltas

            // Zip aux ports with level deltas
            const portsWithLevelDeltas: { nodePort: NodePort; levelDelta: number }[] = firstReplicator.ports.slice(1).map((nodePort, i) => {
              return { nodePort, levelDelta: firstReplicator.levelDeltas![i] };
            });

            // Sort by level delta
            portsWithLevelDeltas.sort(({ levelDelta: levelDeltaA }, { levelDelta: levelDeltaB }) => {
              return levelDeltaA - levelDeltaB;
            });

            // Unzip aux ports and level deltas
            const auxPorts: NodePort[] = [];
            const levelDeltas: number[] = [];
            portsWithLevelDeltas.forEach(({ nodePort, levelDelta }) => {
              auxPorts.push(nodePort);
              levelDeltas.push(levelDelta);
            });

            // // Assign aux ports to firstReplicator
            firstReplicator.ports = [firstReplicator.ports[0], ...auxPorts];
            firstReplicator.levelDeltas = [...levelDeltas];

            // Link external ports
            firstReplicator.ports.forEach((p, i) => link(p, { node: firstReplicator, port: i }));

            // Remove secondReplicator from graph
            removeFromArrayIf(graph, (n) => n === secondReplicator);
          });
        }
      } else if (
        node.type.startsWith("rep") &&
        node.ports[0].node.type === "app" && node.ports[0].port === 1
      ) {
        createRedex(node, node.ports[0].node, false, () => reduceAuxFan(node.ports[0].node, graph, relativeLevel));
      }
    }

    // Traverse net and mark the leftmost-outermost redex as optimal
    const rootNode = graph.find((node) => node.type === "root")!;
    // Traverse all nodes starting at the root and mark the first redex found as optimal
    let firstAuxFanReplication: Redex | undefined = undefined;
    const traverse = (nodePort: NodePort) => {
      const node = nodePort.node;
      const port = nodePort.port;

      // If nodes form an active pair
      if (nodePort.port === 0 && nodePort.node.ports[0].node.ports[0].node === nodePort.node) {
        const redex = getRedex(nodePort.node, nodePort.node.ports[0].node, redexes);
        if (redex) {
          redex.optimal = true;
          return true;
        }
      }

      // Check for rep merges
      if (node.type.startsWith("rep") && node.ports[0].node.type.startsWith("rep")) {
        const redex = getRedex(node, node.ports[0].node, redexes);
        if (redex) {
          redex.optimal = true;
          return true;
        }
      }

      // Check for aux fan replication
      if (firstAuxFanReplication === undefined && node.type.startsWith("rep") && node.ports[0].node.type === "app" && node.ports[0].port === 1) {
        firstAuxFanReplication = getRedex(node, node.ports[0].node, redexes);
      }

      if ((node as any).traversed) {
        // Avoid infinite loop
        return false;
      }
      (node as any).traversed = true;
      // Only traverse child ports
      if (node.type === "abs" && port === 0) {
        if (node.ports[2].node.type === "era") {
          if (traverse(node.ports[2])) {
            return true;
          }
        }
        if (traverse(node.ports[1])) {
          return true;
        }
      } else if (node.type === "app" && port === 1) {
        if (traverse(node.ports[0])) {
          return true;
        }
        if (traverse(node.ports[2])) {
          return true;
        }
      } else if (node.type === "rep-in" && port !== 0) {
        return traverse(node.ports[0]);
      } else if (node.type === "rep-out" && port === 0) {
        for (let i = 1; i < node.ports.length; i++) {
          if (traverse(node.ports[i])) {
            return true;
          }
        }
      } else if (node.type === "era") {
        // nothing to do
      }
      return false;
    }
    const res = traverse(rootNode.ports[0]);
    if (res === false && firstAuxFanReplication !== undefined) {
      firstAuxFanReplication.optimal = true;
    };

    // Move the optimal redex (if any) to the beginning of the redexes array
    // so that it is reduced when pressing right arrow key
    redexes.sort((a, b) => a.optimal ? -1 : b.optimal ? 1 : 0);

    // Mark certain redexes in the spine as optimal as well
    const traverse2 = (nodePort: NodePort) => {
      const node = nodePort.node;
      const port = nodePort.port;
      const other = nodePort.node.ports[0].node;

      // If annihilation or commutation with only unknown replicators
      if (port === 0 && other.ports[0].node === node && (!node.type.startsWith("rep") || parseRepLabel(node.label!).status === "unknown") && (!other.type.startsWith("rep") || parseRepLabel(other.label!).status === "unknown")) {
        const redex = getRedex(nodePort.node, other, redexes);
        if (redex) {
          redex.optimal = true;
        }
      }

      if ((node as any).traversed2) {
        // Avoid infinite loop
        return;
      }
      (node as any).traversed2 = true;
      // Only traverse child ports
      if (node.type === "abs" && port === 0) {
        if (node.ports[2].node.type === "era") {
          traverse2(node.ports[2]);
        }
        traverse2(node.ports[1]);
      } else if (node.type === "app" && port === 1) {
        traverse2(node.ports[0]);
        // quit traversal since we only consider redexes on the spine
        return;
      } else if (node.type === "rep-in" && port !== 0) {
        traverse2(node.ports[0]);
      } else if (node.type === "rep-out" && port === 0) {
        // quit traversal since we would need to traverse a specific port (so we would need to keep track of prior fan-ins)
        return;
      } else if (node.type === "era") {
        // nothing to do
      }
      return;
    }
    traverse2(rootNode.ports[0]);
  }

  return redexes;
}

// Returns true if the node is connected to erasers on all its aux ports
const isConnectedToAllErasers = (node: Node) => {
  return node.ports.every((p, i) => i > 0 ? p.node.type === "era" : true);
};

// Returns true if the node is connected to erasers on some of its aux ports
const isConnectedToSomeErasers = (node: Node) => {
  return node.ports.some((p, i) => i > 0 ? p.node.type === "era" : false);
};

// Counts erasers connected to aux ports
const countAuxErasers = (node: Node) => {
  return node.ports.reduce((count, p, i) => {
    if (i > 0 && p.node.type === "era") {
      count++;
    }
    return count;
  }, 0);
}

// Renders the current state of the reduction process
function render(
  state: Signal<State>,
  expression: Signal<string>,
  systemType: SystemType,
  relativeLevel: boolean,
): Node2D {
  const currState = state.peek()!;
  const graph = currState.stack[currState.idx];
  const node2D = new Node2D();

  // Reset flags
  graph.forEach((node) => {
    node.isCreated = false;
    (node as any).keep = undefined;
    (node as any).traversed = undefined;
    (node as any).traversed2 = undefined;
  });

  // Get redexes
  const redexes = getRedexes(graph, systemType, relativeLevel);

  // Render graph
  const rootNode = graph.find((node) => node.type === "root")!;
  const { node2D: mainTreeNode2D, endpoints } = renderNodePort(
    rootNode.ports[0],
    state,
    redexes,
  );
  rootNode.isCreated = true;
  mainTreeNode2D.pos.y = 2 * D;
  node2D.add(mainTreeNode2D);

  // Render root and root wire
  const root = new Root();
  node2D.add(root);
  const rootWire = new Wire(root, mainTreeNode2D, 0, undefined, levelColor(0));
  rootWire.startOffset.y = Root.RADIUS;
  node2D.add(rootWire);

  // Filter not-created erasers connected to parent ports
  const notCreatedParentErasers = graph.filter((node) =>
    node.type === "era" && !node.isCreated && isParentPort(node.ports[0])
  );

  // Prioritize erasers which are the only parents of a node
  const sortedNotCreatedErasers = notCreatedParentErasers.sort((a, b) => {
    // Deprioritize replicators, and among replicators prioritize those with only aux erasers
    if (a.ports[0].node.type.startsWith("rep")) {
      if (b.ports[0].node.type.startsWith("rep")) {
        // check if one has only aux erasers, if so, then prioritize that one
        if (
          isConnectedToAllErasers(a.ports[0].node) &&
          !isConnectedToAllErasers(b.ports[0].node)
        ) {
          return -1;
        } else if (
          !isConnectedToAllErasers(a.ports[0].node) &&
          isConnectedToAllErasers(b.ports[0].node)
        ) {
          return 1;
        } else {
          return 0;
        }
      } else {
        // A is rep, B is non-rep - swap i.e. prioritize B (non-rep)
        return 1;
      }
    } else {
      if (b.ports[0].node.type.startsWith("rep")) {
        // A is non-rep, B is rep - don't swap i.e. prioritize A (non-rep)
        return -1;
      } else {
        // Both are non-rep nodes - no need to prioritize
        return 0;
      }
    }
  });

  // Render eraser roots that are connected to parent ports
  let lastX = mainTreeNode2D.bounds.max.x;
  sortedNotCreatedErasers.forEach((node) => {
    if (node.isCreated) {
      return;
    }

    // Render eraser tree
    const { node2D: eraTree, endpoints: eraEndpoints } = renderNodePort(
      node.ports[0],
      state,
      redexes,
    );
    lastX -= eraTree.bounds.min.x;
    eraTree.pos.x = lastX;
    eraTree.pos.y = 2 * D;
    node2D.add(eraTree);
    endpoints.push(...eraEndpoints);
    // Render eraser and wire
    const era = new Eraser();
    era.pos.x = lastX;
    node2D.add(era);

    // const redex = getRedex(node, node.ports[0].node, currState.stack[currState.idx].redexes);
    const redex = getRedex(
      node,
      node.ports[0].node,
      redexes,
    );

    const wire = new Wire(
      era,
      eraTree,
      0,
      redex?.reduce && (() => applyReduction(state, redex.reduce)),
    );
    if (redex?.optimal === false) {
      wire.highlightColor = SUBOPTIMAL_HIGHLIGHT_COLOR;
    }
    node2D.add(wire);
    lastX += eraTree.bounds.max.x;
    node.isCreated = true;
  });

  // Render auxiliary wires
  renderWires(node2D, endpoints, state);

  // Check if any nodes are not created
  const nodesNotCreated = graph.filter((node) => !node.isCreated);
  if (nodesNotCreated.length > 0) {
    console.warn("Nodes not rendered: ", nodesNotCreated);
  }

  // Get optimal redexes
  const optimalRedexes = redexes.filter((redex) => redex.optimal);
  if (optimalRedexes.length > 0) {
    // If forward is undefined, set it to reduce a random redex
    if (currState.forward === undefined) {
      currState.forward = () => {
        applyReduction(state, () => {
          optimalRedexes[0].reduce();
        });
      };
    }
    // Set forwardParallel
    currState.forwardParallel = () => {
      applyReduction(state, () => {
        optimalRedexes.forEach((redex) => {
          redex.reduce();
        });
      });
    };
  } else if (!currState.data.appliedFinalStep) {
    // Traverse all nodes starting at the root and marking them as "keep" then erase non maked nodes
    const traverse = (nodePort: NodePort) => {
      // console.log("traverse", nodePort.node.label);
      const node = nodePort.node;
      const port = nodePort.port;
      if ((node as any).keep) {
        // Avoid infinite loop
        return;
      }
      (node as any).keep = true;
      // Only traverse child ports
      if (node.type === "abs" && port === 0) {
        if (node.ports[2].node.type === "era") {
          traverse(node.ports[2]);
        }
        traverse(node.ports[1]);
      } else if (node.type === "app" && port === 1) {
        traverse(node.ports[0]);
        traverse(node.ports[2]);
      } else if (node.type.startsWith("rep") && port !== 0) {
        traverse(node.ports[0]);
      } else if (node.type.startsWith("rep") && port === 0) {
        for (let i = 1; i < node.ports.length; i++) {
          traverse(node.ports[i]);
        }
      } else if (node.type === "era") {
        // nothing to do
      }
    }
    (rootNode as any).keep = true;
    traverse(rootNode.ports[0]);

    const nodesToErase = graph.filter((node) => !(node as any).keep);
    if (nodesToErase.length > 0) {
      currState.data.isFinalStep = true;
      // console.log("nodes to erase", nodesToErase);
      const finalStep = () => {
        applyReduction(state, () => {
          currState.data.appliedFinalStep = true;
          // Erase non kept nodes
          const graph = currState.stack[currState.idx];
          graph.forEach((node) => {
            if ((node as any).keep) {
              // Loop through ports
              node.ports.forEach((p, i) => {
                if (!(p.node as any).keep) {
                  // Connect the external port to a new eraser (don't add eraser to graph)
                  const eraser: Node = { type: "era", label: "era", ports: [] };
                  link({ node, port: i }, { node: eraser, port: 0 });
                }
              });
            }
          });
          removeFromArrayIf(graph, (n) => !(n as any).keep);

          // Remove erasers connected to replicator aux ports (all replicators are unpaired at this point)
          graph.forEach((node) => {
            // Skip non replicators
            if (!node.type.startsWith("rep")) {
              return;
            }
            // Loop through replicator ports marking ports to erase
            node.ports.forEach((p, i) => {
              // Only consider aux ports connected to erasers
              if (p.node.type !== "era" || i === 0) {
                return;
              }
              (p as any).erase = true; // Mark port to erase
            })
            // Remove level deltas and ports
            removeFromArrayIf(node.levelDeltas!, (ld, i) => (node.ports[i+1] as any).erase === true)
            removeFromArrayIf(node.ports, (p) => (p as any).erase === true)
            // Relink node ports
            node.ports.forEach((p, i) => {
              link(p, { node, port: i })
            })
          })

          // Remove replicators with a single aux port that has a zero level delta
          const nodesToRemove: Node[] = [];
          graph.forEach((node) => {
            if (node.type.startsWith("rep") &&
                (node.ports.length === 2 &&
                  node.levelDeltas![0] === 0)
            ) {
              link(node.ports[0], node.ports[1]);
              nodesToRemove.push(node);
            }
          });
          for (const node of nodesToRemove) {
            removeFromArrayIf(graph, (n) => n === node);
          }

        });
      }
      currState.forward = finalStep;
      currState.forwardParallel = finalStep;
    } else {
      currState.data.appliedFinalStep = true;
    }
  }

  return node2D;
}

// Returns true if the node port is a parent port
function isParentPort(nodePort: NodePort): boolean {
  return (nodePort.node.type === "rep-out" && nodePort.port === 0) ||
    (nodePort.node.type === "rep-in" && nodePort.port !== 0) ||
    (nodePort.node.type === "abs" && nodePort.port === 0) ||
    (nodePort.node.type === "app" && nodePort.port === 1) ||
    (nodePort.node.type === "era" && nodePort.port === 0) ||
    (nodePort.node.type === "var" && nodePort.port === 0);
}

// The type of a graph endpoint
type Endpoint = {
  nodePort: NodePort;
  node2D: Node2D;
  level?: number;
  used?: boolean;
  redex?: Redex;
};

// Renders a node port
const renderNodePort = (
  nodePort: NodePort,
  state: Signal<State>,
  redexes: Redex[],
  level: number = 0,
): { node2D: Node2D; endpoints: Endpoint[] } => {
  const node2D = new Node2D();
  let endpoints: Endpoint[] = [];
  if (nodePort.node.isCreated) {
    // Node has been created already - create a wire endpoint
    const endpoint = new Node2D();
    endpoint.bounds = { min: { x: -D, y: 0 }, max: { x: D, y: D } };
    node2D.add(endpoint);
    (node2D as any).isWireEndpoint = true;
    endpoints.push({ nodePort, node2D, level });
  } else if (nodePort.node.type === "var") {
    nodePort.node.isCreated = true;
    const label = new Label(nodePort.node.label);
    label.pos.y = D;
    node2D.add(label);
    endpoints.push({ nodePort, node2D });
  } else if (nodePort.node.type === "era") {
    nodePort.node.isCreated = true;
    const era = new Eraser();
    node2D.add(era);
    endpoints.push({ nodePort, node2D });
  } else if (nodePort.node.type === "abs" && nodePort.port === 0) {
    nodePort.node.isCreated = true;
    const fan = new Fan("up", nodePort.node.label);

    const { node2D: body, endpoints: bodyEndpoints } = renderNodePort(
      nodePort.node.ports[1],
      state,
      redexes,
      level,
    );
    body.pos.x = Math.max(Fan.PORT_DELTA, -body.bounds.min.x - D);
    body.pos.y = (body as any).isWireEndpoint
      ? Fan.HEIGHT
      : fan.bounds.max.y - body.bounds.min.y;


    const redex = getRedex(
      nodePort.node,
      nodePort.node.ports[1].node,
      redexes,
    );

    if (!(body as any).isWireEndpoint) {
      const funcWire = new Wire(fan, body, D, redex?.reduce && (() => applyReduction(state, redex.reduce)), levelColor(level));
      if (redex?.optimal === false) {
        funcWire.highlightColor = SUBOPTIMAL_HIGHLIGHT_COLOR;
      }
      funcWire.startOffset.x = Fan.PORT_DELTA;
      funcWire.startOffset.y = Fan.HEIGHT;
      node2D.add(funcWire);
    } else {
      // Add redex to the appropriate endpoint
      const childEndpoint = bodyEndpoints.find((endpoint) => endpoint.nodePort === nodePort.node.ports[1]);
      if (childEndpoint) {
        childEndpoint.redex = redex;
      }
    }

    // Create eraser or wire endpoint
    if (nodePort.node.ports[2].node.type === "era") {
      nodePort.node.ports[2].node.isCreated = true;
      const era = new Eraser();
      era.pos.x = -Fan.PORT_DELTA;
      era.pos.y = fan.bounds.max.y - era.bounds.min.y;
      node2D.add(era);
      endpoints.push({ nodePort: nodePort.node.ports[2], node2D: era, level });
      const wire = new Wire(fan, era, 0, undefined, levelColor(level + 1));
      wire.startOffset.x = -Fan.PORT_DELTA;
      wire.startOffset.y = Fan.HEIGHT;
      wire.endOffset.y = -Eraser.RADIUS;
      node2D.add(wire);
    } else {
      // Create wire endpoint
      const endpoint = new Node2D();
      endpoint.bounds = { min: { x: -D, y: 0 }, max: { x: D, y: D } };
      endpoint.pos.x = -Fan.PORT_DELTA;
      endpoint.pos.y = Fan.HEIGHT;
      node2D.add(endpoint);
      (endpoint as any).isWireEndpoint = true;
      endpoints.push({
        nodePort: nodePort.node.ports[2],
        node2D: endpoint,
        level: level + 1,
      });
    }

    node2D.add(fan);
    node2D.add(body);

    endpoints = [...endpoints, ...bodyEndpoints];
  } else if (nodePort.node.type === "app" && nodePort.port === 1) {
    nodePort.node.isCreated = true;
    const fan = new Fan("down", nodePort.node.label);
    fan.pos.x = Fan.PORT_DELTA;

    const { node2D: func, endpoints: funcEndpoints } = renderNodePort(
      nodePort.node.ports[0],
      state,
      redexes,
      level,
    );
    func.pos.x = Fan.PORT_DELTA;
    func.pos.y = (func as any).isWireEndpoint
      ? Fan.HEIGHT
      : fan.bounds.max.y - func.bounds.min.y;


    const redex = getRedex(
      nodePort.node,
      nodePort.node.ports[0].node,
      redexes,
    );

    if (!(func as any).isWireEndpoint) {
      const funcWire = new Wire(
        fan,
        func,
        0,
        redex?.reduce && (() => applyReduction(state, redex.reduce)),
        levelColor(level),
      );
      if (redex?.optimal === false) {
        funcWire.highlightColor = SUBOPTIMAL_HIGHLIGHT_COLOR;
      }
      funcWire.startOffset.y = Fan.HEIGHT;
      node2D.add(funcWire);
    } else {
      // Add redex to the appropriate endpoint
      const childEndpoint = funcEndpoints.find((endpoint) => endpoint.nodePort === nodePort.node.ports[0]);
      if (childEndpoint) {
        childEndpoint.redex = redex;
      }
    }

    const { node2D: arg, endpoints: argEndpoints } = renderNodePort(
      nodePort.node.ports[2],
      state,
      redexes,
      level + 1,
    );
    arg.pos.x = nodePort.node.ports[2].node.type === "var"
      ? fan.bounds.max.x - arg.bounds.min.x + 2 * D
      : Fan.PORT_DELTA + Math.max(func.bounds.max.x, fan.bounds.max.x) -
        arg.bounds.min.x;

    const argWire = new Wire(fan, arg, -D, undefined, levelColor(level + 1));
    argWire.startOffset.x = Fan.PORT_DELTA;
    node2D.add(argWire);

    node2D.add(fan);
    node2D.add(func);
    node2D.add(arg);

    endpoints = [...funcEndpoints, ...argEndpoints];
  } else if (nodePort.node.type.startsWith("rep") && nodePort.port !== 0) {
    if (nodePort.node.type !== "rep-in") {
      console.error("WRONG REP TYPE - EXPECTED rep-in", nodePort.node.type);
    }
    nodePort.node.isCreated = true;
    const rep = new Replicator(
      "down",
      nodePort.node.label,
      nodePort.node.levelDeltas!,
    );
    const parentPortDelta = rep.portDelta(nodePort.port - 1);
    rep.pos.x = -parentPortDelta;
    const eraCount = countAuxErasers(nodePort.node)
    const relevantAuxPortsMinus1 = Math.max((eraCount > 0) && (eraCount !== nodePort.node.ports.length - 1) ? 1.5 : 0, nodePort.node.ports.length - 2 - eraCount)
    rep.pos.y = relevantAuxPortsMinus1 * 2 * D;
    rep.bounds.min.y -= relevantAuxPortsMinus1 * 2 * D;
    node2D.add(rep);

    // parent wire extender
    const parWire = new Wire(node2D, rep, 0, undefined, levelColor(level));
    parWire.endOffset.x = parentPortDelta;
    node2D.add(parWire);

    const childLevel = level - nodePort.node.levelDeltas![nodePort.port - 1];
    const { node2D: child, endpoints: childEndpoints } = renderNodePort(
      nodePort.node.ports[0],
      state,
      redexes,
      childLevel,
    );
    child.pos.x = -parentPortDelta;
    child.pos.y = rep.pos.y +
      ((child as any).isWireEndpoint
        ? Replicator.HEIGHT
        : rep.bounds.max.y - child.bounds.min.y);
    node2D.add(child);
    endpoints.push(...childEndpoints);

    const redex = getRedex(
      nodePort.node,
      nodePort.node.ports[0].node,
      redexes,
    );

    // Draw child wire
    if (!(child as any).isWireEndpoint) {
      const childWire = new Wire(
        rep,
        child,
        0,
        redex?.reduce && (() => applyReduction(state, redex.reduce)),
        levelColor(childLevel),
      );
      if (redex?.optimal === false) {
        childWire.highlightColor = SUBOPTIMAL_HIGHLIGHT_COLOR;
      }
      childWire.startOffset.y = Replicator.HEIGHT;
      rep.add(childWire);
    } else {
      // Add redex to the appropriate endpoint
      const childEndpoint = childEndpoints.find((endpoint) => endpoint.nodePort === nodePort.node.ports[0]);
      if (childEndpoint) {
        childEndpoint.redex = redex;
      }
    }

    // Draw aux wires to the right and down
    const lastX = node2D.bounds.max.x; // Math.max(child.bounds.max.x, rep.bounds.max.x);
    let i2 = 2;
    for (let i = 1; i < nodePort.node.ports.length; i++) {
      if (i === nodePort.port) {
        // Skip the current port
        continue;
      }
      const auxLevel = childLevel + nodePort.node.levelDeltas![i - 1];
      // Create eraser or wire endpoint
      if (nodePort.node.ports[i].node.type === "era") {
        nodePort.node.ports[i].node.isCreated = true;
        const era = new Eraser();
        era.pos.x = rep.pos.x + rep.portDelta(i - 1);
        era.pos.y = rep.pos.y - 2 * D;
        node2D.add(era);
        const redex = getRedex(
          nodePort.node,
          nodePort.node.ports[i].node,
          redexes,
        );
        const wire = new Wire(
          rep,
          era,
          0,
          redex?.reduce && (() => applyReduction(state, redex.reduce)),
          levelColor(auxLevel),
        );
        if (redex?.optimal === false) {
          wire.highlightColor = SUBOPTIMAL_HIGHLIGHT_COLOR;
        }
        wire.startOffset.x = rep.portDelta(i - 1);
        rep.add(wire);
      } else {
        // Create wire endpoint
        const endpoint = new Node2D();
        endpoint.bounds = { min: { x: -D, y: 0 }, max: { x: D, y: D } };
        endpoint.pos.x = lastX +
          (nodePort.node.ports.length - i2 - 0.5) * 2 * D;
        endpoint.pos.y = rep.pos.y;
        node2D.add(endpoint);
        (endpoint as any).isWireEndpoint = true;
        endpoints.push({
          nodePort: nodePort.node.ports[i],
          node2D: endpoint,
          level: auxLevel,
        });
        // Create wire to endpoint
        const wire = new Wire(
          rep,
          endpoint,
          (i2 - nodePort.node.ports.length + 0.5) * 2 * D,
          undefined,
          levelColor(auxLevel),
        );
        wire.startOffset.x = rep.portDelta(i - 1);
        rep.add(wire);
      }
      i2++;
    }
  } else if (nodePort.node.type.startsWith("rep") && nodePort.port === 0) {
    if (nodePort.node.type !== "rep-out") {
      console.error("WRONG REP TYPE, EXPECTED rep-out", nodePort.node.type);
    }
    nodePort.node.isCreated = true;
    const rep = new Replicator(
      "up",
      nodePort.node.label,
      nodePort.node.levelDeltas!,
    );
    node2D.add(rep);

    // Render children
    const children: Node2D[] = [];
    let allChildrenAreWireEndpoints = true;
    for (let i = nodePort.node.ports.length - 1; i > 0; i--) {
      const childLevel = level + nodePort.node.levelDeltas![i - 1];
      const { node2D: child, endpoints: childEndpoints } = renderNodePort(
        nodePort.node.ports[i],
        state,
        redexes,
        childLevel,
      );
      if (allChildrenAreWireEndpoints && !(child as any).isWireEndpoint) {
        allChildrenAreWireEndpoints = false;
      }
      children.push(child);
      endpoints.push(...childEndpoints);
    }

    // Position children
    if (allChildrenAreWireEndpoints) {
      // If all children are wire endpoints, render them inline
      children.forEach((child, i) => {
        child.pos.x = rep.portDelta(i);
        child.pos.y = Replicator.HEIGHT;
        node2D.add(child);
      });
    } else {
      let lastX = rep.portDelta(0) + children[0].bounds.min.x;
      children.forEach((child, i) => {
        lastX -= child.bounds.min.x;
        child.pos.x = lastX;
        lastX += child.bounds.max.x;
        child.pos.y = Replicator.HEIGHT +
          Math.max(children.length - 1, 1) * 2 * D +
          (nodePort.node.ports[nodePort.node.ports.length - 1 - i].node.type ===
              "app"
            ? 2 * D
            : 0);
        node2D.add(child);

        const childLevel = level +
          nodePort.node.levelDeltas![children.length - i - 1];
        const childWire = new Wire(
          rep,
          child,
          (children.length - i - 0.5) * 2 * D,
          undefined,
          levelColor(childLevel),
        );
        childWire.startOffset.x = rep.portDelta(i);
        childWire.startOffset.y = Replicator.HEIGHT;
        node2D.add(childWire);
      });
    }
  } else {
    // Node has not been created but will be in the future - create a wire endpoint
    const endpoint = new Node2D();
    endpoint.bounds = { min: { x: -D, y: 0 }, max: { x: D, y: D } };
    node2D.add(endpoint);
    (node2D as any).isWireEndpoint = true;
    endpoints.push({ nodePort, node2D, level });
  }
  return { node2D, endpoints };
};

// Renders wires between paired endpoints, and returns the remaining endpoints
const renderWires = (node2D: Node2D, endpoints: Endpoint[], state: Signal<MethodState<any, Data>>) => {
  // Sort endpoints by x position
  endpoints.sort((a, b) =>
    a.node2D.globalPosition().x - b.node2D.globalPosition().x
  );

  // Compile pairs of endpoints that are connected
  const wiresToCreate: { i: number; j: number, redex?: Redex }[] = [];
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      if (endpoints[i].used || endpoints[j].used) {
        continue;
      }
      if (
        reciprocal(endpoints[i].nodePort).node === endpoints[j].nodePort.node &&
        reciprocal(endpoints[i].nodePort).port === endpoints[j].nodePort.port
      ) {
        endpoints[i].used = true;
        endpoints[j].used = true;
        wiresToCreate.push({ i, j, redex: endpoints[i].redex || endpoints[j].redex });
      }
    }
  }

  // Sort wiresToCreate by length
  wiresToCreate.sort((a, b) => {
    const horizontalDist = (i: number, j: number) =>
      endpoints[j].node2D.globalPosition().x -
      endpoints[i].node2D.globalPosition().x;
    return horizontalDist(a.i, a.j) - horizontalDist(b.i, b.j);
  });

  // Create wires
  const wires: Wire[] = [];
  wiresToCreate.forEach(({ i, j, redex }) => {
    const leftX = endpoints[i].node2D.globalPosition().x;
    const rightX = endpoints[j].node2D.globalPosition().x;
    // Find wires between the left and right endpoints
    const wiresBetween = wires.filter((wire) =>
      !(
        wire.start.globalPosition().x > rightX ||
        wire.end.globalPosition().x < leftX
      )
    );
    // Get max height of endpoints in between i and j
    const maxH = Math.max(
      endpoints[i].node2D.globalPosition().y +
        endpoints[i].node2D.bounds.max.y + D,
      endpoints[j].node2D.globalPosition().y +
        endpoints[j].node2D.bounds.max.y + D,
      ...endpoints.slice(i + 1, j).map((endpoint) =>
        endpoint.node2D.globalPosition().y + endpoint.node2D.bounds.max.y + D
      ),
      ...wiresBetween.map((w) => w.start.globalPosition().y + w.viaY + 2 * D),
    );
    // Create wire
    // Set level as undefined if conflicting to indicate issue
    const level = (endpoints[i].level === endpoints[j].level &&
        endpoints[i].level !== undefined)
      ? endpoints[i].level
      : undefined;

    // TODO: show level even if one side? Would sill need to fix levels out of eraser "roots". And if those are fixed, then probably don't need this.
    // Set level. Pick the non-undefined level if it exists. if both are defined, then make sure they are equal
    // const level = endpoints[i].level === undefined ? endpoints[j].level : endpoints[j].level === undefined ? endpoints[i].level : endpoints[i].level// (endpoints[i].level === endpoints[j].level) ? endpoints[i].level : undefined;

    const wire = new Wire(
      endpoints[i].node2D,
      endpoints[j].node2D,
      maxH - endpoints[i].node2D.globalPosition().y,
      redex ? (() => applyReduction(state, redex.reduce)) : undefined,
      level !== undefined ? levelColor(level) : undefined,
    );
    wires.push(wire);
    node2D.add(wire);
    // Update bounds of node2D
    node2D.bounds.max.y = Math.max(node2D.bounds.max.y, maxH + D);
  });
};

// The status of a replicator
type RepStatus = "unpaired" | "unknown";

// Parses a replicator label into a level and a flag
function parseRepLabel(label: string): { level: number; status: RepStatus } {
  let level: number;
  let status: RepStatus;
  const marker = label[label.length - 1];
  if (marker === "*") {
    level = parseInt(label.slice(0, -1));
    status = "unknown";
  } else {
    level = parseInt(label);
    status = "unpaired";
  }
  return { level, status: status };
}

// Formats a replicator label, given a level and a flag
function formatRepLabel(level: number, status: RepStatus): string {
  if (status === "unknown") {
    return level + "*";
  } /* unpaired */ else {
    return level.toString();
  }
}

// Parses an AST and appends nodes into the specified graph.
function addAstNodeToGraph(
  astNode: AstNode,
  graph: Graph,
  vars: Map<
    string,
    { level: number; nodePort: NodePort; firstUsageLevel?: number }
  > = new Map(),
  level: number = 0,
  relativeLevel: boolean,
): NodePort {
  if (astNode.type === "abs") {
    // Create abstraction node with eraser
    const eraser: Node = { type: "era", label: "era", ports: [] };
    graph.push(eraser);
    const node: Node = { type: "abs", label: "λ" + astNode.name, ports: [] };
    graph.push(node);
    link({ node: eraser, port: 0 }, { node, port: 2 });

    // Add abstraction variable to vars
    const orig = vars.get(astNode.name);
    vars.set(astNode.name, { level, nodePort: { node, port: 2 } });

    // Parse body port
    const bodyPort = addAstNodeToGraph(astNode.body, graph, vars, level, relativeLevel);
    link(bodyPort, { node, port: 1 });

    // Need to restore original vars (if any) instead of deleting
    if (orig) {
      vars.set(astNode.name, orig);
    } else {
      vars.delete(astNode.name);
    }

    return { node, port: 0 };
  } else if (astNode.type === "app") {
    // Create application node
    const node: Node = { type: "app", label: "@", ports: [] };
    graph.push(node);

    // Parse function port
    const funcPort = addAstNodeToGraph(astNode.func, graph, vars, level, relativeLevel);
    link(funcPort, { node, port: 0 });

    // Parse argument port
    const argPort = addAstNodeToGraph(astNode.arg, graph, vars, level + 1, relativeLevel);
    link(argPort, { node, port: 2 });

    // Return parent port
    return { node, port: 1 };
  } else if (astNode.type === "var") {
    if (vars.has(astNode.name)) {
      // Get the node port that leads to the variable
      const varData = vars.get(astNode.name)!;
      let sourceNodePort = varData.nodePort;
      // Get the "destination" NodePort of the variable
      const destNodePort = reciprocal(varData.nodePort);
      // If this is the first time we're using this bound variable it will be connected to an eraser
      if (destNodePort.node.type === "era") {
        // Delete the eraser
        removeFromArrayIf(graph, (node) => node === destNodePort.node);
        // Create a replicator fan-in
        const node: Node = {
          type: "rep-in",
          label: relativeLevel ? "0" : (varData.level + 1).toString(),
          ports: [],
          levelDeltas: [level - (varData.level + 1)],
        };
        graph.push(node);
        link({ ...sourceNodePort }, { node, port: 0 });
        sourceNodePort = { node, port: 1 };
      } else {
        // If this is not the first time that we're using this bound variable, then a replicator has already been created and we need to connect to it and update sourceNodePort
        const rep = destNodePort.node;
        rep.levelDeltas = [...rep.levelDeltas!, level - varData.level - 1];
        sourceNodePort = { node: rep, port: rep.ports.length };
      }

      return sourceNodePort;
    } else {
      // Create free variable node
      const node: Node = {
        type: "var",
        label: astNode.name,
        ports: [],
      };
      graph.push(node);
      let portToReturn = { node, port: 0 };

      // Create a replicator fan-in to share the free variable
      const rep: Node = {
        type: "rep-in",
        label: "0",
        ports: [],
        levelDeltas: [level - 1],
      };
      graph.push(rep);
      link({ ...portToReturn }, { node: rep, port: 0 });
      portToReturn = { node: rep, port: 1 };

      // Set variable in vars
      vars.set(astNode.name, { level: 0, nodePort: { node, port: 0 } });

      // Return parent port
      return portToReturn;
    }
  } else {
    throw new Error("Unknown node type: " + (astNode as any).type);
  }
}

// Colors for the levels
const levelColors = [
  "#ff666686",
  "#ffbd5586",
  "#ffff6686",
  "#9de24f86",
  "#87cefa86",
  // "#F006",
  // "#0F06",
  // "#00F6",
  // "#FF06",
  // "#F0F6",
  // "#0FF6",
  // "#FFF6",
];

// Returns the color for a given level
const levelColor = (level: number): string | undefined => {
  return undefined
  return levelColors[level % levelColors.length];
};

// Annihilates two interacting nodes
export function reduceAnnihilate(node: Node, graph: Graph) {
  const other = node.ports[0].node;

  // Sanity checks
  if (other.ports[0].node !== node) {
    throw new Error("nodes are not interacting!");
  }
  if (node.ports.length !== other.ports.length) {
    throw new Error("nodes have different number of ports!");
  }

  // Connect the aux ports (if any)
  if (node.ports.length > 1) {
    for (let i = 1; i < node.ports.length; i++) {
      link(node.ports[i], other.ports[i]);
    }
  }

  // Remove the nodes
  removeFromArrayIf(graph, (n) => n === node || n === other);
}

export function reduceErase(node: Node, graph: Graph) {
  const eraser = node.ports[0].node;

  // Sanity checks
  if (eraser.ports[0].node !== node) {
    throw new Error("nodes are not interacting!");
  }
  if (eraser.type !== "era") {
    throw new Error("node is not an eraser!");
  }

  // Create and connect erasers to the auxiliary ports
  for (let i = 1; i < node.ports.length; i++) {
    const newEraser: any = { type: "era", ports: [] };
    graph.push(newEraser);
    link({ node: newEraser, port: 0 }, node.ports[i]);
  }

  // Erase the node and original eraser
  removeFromArrayIf(graph, (n) => (n === node) || (n === eraser));
}

export function reduceCommute(node: Node, graph: Graph) {
  const other = node.ports[0].node;

  // Sanity checks
  if (other.ports[0].node !== node) {
    throw new Error("nodes are not interacting!");
  }

  // Create a copy of `other` once for each of the auxiliary ports of `node`
  const otherClones: Node[] = [];
  for (let i = 1; i < node.ports.length; i++) {
    const clone: any = {
      ...other,
      levelDeltas: other.levelDeltas ? [...other.levelDeltas] : undefined,
      ports: [],
    };
    graph.unshift(clone);
    otherClones.push(clone);
    // Connect the clone's principal port with the external port
    link({ node: clone, port: 0 }, node.ports[i]);
  }

  // Create a copy of `node` once for each of the auxiliary ports of `other`
  const nodeClones: Node[] = [];
  for (let i = 1; i < other.ports.length; i++) {
    const clone: any = {
      ...node,
      levelDeltas: node.levelDeltas ? [...node.levelDeltas] : undefined,
      ports: [],
    };
    graph.unshift(clone);
    nodeClones.push(clone);
    // Connect the clone's principal port with the external port
    link({ node: clone, port: 0 }, other.ports[i]);
  }

  // Connect the auxiliary ports of the clones of `node` to the auxiliary ports of the clones of `other`
  for (let i = 0; i < nodeClones.length; i++) {
    for (let j = 0; j < otherClones.length; j++) {
      link(
        { node: nodeClones[i], port: j + 1 },
        { node: otherClones[j], port: i + 1 },
      );
    }
  }

  // Remove the original nodes
  removeFromArrayIf(graph, (n) => n === node || n === other);

  // Return the new nodes in case the caller wants to do something with them
  return { nodeClones, otherClones };
}

// Helper function to get the reciprocal of a node port
export function reciprocal(nodePort: NodePort) {
  return nodePort.node.ports[nodePort.port];
}

// Helper function to link two node ports
export function link(
  nodePortA: NodePort,
  nodePortB: NodePort,
) {
  nodePortA.node.ports[nodePortA.port] = nodePortB;
  nodePortB.node.ports[nodePortB.port] = nodePortA;
}

// Reduces a fan and the node connected to its first auxiliary port (parent port).
const reduceAuxFan = (node: Node, graph: Graph, relativeLevel: boolean) => {
  const firstAuxNode = node.ports[1].node;

  if (firstAuxNode.type === "era") {
    // Create a new eraser and link it to the node connected to the principal port
    const newEraser0: any = { type: "era", ports: [] };
    graph.push(newEraser0);
    link({ node: newEraser0, port: 0 }, node.ports[0]);

    // Create a new eraser and link it to the node connected to the second auxiliary port
    const newEraser1: any = { type: "era", ports: [] };
    graph.push(newEraser1);
    link({ node: newEraser1, port: 0 }, node.ports[2]);

    // Remove the fan node
    removeFromArrayIf(graph, (n) => (n === node) || (n === firstAuxNode));
  } else if (firstAuxNode.type.startsWith("rep")) {

    const origPorts = [...node.ports];
    link({ node, port: 0 }, origPorts[1]);
    link({ node, port: 1 }, origPorts[2]);
    link({ node, port: 2 }, origPorts[0]);

    const { nodeClones, otherClones } = reduceCommute(node, graph);

    if (relativeLevel) {
      const repLevel = parseRepLabel(otherClones[1].label!).level;
      otherClones[0].label = formatRepLabel(repLevel + 1, "unknown");
    }

    // Modify all clones of the application node back to the original port configuration
    nodeClones.forEach((nodeClone) => {
      const origPorts = [...nodeClone.ports];
      link({ node: nodeClone, port: 0 }, origPorts[2]);
      link({ node: nodeClone, port: 1 }, origPorts[0]);
      link({ node: nodeClone, port: 2 }, origPorts[1]);
    });
  }
};

// A graph is a list of nodes.
export type Graph = Node[];

// A port of a particular node.
export type NodePort = { node: Node; port: number };

// The node type determines the number of auxiliary ports.
export type NodeType =
  | "abs" // Abstraction (2 auxiliary ports)
  | "app" // Application (2 auxiliary ports)
  | "rep-in" // Replicator Fan-In (any number of auxiliary ports)
  | "rep-out" // Replicator Fan-Out (any number of auxiliary ports)
  | "era" // Eraser (0 auxiliary ports)
  | "var" // Variable (0 auxiliary ports; technically not an interaction net agent, just a label for a wire)
  | "root"; // Root (0 auxiliary ports; technically not an interaction net agent, just a special label for a wire)

// A node in the computational graph.
// Each element in `ports` is a NodePort (of any node, potentially even this same node) that is connected to this node, at port X, where X is the element index.
// The first NodePort in `ports` (with index 0) is the NodePort connected to this node's principal port.
// Indexes >=1 represent this node's auxiliary ports from left to right, assuming the principal port is facing down and auxiliary ports are facing up.
// Another way to think about this: indexes represent a node's ports ordered clockwise, starting from the principal port.
export type Node = {
  type: NodeType;
  ports: NodePort[];
  label?: string;
  isCreated?: boolean; // This is set to true when the associated tree is created (helps identify disjointed graphs, and, more importantly, is used to mark that a shared node like a dup or rep has been created and does not need to be created again)
  levelDeltas?: number[]; // If `type` is "rep-in" or "rep-out", then this specifies the level delta of each aux port
};

// Applies a reduction to the current state, and updates the navigation functions
export function applyReduction(
  state: Signal<MethodState<any, Data>>,
  reduce: () => void,
) {
  // Deep clone current state and insert it into the stack below the
  // curent state, and delete all states after the current one
  const currState = state.peek()!;
  const stateClone = structuredClone(currState.stack[currState.idx]);
  currState.stack = currState.stack.slice(0, currState.idx + 1);
  currState.stack.splice(currState.idx, 0, stateClone);
  currState.idx = currState.idx + 1;
  currState.forward = undefined;
  currState.forwardParallel = undefined;

  reduce();

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
    currState.data.appliedFinalStep = false;
    currState.data.isFinalStep = false;
    // Trigger state update
    batch(() => {
      state.value = { ...currState };
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
    currState.data.appliedFinalStep = false;
    currState.data.isFinalStep = false;
    // Trigger state update
    batch(() => {
      state.value = { ...currState };
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
    });
  };

  // Update functions that are also set to defined values inside `forward` defined above, assuming that `currState.stack.length - 1 === currState.idx`
  currState.back = back;
  currState.reset = reset;

  state.value = { ...currState };
}
