import * as d3 from "d3";
import { removeFromArrayIf } from "./util.ts";

// The type of an SVG node.
export type SVG = any;

// The type of an SVG node with z-index information.
export type zSVG = {
  zIndex: number;
  svg: SVG;
};

// 2-dimensional position.
export type Pos = {
  x: number;
  y: number;
};

// A 2-dimensional bounding box.
export type Bounds = {
  min: Pos;
  max: Pos;
};

// A 2-dimensional node with an optional `Drawable`.
// It can have any number of children `Node`s.
export class Node2D {
  // The position of the node relative to its parent
  pos: Pos = { x: 0, y: 0 };
  // The children of the node
  children: Node2D[] = [];
  // The parent of the node (if any)
  parent?: Node2D;
  // The bounding box of the node (relative to its position) [The idea is to use this instead of wLeft + wRight + h]
  bounds: Bounds = {
    min: { x: 0, y: 0 },
    max: { x: 0, y: 0 },
  };
  // The z-index of the node
  zIndex = 0;
  // Whether the node is to be rendered
  visible = true;

  // The width of the node.
  getWidth() {
    return this.bounds.max.x - this.bounds.min.x;
  }

  // The height of the node.
  getHeight() {
    return this.bounds.max.y - this.bounds.min.y;
  }

  // Add a child to the node.
  add(child: Node2D, updateBounds = true) {
    this.children.push(child);
    child.parent = this;
    // Update bounds
    if (updateBounds) {
      this.includeBounds(child);
    }
  }

  // Include the bounds of a node inside this node.
  includeBounds(node: Node2D) {
    this.bounds.min.x = Math.min(
      this.bounds.min.x,
      node.pos.x + node.bounds.min.x,
    );
    this.bounds.min.y = Math.min(
      this.bounds.min.y,
      node.pos.y + node.bounds.min.y,
    );
    this.bounds.max.x = Math.max(
      this.bounds.max.x,
      node.pos.x + node.bounds.max.x,
    );
    this.bounds.max.y = Math.max(
      this.bounds.max.y,
      node.pos.y + node.bounds.max.y,
    );
  }

  // Update the bounds of the node based on its children.
  updateBounds() {
    this.children.forEach((child) => this.includeBounds(child));
  }

  // Remove children from the node.
  remove(...children: Node2D[]) {
    children.forEach((child) => (child.parent = undefined));
    removeFromArrayIf(this.children, (child) => children.includes(child));
  }

  // For each descendant of the node, call a function.
  forEachDescendant(f: (node: Node2D) => void) {
    this.children.forEach((child) => {
      f(this);
      child.forEachDescendant(f);
    });
  }

  // Compute the global position of the node.
  globalPosition(): Pos {
    let x = this.pos.x;
    let y = this.pos.y;
    let parent = this.parent;
    while (parent) {
      x += parent.pos.x;
      y += parent.pos.y;
      parent = parent.parent;
    }
    return { x, y };
  }

  // Render the node and its descendants to a set of zSVGs.
  render(
    theme: "light" | "dark",
    debug = false,
    offset: Pos = { x: 0, y: 0 },
  ): zSVG[] {
    const pos = {
      x: this.pos.x + offset.x,
      y: this.pos.y + offset.y,
    };
    const zSVGs: zSVG[] = [];

    // Render the node itself and add it to the zSVGs if needed
    if (this.visible) {
      const svg = this.renderSelf(pos, theme, debug);
      if (svg) {
        zSVGs.push({ svg, zIndex: this.zIndex });
      }
      // If in debug mode, render a rectangle to show the node's bounds
      if (debug && !(this instanceof Enclosure)) {
        const width = this.getWidth();
        const height = this.getHeight();
        if (width > 0 || height > 0) {
          const radius = Math.min(
            Wire.CORNER_RADIUS / 2,
            width / 2,
            height / 2,
          );
          const stroke = theme === "light" ? "#AAA" : "#555";
          const fill = theme === "light" ? "#AAA0 " : "#5550";
          const boundsRect = new Rect(width, height, radius, radius, {
            stroke,
            fill,
            "stroke-width": 1,
            "pointer-events": "none",
          });
          const boundsRectSVG = boundsRect.renderSelf(
            { x: pos.x + this.bounds.min.x, y: pos.y + this.bounds.min.y },
            theme,
            debug,
          );
          zSVGs.push({ svg: boundsRectSVG, zIndex: this.zIndex - 1 });

          // Create X to mark the center
          const path = d3.path();
          const delta = Math.cos(Math.PI / 4) * Eraser.RADIUS;
          path.moveTo(pos.x - delta, pos.y - delta);
          path.lineTo(pos.x + delta, pos.y + delta);
          path.moveTo(pos.x + delta, pos.y - delta);
          path.lineTo(pos.x - delta, pos.y + delta);
          const pathNode = new Path(path);
          pathNode.attrs.stroke = stroke;
          pathNode.translate = false;
          zSVGs.push({
            svg: pathNode.renderSelf(pos, theme),
            zIndex: this.zIndex - 1,
          });
        }
      }
    }

    // Render the children and add them to the zSVGs
    zSVGs.push(
      ...this.children.map((child) => child.render(theme, debug, pos)).flat(),
    );

    return zSVGs;
  }

  // Render the node itself. To be implemented by subclasses.
  renderSelf(pos: Pos, theme: "light" | "dark", debug = false): SVG | null {
    return null;
  }
}

// Renders a set of zSVGs.
export function render(zSVGs: zSVG[]): SVG[] {
  zSVGs.sort((a, b) => a.zIndex - b.zIndex);
  return zSVGs.map((zSVG) => zSVG.svg.node());
}

// Helper function to apply attributes, styles, and event handlers to an SVG.
export function applyEntries(
  svg: SVG,
  field: string,
  object: Record<string, any>,
) {
  for (const [k, v] of Object.entries(object)) {
    svg[field](k, v);
  }
}

export const ARROW_TIP_DELTA = 4;

// The default stroke color for a theme.
export function defaultStroke(theme: "light" | "dark") {
  return theme === "light" ? "#222" : "#FFF";
}

// The default fill color for a theme.
export function defaultFill(theme: "light" | "dark") {
  return theme === "light" ? "#FFF" : "#1A1A1A";
}

// Color for optimal rules
export const OPTIMAL_HIGHLIGHT_COLOR = "#44e00040";

// Color for suboptimal rules
export const SUBOPTIMAL_HIGHLIGHT_COLOR = "#ff666645";

// Some text.
export class Text extends Node2D {
  value: string;
  attrs: Record<string, any>;
  styles: Record<string, any>;
  eventHandlers: Record<string, any>;

  constructor(
    value: string = "",
    attrs: Record<string, any> = {},
    styles: Record<string, any> = {},
    eventHandlers: Record<string, any> = {},
  ) {
    super();
    this.value = value;
    this.attrs = attrs;
    this.styles = styles;
    this.eventHandlers = eventHandlers;
  }

  override renderSelf(
    pos: Pos,
    theme: "light" | "dark",
    debug = false,
  ): SVG | null {
    const svg = d3
      .create("svg:text")
      .text(this.value)
      .attr("x", pos.x)
      .attr("y", pos.y)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", defaultStroke(theme))
      .style("font-size", "20px")
      .attr("font-family", "Libertinus")
      .attr("pointer-events", "none");
    applyEntries(svg, "attr", this.attrs);
    applyEntries(svg, "style", this.styles);
    applyEntries(svg, "on", this.eventHandlers);
    return svg;
  }
}

// A rectangle.
export class Rect extends Node2D {
  width: number;
  height: number;
  rx: number;
  ry: number;
  attrs: Record<string, any>;
  styles: Record<string, any>;
  eventHandlers: Record<string, any>;

  constructor(
    width: number,
    height: number,
    rx: number = 0,
    ry: number = 0,
    attrs: Record<string, any> = {},
    styles: Record<string, any> = {},
    eventHandlers: Record<string, any> = {},
  ) {
    super();
    this.width = width;
    this.height = height;
    this.rx = rx;
    this.ry = ry;
    this.attrs = attrs;
    this.styles = styles;
    this.eventHandlers = eventHandlers;
  }

  override renderSelf(
    pos: Pos,
    theme: "light" | "dark",
    debug = false,
  ): SVG | null {
    const svg = d3
      .create("svg:rect")
      .attr("x", pos.x)
      .attr("y", pos.y)
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("rx", this.rx)
      .attr("ry", this.ry)
      .attr("fill", defaultFill(theme))
      .attr("stroke", defaultStroke(theme))
      .attr("stroke-width", DEFAULT_LINE_WIDTH);
    applyEntries(svg, "attr", this.attrs);
    applyEntries(svg, "style", this.styles);
    applyEntries(svg, "on", this.eventHandlers);
    return svg;
  }
}

// A circle.
export class Circle extends Node2D {
  radius: number;
  attrs: Record<string, any>;
  styles: Record<string, any>;
  eventHandlers: Record<string, any>;

  constructor(
    radius: number,
    attrs: Record<string, any> = {},
    styles: Record<string, any> = {},
    eventHandlers: Record<string, any> = {},
  ) {
    super();
    this.radius = radius;
    this.attrs = attrs;
    this.styles = styles;
    this.eventHandlers = eventHandlers;
  }

  override renderSelf(
    pos: Pos,
    theme: "light" | "dark",
    debug = false,
  ): SVG | null {
    const svg = d3
      .create("svg:circle")
      .attr("r", this.radius)
      .attr("cx", pos.x)
      .attr("cy", pos.y)
      .attr("fill", defaultFill(theme))
      .attr("stroke", defaultStroke(theme))
      .attr("stroke-width", DEFAULT_LINE_WIDTH);
    applyEntries(svg, "attr", this.attrs);
    applyEntries(svg, "style", this.styles);
    applyEntries(svg, "on", this.eventHandlers);
    return svg;
  }
}

// A path.
export class Path extends Node2D {
  path: d3.Path;
  attrs: Record<string, any>;
  styles: Record<string, any>;
  eventHandlers: Record<string, any>;
  translate = true;

  constructor(
    path: d3.Path = d3.path(),
    attrs: Record<string, any> = {},
    styles: Record<string, any> = {},
    eventHandlers: Record<string, any> = {},
  ) {
    super();
    this.path = path;
    this.attrs = attrs;
    this.styles = styles;
    this.eventHandlers = eventHandlers;
    this.attrs["stroke-linejoin"] = "round";
  }

  override renderSelf(
    pos: Pos,
    theme: "light" | "dark",
    debug = false,
  ): SVG | null {
    const svg = d3
      .create("svg:path")
      .attr("d", this.path.toString())
      .attr("fill", "none")
      .attr("stroke", defaultStroke(theme))
      .attr("stroke-width", DEFAULT_LINE_WIDTH);
    if (this.translate) {
      svg.attr("transform", `translate(${pos.x}, ${pos.y})`);
    }
    applyEntries(svg, "attr", this.attrs);
    applyEntries(svg, "style", this.styles);
    applyEntries(svg, "on", this.eventHandlers);
    return svg;
  }
}

// A label.
export class Label extends Node2D {
  public static readonly SIZE = 15;
  public static readonly SIZE_HIGHLIGHT = 18;

  text: Text;
  mainRect: Rect;
  highlightRect: Rect;

  constructor(label: string = "") {
    super();
    this.text = new Text(label);
    this.text.zIndex = 3;

    // TODO: SCALE RECT TO TEXT SIZE
    // const tempSVG = this.text.renderSelf();
    // var bbox = tempSVG.getBBox(); // or getComputedTextLength()
    // var width = bbox.width;
    // var height = bbox.height;

    this.mainRect = new Rect(
      Label.SIZE * 2,
      Label.SIZE * 2,
      Label.SIZE,
      Label.SIZE,
      {},
      { stroke: "none" },
    );
    this.mainRect.zIndex = 1;
    this.mainRect.pos.x = -Label.SIZE;
    this.mainRect.pos.y = -Label.SIZE;

    this.highlightRect = new Rect(
      Label.SIZE_HIGHLIGHT * 2,
      Label.SIZE_HIGHLIGHT * 2,
      Label.SIZE_HIGHLIGHT,
      Label.SIZE_HIGHLIGHT,
      { stroke: "none", display: "none" },
    );
    this.highlightRect.zIndex = 2;
    this.highlightRect.pos.x = -18;
    this.highlightRect.pos.y = -18;

    this.add(this.mainRect);
    this.add(this.highlightRect);
    this.add(this.text);

    this.bounds = {
      min: { x: -D, y: -D },
      max: { x: D, y: D },
    };
  }

  override renderSelf(pos: Pos, theme: "light" | "dark", debug?: boolean) {
    this.highlightRect.attrs = {
      ...this.highlightRect.attrs,
      fill: OPTIMAL_HIGHLIGHT_COLOR,
    };
  }
}

export const DEFAULT_LINE_WIDTH = 1;
export const SHAPE_LINE_WIDTH = 1.4;

// 8 ports equally distributed around the circle
export type Port =
  | "n" // north
  | "ne" // north-east
  | "e" // east
  | "se" // south-east
  | "s" // south
  | "sw" // south-west
  | "w" // weast
  | "nw"; // north-west

// A simple edge between two points, with optional bezier control points.
export class Edge extends Node2D {
  public static readonly PORT_SCALE = 35;

  start: Pos;
  end: Pos;
  startPort?: Port;
  endPort?: Port;
  // Optional click handler
  onClick?: () => void;
  // Used to link a bound variable with its abstraction-application edge redex,
  // for highlighting the bound variables when hovering over the redex.
  className = "";

  mainPath: Path;
  highlightPath: Path;

  constructor(
    start: Pos,
    end: Pos,
    startPort?: Port,
    endPort?: Port,
    onClick?: () => void,
  ) {
    super();

    this.start = start;
    this.end = end;
    this.startPort = startPort;
    this.endPort = endPort;
    this.onClick = onClick;

    this.mainPath = new Path(d3.path());
    this.mainPath.zIndex = 0;
    this.add(this.mainPath);

    this.highlightPath = new Path(d3.path());
    this.highlightPath.zIndex = 2;
    this.add(this.highlightPath);
  }

  portOffset(port: Port, s: number): Pos {
    if (port === "n") {
      return { x: 0, y: -s };
    } else if (port === "ne") {
      return { x: Math.SQRT1_2 * s, y: -Math.SQRT1_2 * s };
    } else if (port === "e") {
      return { x: s, y: 0 };
    } else if (port === "se") {
      return { x: Math.SQRT1_2 * s, y: Math.SQRT1_2 * s };
    } else if (port === "s") {
      return { x: 0, y: s };
    } else if (port === "sw") {
      return { x: -Math.SQRT1_2 * s, y: Math.SQRT1_2 * s };
    } else if (port === "w") {
      return { x: -s, y: 0 };
    } else {
      return { x: -Math.SQRT1_2 * s, y: -Math.SQRT1_2 * s }; // port === "nw"
    }
  }

  override renderSelf(
    pos: Pos,
    theme: "light" | "dark",
    debug = false,
  ): SVG | null {
    // Create path based on start and end points
    const path = d3.path();
    const deltaStart = this.startPort
      ? this.portOffset(this.startPort, Edge.PORT_SCALE)
      : undefined;
    const deltaEnd = this.endPort
      ? this.portOffset(this.endPort, Edge.PORT_SCALE)
      : undefined;
    path.moveTo(this.start.x, this.start.y);
    if (deltaStart !== undefined || deltaEnd !== undefined) {
      path.bezierCurveTo(
        this.start.x + (deltaStart?.x ?? 0),
        this.start.y + (deltaStart?.y ?? 0),
        this.end.x + (deltaEnd?.x ?? 0),
        this.end.y + (deltaEnd?.y ?? 0),
        this.end.x,
        this.end.y,
      );
    } else {
      path.lineTo(this.end.x, this.end.y);
    }

    // Update the main Path
    this.mainPath.path = path;

    if (this.onClick) {
      this.highlightPath.path = path;
      this.highlightPath.attrs = {
        stroke: OPTIMAL_HIGHLIGHT_COLOR,
        "stroke-width": "36px",
        "stroke-linecap": "round",
      };
      this.highlightPath.eventHandlers = {
        click: this.onClick,
        touchend: this.onClick,
        mousedown: function () {
          d3.select(this as any).attr("stroke-width", "36px");
        },
        mouseup: function () {
          d3.select(this as any).attr("stroke-width", "40px");
        },
        mouseover: function () {
          d3.select(this as any)
            .attr("stroke-width", "40px")
            .attr("cursor", "pointer");
        },
        mouseout: function () {
          d3.select(this as any).attr("stroke-width", "36px");
        },
        ...this.highlightPath.eventHandlers,
      };
    }
  }
}

// A function enclosure, used by the Naive method.
export class Enclosure extends Node2D {
  vars: Label[];

  constructor(bounds: Bounds, vars: Label[]) {
    super();
    this.bounds = bounds;
    this.vars = vars;
  }

  override renderSelf(
    pos: Pos,
    theme: "light" | "dark",
    debug = false,
  ): SVG | null {
    const newChildren: Node2D[] = [];
    if (this.vars.length > 0) {
      const globalPos = this.globalPosition();
      // Get the right-most variable
      const maxX = this.vars.reduce((acc, v) => {
        const varGlobalPos = v.globalPosition();
        const relativePos = {
          x: varGlobalPos.x - globalPos.x,
          y: varGlobalPos.y - globalPos.y,
        };
        return relativePos.x > acc ? relativePos.x : acc;
      }, -Infinity);
      // Draw left-side enclosure
      const leftSide = new Path();
      leftSide.path.moveTo(0, 0);
      leftSide.path.arcTo(
        this.bounds.min.x,
        0,
        this.bounds.min.x,
        this.bounds.max.y,
        Wire.CORNER_RADIUS,
      );
      leftSide.path.arcTo(
        this.bounds.min.x,
        this.bounds.max.y,
        0,
        this.bounds.max.y,
        Wire.CORNER_RADIUS,
      );
      leftSide.path.lineTo(maxX - Wire.CORNER_RADIUS, this.bounds.max.y);
      newChildren.push(leftSide);
      // Draw right-side enclosure
      const rightSide = new Path();
      rightSide.attrs = { "stroke-dasharray": "4,6" };
      rightSide.path.moveTo(0, 0);
      rightSide.path.arcTo(
        this.bounds.max.x,
        0,
        this.bounds.max.x,
        this.bounds.max.y,
        Wire.CORNER_RADIUS,
      );
      rightSide.path.arcTo(
        this.bounds.max.x,
        this.bounds.max.y,
        this.bounds.min.x,
        this.bounds.max.y,
        Wire.CORNER_RADIUS,
      );
      rightSide.path.lineTo(maxX, this.bounds.max.y);
      newChildren.push(rightSide);

      // Draw vertical lines under each bound variable
      this.vars.forEach((v) => {
        const varGlobalPos = v.globalPosition();
        const relativePos = {
          x: varGlobalPos.x - globalPos.x,
          y: varGlobalPos.y - globalPos.y,
        };
        const varPath = new Path();
        varPath.path.moveTo(relativePos.x, relativePos.y);
        varPath.path.arcTo(
          relativePos.x,
          this.bounds.max.y,
          this.bounds.min.x,
          this.bounds.max.y,
          Wire.CORNER_RADIUS,
        );
        newChildren.push(varPath);
      });
    } // No variables - draw full dashed enclosure
    else {
      const rect = new Rect(
        this.getWidth(),
        this.getHeight(),
        Wire.CORNER_RADIUS,
        Wire.CORNER_RADIUS,
      );
      rect.attrs = { fill: "none", "stroke-dasharray": "4,6" };
      rect.pos.x = this.bounds.min.x;
      rect.pos.y = this.bounds.min.y;
      newChildren.push(rect);
    }
    this.children = newChildren;
  }
}

// Minimal distance, mostly used in inets methods
export const D = 12;

// A fan is a triangle-shaped interaction net agent with one principal port and two auxiliary ports.
export class Fan extends Node2D {
  public static readonly WIDTH = 5 * D;
  public static readonly HEIGHT = 3 * D;

  // A port delta of 2 makes it so that a stack of fans doesn't result in any curved wires
  public static readonly PORT_DELTA = 2 * D;

  type: "up" | "down";
  text: Text;
  path: Path;

  constructor(type: "up" | "down", label: string = "") {
    super();
    this.type = type;
    this.text = new Text(label);
    this.path = new Path();
    this.path.attrs["stroke-width"] = SHAPE_LINE_WIDTH;
    const path = this.path.path;
    if (type === "up") {
      this.text.pos.y = 0.7 * Fan.HEIGHT;
      path.moveTo(0, 0);
      path.lineTo(Fan.WIDTH / 2, Fan.HEIGHT);
      path.lineTo(-Fan.WIDTH / 2, Fan.HEIGHT);
      path.lineTo(0, 0);
      path.closePath();
    } else {
      this.text.pos.y = 0.4 * Fan.HEIGHT;
      path.moveTo(-Fan.WIDTH / 2, 0);
      path.lineTo(Fan.WIDTH / 2, 0);
      path.lineTo(0, Fan.HEIGHT);
      path.lineTo(-Fan.WIDTH / 2, 0);
      path.closePath();
    }
    this.add(this.path);
    this.add(this.text);
    this.bounds = {
      min: { x: -3 * D, y: -D },
      max: { x: 3 * D, y: Fan.HEIGHT + D },
    };
  }

  portDelta(i: number): number {
    if (i === 0) {
      return -Fan.PORT_DELTA;
    } else {
      return Fan.PORT_DELTA;
    }
  }
}

// A fin is an interaction net agent with one principal port at the top and one auxiliary port at the bottom.
export class Fin extends Node2D {
  // Fin is equilateral
  public static readonly WIDTH = 12;
  public static readonly HEIGHT = (Math.sqrt(3) * Fin.WIDTH) / 2;

  type: "up" | "down";
  scopeType: "+" | "-" | undefined;
  fv: boolean;
  text: Text;
  path: Path;

  constructor(
    type: "up" | "down",
    scopeType: "+" | "-" | undefined,
    fv: boolean,
    label: string = "",
  ) {
    super();
    this.type = type;
    this.scopeType = scopeType;
    this.fv = fv;
    this.text = new Text(/* fv ? "" :  */ label);
    this.text.pos.y = 0.7 * Fin.HEIGHT;
    this.path = new Path();
    const path = this.path.path;
    if (type === "up") {
      this.text.pos.y = 0.7 * Fin.HEIGHT;
      path.moveTo(0, 0);
      path.lineTo(Fin.WIDTH / 2, Fin.HEIGHT);
      path.lineTo(-Fin.WIDTH / 2, Fin.HEIGHT);
      path.lineTo(0, 0);
      path.closePath();
    } else {
      this.text.pos.y = 0.4 * Fin.HEIGHT;
      path.moveTo(-Fin.WIDTH / 2, 0);
      path.lineTo(Fin.WIDTH / 2, 0);
      path.lineTo(0, Fin.HEIGHT);
      path.lineTo(-Fin.WIDTH / 2, 0);
      path.closePath();
    }
    this.text.pos.x = Fin.WIDTH + 2;
    this.add(this.text);
    this.add(this.path);
    this.bounds = {
      min: { x: -D, y: -D / 2 },
      max: { x: 2 * D, y: Fin.HEIGHT + D / 2 },
    };
  }

  override renderSelf(pos: Pos, theme: "light" | "dark", debug?: boolean) {
    this.path.attrs.fill = this.fv
      ? "#0F0"
      : this.scopeType === undefined
      ? defaultStroke(theme)
      : this.scopeType === "+"
      ? "#F00"
      : "#00F";
    this.path.attrs["stroke-width"] = 0.4;
  }
}

// An eraser is a circle with a cross inside.
export class Eraser extends Node2D {
  // This way an eraser fits snugly when connected to a fan
  // i.e. it never horizontally overflows the fan's horizontal span
  public static readonly RADIUS = Fan.WIDTH / 2 - Fan.PORT_DELTA;

  circle: Circle;
  path: Path;

  constructor() {
    super();

    // Create the circle
    this.circle = new Circle(Eraser.RADIUS);
    this.circle.attrs["stroke-width"] = SHAPE_LINE_WIDTH;
    this.circle.zIndex = 1;
    this.add(this.circle);

    // Create an X inside the circle
    this.path = new Path();
    this.path.attrs["stroke-width"] = SHAPE_LINE_WIDTH;
    this.path.zIndex = 1;
    const path = this.path.path;
    const delta = Math.cos(Math.PI / 4) * Eraser.RADIUS;
    path.moveTo(-delta, -delta);
    path.lineTo(delta, delta);
    path.moveTo(delta, -delta);
    path.lineTo(-delta, delta);
    this.add(this.path);

    // Set the bounds
    this.bounds = {
      min: { x: -1 * D, y: -1 * D },
      max: { x: 1 * D, y: 1 * D },
    };
  }
}

// A root is a circle.
export class Root extends Node2D {
  public static readonly RADIUS = Eraser.RADIUS;

  circle: Circle;

  constructor() {
    super();

    // Create the circle
    this.circle = new Circle(Eraser.RADIUS);
    this.circle.attrs["stroke-width"] = SHAPE_LINE_WIDTH;
    this.circle.zIndex = 1;
    this.add(this.circle);

    // Set the bounds
    this.bounds = {
      min: { x: -1 * D, y: -1 * D },
      max: { x: 1 * D, y: 1 * D },
    };
  }
}

// A wire (vertical-horizontal-vertical) whose endpoints are connected to nodes (and defined by their offsets from the nodes).
// The position of this node is ignored.
export class Wire extends Node2D {
  public static readonly CORNER_RADIUS = D;

  start: Node2D;
  end: Node2D;
  viaY: number; // The Y coordinate of the wire's horizontal section, relative to start.y
  startOffset: Pos = { x: 0, y: 0 };
  endOffset: Pos = { x: 0, y: 0 };
  arrowStart: boolean = false;
  arrowEnd: boolean = false;

  // Optional click handler
  onClick?: () => void;

  mainPath: Path;

  // Highlight path for clicking the wire and triggering e.g. an interaction/reduction
  highlightPath: Path;
  highlightColor?: string;

  // A colored highlight path for indicating the wire level
  colorPath: Path;
  color?: string;

  constructor(
    start: Node2D,
    end: Node2D,
    viaY: number,
    onClick?: () => void,
    color?: string,
  ) {
    super();
    this.start = start;
    this.end = end;
    this.viaY = viaY;
    this.onClick = onClick;

    this.mainPath = new Path(d3.path());
    this.mainPath.translate = false;
    this.mainPath.zIndex = 0;
    this.mainPath.attrs["pointer-events"] = "none";
    this.add(this.mainPath);

    this.highlightPath = new Path(d3.path());
    this.highlightPath.translate = false;
    this.highlightPath.zIndex = 2;
    this.add(this.highlightPath);

    this.colorPath = new Path(d3.path());
    this.colorPath.translate = false;
    this.colorPath.zIndex = 1;
    this.add(this.colorPath);
    this.color = color;
  }

  override renderSelf(
    pos: Pos,
    theme: "light" | "dark",
    debug = false,
  ): SVG | null {
    // Create path based on start and end points
    // For now we're just drawing a straight line (TODO: improve)
    const path = d3.path();
    const globalStart = this.start.globalPosition();
    const globalEnd = this.end.globalPosition();
    const startX = globalStart.x + this.startOffset.x;
    const startY = globalStart.y + this.startOffset.y;
    const endX = globalEnd.x + this.endOffset.x;
    const endY = globalEnd.y + this.endOffset.y;
    const viaY = startY + this.viaY;

    if (this.arrowStart) {
      this.mainPath.attrs["marker-start"] = "url(#arrowStart)";
    }
    if (this.arrowEnd) {
      this.mainPath.attrs["marker-end"] = "url(#arrowEnd)";
    }

    path.moveTo(startX, startY);
    if (
      (Math.abs(viaY > startY ? viaY - startY : startY - viaY),
        Math.abs(endY > viaY ? endY - viaY : viaY - endY),
        Math.abs(endX > startX ? endX - startX : startX - endX) / 2) <
        Wire.CORNER_RADIUS
    ) {
      // Draw bezier curve
      if (startX !== endX) {
        const halfway = startY + (endY - startY) / 2;
        path.bezierCurveTo(startX, halfway, endX, halfway, endX, endY);
      } else {
        path.lineTo(endX, endY);
      }
    } else {
      path.arcTo(startX, viaY, endX, viaY, Wire.CORNER_RADIUS);
      path.arcTo(endX, viaY, endX, endY, Wire.CORNER_RADIUS);
      path.lineTo(endX, endY);
    }

    // Update the main Path
    this.mainPath.path = path;

    if (this.color !== undefined) {
      this.colorPath.path = path;
      this.colorPath.attrs = {
        stroke: this.color,
        "stroke-width": "5px",
        "stroke-linecap": "butt",
      };
      this.colorPath.zIndex = theme === "light" ? -1 : 1;
    }

    if (this.onClick) {
      this.highlightPath.path = path;
      this.highlightPath.attrs = {
        stroke: this.highlightColor ?? OPTIMAL_HIGHLIGHT_COLOR,
        "stroke-width": "36px",
        "stroke-linecap": "round",
      };
      this.highlightPath.eventHandlers = {
        click: this.onClick,
        touchend: this.onClick,
        mousedown: function () {
          d3.select(this as any).attr("stroke-width", "36px");
        },
        mouseup: function () {
          d3.select(this as any).attr("stroke-width", "40px");
        },
        mouseover: function () {
          d3.select(this as any)
            .attr("stroke-width", "40px")
            .attr("cursor", "pointer");
        },
        mouseout: function () {
          d3.select(this as any).attr("stroke-width", "36px");
        },
        ...this.highlightPath.eventHandlers,
      };
    }
  }
}

// A replicator is a triangle-shaped interaction net agent with one principal port and any number of auxiliary ports.
// Each auxiliary port has a integer associated with it, called a "level delta".
export class Replicator extends Node2D {
  public static readonly AUX_WIDTH = 2 * D; // The width of each auxiliary port
  public static readonly HEIGHT = Fan.HEIGHT + this.AUX_WIDTH;

  type: "up" | "down";
  text: Text;
  levelDeltaTexts: Text[];
  path: Path;
  levelDeltas: number[];

  constructor(
    type: "up" | "down",
    label: string = "",
    levelDeltas: number[],
    height = Replicator.HEIGHT,
  ) {
    super();
    this.type = type;
    this.text = new Text(label);
    this.levelDeltaTexts = [];
    this.path = new Path();
    this.levelDeltas = levelDeltas;

    const xd = (Replicator.AUX_WIDTH * levelDeltas.length) / 2;

    this.path.attrs["stroke-width"] = SHAPE_LINE_WIDTH;
    const path = this.path.path;
    if (type === "up") {
      this.text.pos.y = 0.65 * (height - Replicator.AUX_WIDTH);
      path.moveTo(0, 0);
      path.lineTo(xd, height - Replicator.AUX_WIDTH);
      path.lineTo(-xd, height - Replicator.AUX_WIDTH);
      path.lineTo(0, 0);
      path.moveTo(-xd, height - Replicator.AUX_WIDTH);
      path.lineTo(-xd, height);
      path.lineTo(xd, height);
      path.lineTo(xd, height - Replicator.AUX_WIDTH);
      for (let i = 0; i < levelDeltas.length; i++) {
        path.moveTo(
          -xd + i * Replicator.AUX_WIDTH,
          height - Replicator.AUX_WIDTH,
        );
        path.lineTo(-xd + i * Replicator.AUX_WIDTH, height);
        const levelDeltaText = new Text(
          levelDeltas[levelDeltas.length - 1 - i].toString(),
        );
        levelDeltaText.styles["font-size"] = "16px";
        this.levelDeltaTexts.push(levelDeltaText);
        levelDeltaText.pos.x = -xd + i * Replicator.AUX_WIDTH +
          0.5 * Replicator.AUX_WIDTH;
        levelDeltaText.pos.y = height - 0.45 * Replicator.AUX_WIDTH;
        this.add(levelDeltaText);
      }
      path.closePath();
    } else {
      this.text.pos.y = Replicator.AUX_WIDTH +
        0.4 * (height - Replicator.AUX_WIDTH);
      path.moveTo(-xd, Replicator.AUX_WIDTH);
      path.lineTo(xd, Replicator.AUX_WIDTH);
      path.lineTo(0, height);
      path.lineTo(-xd, Replicator.AUX_WIDTH);
      path.moveTo(-xd, Replicator.AUX_WIDTH);
      path.lineTo(-xd, 0);
      path.lineTo(xd, 0);
      path.lineTo(xd, Replicator.AUX_WIDTH);
      for (let i = 0; i < levelDeltas.length; i++) {
        path.moveTo(-xd + i * Replicator.AUX_WIDTH, Replicator.AUX_WIDTH);
        path.lineTo(-xd + i * Replicator.AUX_WIDTH, 0);
        const levelDeltaText = new Text(levelDeltas[i].toString());
        levelDeltaText.styles["font-size"] = "16px";
        this.levelDeltaTexts.push(levelDeltaText);
        levelDeltaText.pos.x = -xd + i * Replicator.AUX_WIDTH +
          0.5 * Replicator.AUX_WIDTH;
        levelDeltaText.pos.y = 0.55 * Replicator.AUX_WIDTH;
        this.add(levelDeltaText);
      }

      path.closePath();
    }
    this.add(this.path);
    this.add(this.text);
    this.bounds = {
      min: { x: -(levelDeltas.length / 2) * Replicator.AUX_WIDTH - D, y: -D },
      max: {
        x: (levelDeltas.length / 2) * Replicator.AUX_WIDTH + D,
        y: height + D,
      },
    };
  }

  portDelta(i: number): number {
    return (i + 0.5 - this.levelDeltas.length / 2) * Replicator.AUX_WIDTH;
  }
}

// A fae is a triangle-shaped interaction net agent with one principal port and any number of auxiliary ports.
// TODO: make min width like Fan and a Fan-width Fae can have two or three aux ports. For more ports, make it wider by AUX_WIDTH.
export class Fae extends Node2D {
  public static readonly AUX_WIDTH = 2 * D; // The width of each auxiliary port
  public static readonly HEIGHT = Fan.HEIGHT;

  type: "up" | "down";
  length: number;
  text: Text;
  path: Path;

  constructor(type: "up" | "down", label: string = "", length: number) {
    super();
    this.type = type;
    this.length = length;
    this.text = new Text(label);
    this.path = new Path();

    const xd = (Fae.AUX_WIDTH * length) / 2;

    this.path.attrs["stroke-width"] = SHAPE_LINE_WIDTH;
    const path = this.path.path;
    if (type === "up") {
      this.text.pos.y = 0.65 * (Fae.HEIGHT);
      path.moveTo(0, 0);
      path.lineTo(xd, Fae.HEIGHT);
      path.lineTo(-xd, Fae.HEIGHT);
      path.lineTo(0, 0);
      path.closePath();
    } else {
      this.text.pos.y = 0.4 * (Fae.HEIGHT);
      path.moveTo(-xd, 0);
      path.lineTo(xd, 0);
      path.lineTo(0, Fae.HEIGHT);
      path.lineTo(-xd, 0);
      path.closePath();
    }
    this.add(this.path);
    this.add(this.text);
    this.bounds = {
      min: { x: -(length / 2) * Fae.AUX_WIDTH - D, y: -D },
      max: {
        x: (length / 2) * Fae.AUX_WIDTH + D,
        y: Fae.HEIGHT + D,
      },
    };
  }

  portDelta(i: number): number {
    return (i + 0.5 - this.length / 2) * Replicator.AUX_WIDTH;
  }
}

// A twine is a sequence of boxes, each with an integer and a pointer (and arrow point out of the box to another twine).
// The integer represents the level of the pointed-to twine. As such, a twine's level is stored in all of the twines which point to it.
export class Twine extends Node2D {
  public static readonly SIZE = 2 * D; // The size of each box
  public static readonly PADDING = D / 3; // The padding around the twine

  type: "horizontal" | "vertical" = "horizontal";
  levels: (string | null)[]; // null means no pointer (i.e. an eraser)
  labelLeft?: string;
  labelRight?: string;
  labelLeftText?: Text;
  labelRightText?: Text;
  path: Path;
  innerRect: Rect;
  outerRect: Rect;
  highlightRect: Rect;
  color?: string;

  // Optional click handler
  onClick?: () => void;

  constructor(
    levels: (string | null)[],
    labelLeft?: string,
    labelRight?: string,
    type: "horizontal" | "vertical" = "horizontal",
    color?: string,
    deltas?: number[],
  ) {
    super();
    this.type = type;
    this.levels = levels;
    this.labelLeft = labelLeft;
    this.labelRight = labelRight;
    this.color = color;
    this.path = new Path();
    this.path.attrs["stroke-width"] = DEFAULT_LINE_WIDTH;
    this.path.attrs["pointer-events"] = "none";
    const path = this.path.path;

    const xd = (Twine.SIZE * levels.length) / 2;

    // Create LHS label if one was provided
    if (labelLeft) {
      this.labelLeftText = new Text(labelLeft);
      this.labelLeftText.styles["font-size"] = "16px";
      this.labelLeftText.styles["text-anchor"] = "end";
      this.labelLeftText.styles["opacity"] = 0.6;
      this.labelLeftText.pos.x = -8;
      this.labelLeftText.pos.y = -0.5 * Twine.SIZE;
      this.add(this.labelLeftText);
    }

    // Create RHS label if one was provided
    if (labelRight) {
      this.labelRightText = new Text(labelRight);
      this.labelRightText.styles["font-size"] = "16px";
      this.labelRightText.styles["text-anchor"] = "start";
      this.labelRightText.styles["opacity"] = 0.6;
      this.labelRightText.pos.x = 8;
      this.labelRightText.pos.y = -0.5 * Twine.SIZE;
      this.add(this.labelRightText);
    }

    const longOuterSide = Twine.SIZE * levels.length + 2 * Twine.PADDING;
    const shortOuterSide = Twine.SIZE + 2 * Twine.PADDING;

    // Create highlight rectangle (outer than outer)
    const highlightAddition = Twine.SIZE;
    this.highlightRect = new Rect(
      (type === "horizontal" ? longOuterSide : shortOuterSide) +
        highlightAddition,
      (type === "horizontal" ? shortOuterSide : longOuterSide) +
        highlightAddition,
      6,
      6,
      { display: "none" },
    );
    this.highlightRect.pos.x =
      (type === "horizontal"
        ? -Twine.PADDING - xd
        : -0.5 * (Twine.SIZE + levels.length * Twine.PADDING)) -
      highlightAddition / 2;
    this.highlightRect.pos.y = -highlightAddition / 2;
    this.add(this.highlightRect);

    // Create the outer rectangle
    this.outerRect = new Rect(
      type === "horizontal" ? longOuterSide : shortOuterSide,
      type === "horizontal" ? shortOuterSide : longOuterSide,
      4,
      4,
      { fill: "none", "pointer-events": "none" },
    );
    this.outerRect.pos.x = type === "horizontal"
      ? -Twine.PADDING - xd
      : -0.5 * (Twine.SIZE + levels.length * Twine.PADDING);
    this.add(this.outerRect);

    // Create the inner rectangle
    const longInnerSide = Twine.SIZE * levels.length;
    const shortInnerSide = Twine.SIZE;
    const innerRectRoundedness = 2;
    this.innerRect = new Rect(
      type === "horizontal" ? longInnerSide : shortInnerSide,
      type === "horizontal" ? shortInnerSide : longInnerSide,
      innerRectRoundedness,
      innerRectRoundedness,
      {
        fill: "none",
        "pointer-events": "none",
      },
    );
    this.innerRect.pos.x = type === "horizontal" ? -xd : -0.5 * Twine.SIZE;
    this.innerRect.pos.y = Twine.PADDING;
    this.add(this.innerRect);

    for (let i = 0; i < levels.length; i++) {
      if (i > 0) {
        if (type === "horizontal") {
          path.moveTo(-xd + i * Twine.SIZE, Twine.SIZE + Twine.PADDING);
          path.lineTo(-xd + i * Twine.SIZE, Twine.PADDING);
        } else {
          path.moveTo(-0.5 * Twine.SIZE, Twine.PADDING + i * Twine.SIZE);
          path.lineTo(0.5 * Twine.SIZE, Twine.PADDING + i * Twine.SIZE);
        }
      }

      if (levels[i] === null) {
        const c = innerRectRoundedness / 4;
        if (type === "horizontal") {
          path.moveTo(-xd + i * Twine.SIZE + c, Twine.SIZE + Twine.PADDING - c);
          path.lineTo(-xd + (i + 1) * Twine.SIZE - c, Twine.PADDING + c);
          path.moveTo(-xd + i * Twine.SIZE + c, Twine.PADDING + c);
          path.lineTo(
            -xd + (i + 1) * Twine.SIZE - c,
            Twine.SIZE + Twine.PADDING - c,
          );
        } else {
          path.moveTo(
            -0.5 * Twine.SIZE + c,
            Twine.PADDING + i * Twine.SIZE + c,
          );
          path.lineTo(
            0.5 * Twine.SIZE - c,
            Twine.PADDING + (i + 1) * Twine.SIZE - c,
          );
          path.moveTo(
            -0.5 * Twine.SIZE + c,
            Twine.PADDING + (i + 1) * Twine.SIZE - c,
          );
          path.lineTo(0.5 * Twine.SIZE - c, Twine.PADDING + i * Twine.SIZE + c);
        }
      } else {
        const levelText = new Text(levels[i]!);
        levelText.styles["font-size"] = "16px";

        if (type === "horizontal") {
          levelText.pos.x = -xd + i * Twine.SIZE + 0.5 * Twine.SIZE;
          levelText.pos.y = 0.55 * Twine.SIZE + Twine.PADDING;
        } else {
          levelText.pos.x = 0;
          levelText.pos.y = Twine.PADDING + i * Twine.SIZE + 0.55 * Twine.SIZE;
        }
        this.add(levelText);
      }
    }

    this.add(this.path);
    if (type === "horizontal") {
      this.bounds = {
        min: {
          x: -xd - Twine.PADDING - (Twine.SIZE / 2 - Twine.PADDING),
          y: -(Twine.SIZE / 2 - Twine.PADDING),
        },
        max: {
          x: xd + Twine.PADDING + (Twine.SIZE / 2 - Twine.PADDING),
          y: Twine.SIZE + 2 * Twine.PADDING + (Twine.SIZE / 2 - Twine.PADDING),
        },
      };
    } else {
      this.bounds = {
        min: {
          x: -Twine.SIZE / 2 - Twine.PADDING - (Twine.SIZE / 2 - Twine.PADDING),
          y: -(Twine.SIZE / 2 - Twine.PADDING),
        },
        max: {
          x: Twine.SIZE / 2 + Twine.PADDING + (Twine.SIZE / 2 - Twine.PADDING),
          y: Twine.SIZE * levels.length +
            Twine.PADDING * 2 +
            (Twine.SIZE / 2 - Twine.PADDING),
        },
      };
    }
  }

  override renderSelf(pos: Pos, theme: "light" | "dark", debug?: boolean) {
    this.innerRect.attrs["fill"] = defaultFill(theme);
    this.outerRect.attrs["stroke"] = "none";
    if (this.color) {
      const opacity = theme === "light" ? "FF" : "CC";
      this.outerRect.attrs["fill"] = this.color + opacity;
    }

    if (this.onClick) {
      this.highlightRect.attrs = {
        stroke: "none",
        fill: OPTIMAL_HIGHLIGHT_COLOR,
      };

      const hX = this.highlightRect.globalPosition().x;
      const hY = this.highlightRect.globalPosition().y;
      const hWidth = this.highlightRect.width;
      const hHeight = this.highlightRect.height;

      const hXBig = hX - Twine.PADDING / 2;
      const hYBig = hY - Twine.PADDING / 2;
      const hWidthBig = hWidth + Twine.PADDING;
      const hHeightBig = hHeight + Twine.PADDING;

      this.highlightRect.eventHandlers = {
        click: this.onClick,
        touchend: this.onClick,
        mousedown: function () {
          d3.select(this as any)
            .attr("x", hX)
            .attr("y", hY)
            .attr("width", hWidth)
            .attr("height", hHeight);
        },
        mouseup: function () {
          d3.select(this as any)
            .attr("x", hXBig)
            .attr("y", hYBig)
            .attr("width", hWidthBig)
            .attr("height", hHeightBig);
        },
        mouseover: function () {
          d3.select(this as any)
            .attr("x", hXBig)
            .attr("y", hYBig)
            .attr("width", hWidthBig)
            .attr("height", hHeightBig)
            .attr("cursor", "pointer");
        },
        mouseout: function () {
          d3.select(this as any)
            .attr("x", hX)
            .attr("y", hY)
            .attr("width", hWidth)
            .attr("height", hHeight);
        },
        ...this.highlightRect.eventHandlers,
      };
    }
  }

  portDelta(i: number): number {
    return (i + 0.5 - this.levels.length / 2) * Twine.SIZE;
  }
}

// Colors
export const palette = {
  blue: "#4e79a7",
  orange: "#f28e2c",
  red: "#e15659",
  teal: "#76b7b2",
  green: "#59a14f",
  yellow: "#edc948",
  purple: "#b07aa1",
  pink: "#ff9da7",
  brown: "#9c755f",
  grey: "#bab0ac",
};
