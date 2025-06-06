import { batch, Signal, useSignal, useSignalEffect } from "@preact/signals";
import { Graph as LambdaGraph } from "./Graph.tsx";
import { Head, IS_BROWSER } from "$fresh/runtime.ts";
import { AstNode, parseSource } from "../lib/ast.ts";
import IconArrowBarToLeft from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-bar-to-left.tsx";
import IconArrowLeft from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-left.tsx";
import IconArrowRight from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-right.tsx";
import IconArrowBarRight from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-bar-right.tsx";
import IconArrowRightBar from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-right-bar.tsx";
import IconArrowRightToArc from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-right-to-arc.tsx";
import IconArrowsRight from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrows-right.tsx";
import IconArrowBarToRight from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-bar-to-right.tsx";
import IconArrowDown from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-down.tsx";
import IconArrowsDown from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrows-down.tsx";
import IconArrowBarToDown from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrow-bar-to-down.tsx";
import IconFocusCentered from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/focus-centered.tsx";
import IconBorderCorners from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/border-corners.tsx";
import IconWindowMaximize from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/window-maximize.tsx";
import IconWindowMinimize from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/window-minimize.tsx";
import IconArrowsMaximize from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrows-maximize.tsx";
import IconArrowsMinimize from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/arrows-minimize.tsx";
import IconLayoutColumns from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/layout-columns.tsx";
import IconLayoutRows from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/layout-rows.tsx";
import IconMaximize from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/maximize.tsx";
import IconDownload from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/download.tsx";
import IconBug from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/bug.tsx";
import IconBugOff from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/bug-off.tsx";
import IconTarget from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/target.tsx";
import IconTargetOff from "https://deno.land/x/tabler_icons_tsx@0.0.7/tsx/target-off.tsx";
import { cleanExpr, prettifyExpr } from "../lib/util.ts";
import { Node2D, Pos, render } from "../lib/render.ts";
import { useEffect, useRef } from "preact/hooks";
import loader, { type Monaco } from "@monaco-editor/loader";
import examples from "../lib/examples.ts";
import { METHODS, MethodState } from "../lib/methods/index.ts";

// Title of the app
const TITLE = "Interactive λ-Reduction";

// Prevent auto zooming beyond this scale (larger number = more zoomed in)
const MAX_AUTO_SCALE = 1.5;

// The minimum pane size
const MIN_PANE_SIZE = 200;

export default function App() {
  // DEPRECATED - remove when possible
  const lastExpression = useSignal<string>("");

  // Expression has error
  const exprError = useSignal<boolean>(false);

  // Reduction method
  const storedMethod = IS_BROWSER && window.localStorage.getItem("method");
  const method = useSignal<string>(storedMethod || Object.keys(METHODS)[0]);
  const subMethod = useSignal<"l" | "a" | "i" | "k">("k");

  // Theme
  const storedTheme = IS_BROWSER && window.localStorage.getItem("theme");
  const theme = useSignal<"light" | "dark">(
    (storedTheme as "light" | "dark") || "dark",
  );

  const storedEditorWidth = IS_BROWSER &&
    window.localStorage.getItem("editorWidth");
  const editorWidth = useSignal<number>(parseFloat(storedEditorWidth || "500"));

  // AST
  const ast = useSignal<AstNode | null>(null);

  // Scene to render
  const scene = useSignal<Node2D | null>(null);

  // Whether to automatically center the graph
  const storedCenter = IS_BROWSER && window.localStorage.getItem("center");
  const center = useSignal<boolean>(storedCenter === "true");

  // Whether to render debugging helpers
  const storedDebug = IS_BROWSER && window.localStorage.getItem("debug");
  const debug = useSignal<boolean>(storedDebug === "true");

  // Graph translation and scale
  const translate = useSignal<Pos>({ x: 0, y: 0 });
  const scale = useSignal<number>(1);

  // Keep track of first load to make sure we always center on first load
  const isFirstLoad = useSignal<boolean>(true);

  // Keep track of whether the splitter is being dragged
  const isDraggingSplitter = useSignal<boolean>(false);

  // Reference to the code editor
  const codeEditorRef = useRef<any>(null);

  // Initialize Monaco editor
  useEffect(() => {
    (loader as any).init().then((monaco: Monaco) => {
      // Initialize the editor content with the source code stored in local storage or the starter example if local storage is empty
      const source = window.localStorage.getItem("source") ?? examples[0].code;

      // Create code editor
      codeEditorRef.current = monaco.editor.create(
        document.getElementById("editor")!,
        {
          value: source,
          // Elixir syntax highlighting works perfectly for our purposes
          language: "elixir",
          fontSize: 17,
          theme: theme.value === "light" ? "vs" : "vs-dark",
          minimap: {
            enabled: false,
          },
          lineNumbersMinChars: 2,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          dimension: {
            height: window.innerHeight - 44 - 3 * 8 - 2,
            width: editorWidth.value,
          },
        },
      );

      // Update AST based on the initial expression
      // This is done after the editor is created to center the graph on first load
      updateAst(source);

      // Listen for changes to the editor content
      codeEditorRef.current.onDidChangeModelContent((e: any) => {
        if (codeEditorRef.current === null) {
          return;
        }
        // Set isFirstLoad to true to force centering when user types (nice-to-have)
        isFirstLoad.value = true;
        // Update the AST based on the new expression
        updateAst(codeEditorRef.current.getValue());
      });

      // Replace backslashes with lambdas
      codeEditorRef.current.onKeyDown((e: any) => {
        if (e.keyCode === monaco.KeyCode.Backslash) {
          // Intercept the backslash key
          e.preventDefault(); // Prevent the default key behavior

          const selection = codeEditorRef.current.getSelection(); // Get the current selection
          const range = new monaco.Range(
            selection.startLineNumber,
            selection.startColumn,
            selection.endLineNumber,
            selection.endColumn,
          );

          // Replace the selection (if exists) with the 'λ' character
          codeEditorRef.current.executeEdits("", [
            {
              range: range,
              text: "λ",
              forceMoveMarkers: true,
            },
          ]);

          // Optionally move the cursor after the inserted character
          codeEditorRef.current.setPosition({
            lineNumber: range.endLineNumber,
            column: range.startColumn + 1,
          });
        }
      });
    });

    // Set up keyboard listeners for arrow keys to trigger back / forward
    const onKey = (e: any) => {
      if (
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "INPUT"
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "ArrowLeft") {
        if (e.getModifierState("Shift")) {
          METHODS[method.value].state.value?.reset?.();
        } else {
          METHODS[method.value].state.value?.back?.();
        }
      } else if (e.code === "ArrowRight") {
        if (e.getModifierState("Control")) {
          METHODS[method.value].state.value?.forwardParallel?.();
        } else if (e.getModifierState("Shift")) {
          METHODS[method.value].state.value?.last?.();
        } else {
          METHODS[method.value].state.value?.forward?.();
        }
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
    };
  }, []);

  const updateAst = (source: string) => {
    window.localStorage.setItem("source", source);

    // Clear graph if empty expression
    if (source.length === 0) {
      scene.value = null;
      return;
    }

    // Update AST
    const newAst = parseSource(source);
    // Update AST or exprError
    if (newAst === undefined || newAst.errs !== undefined) {
      exprError.value = true;
      // Show parsing errors in the console if any (only if expression changed)
      console.warn("Parsing Error(s):", newAst?.errs);
    } else {
      batch(() => {
        exprError.value = false;
        ast.value = newAst.ast ?? null;
      });
    }
  };

  // Initialize `METHODS` signals for all methods with the provided AST
  const initializeStates = (astValue: AstNode | null) => {
    if (astValue === null) {
      return;
    }
    batch(() =>
      Object.keys(METHODS).forEach((m) => {
        METHODS[m].state.value = METHODS[m].init(astValue);
      })
    );
  };

  // Initialize `METHODS` signals (for all methods) when `ast` changes
  // `ast` -> `METHODS`
  useSignalEffect(() => initializeStates(ast.value));

  // Update `scene` when `METHODS` or `method` changes
  // (`METHODS`, `method`) -> `scene`
  useSignalEffect(() => {
    // Note: inside each `render` call below, callbacks may be set up that update the state of the current method.
    // signal when e.g. the user clicks on highlighted edges.
    // There are also callbacks that update `scene` and `expression` directly.

    // Clear scene if current state is null
    const currentMethod = METHODS[method.value];
    const currentState = currentMethod.state;
    if (currentState.value === null) {
      scene.value = null;
      return;
    }

    // Log current state
    const stateStack = currentState.value.stack;
    console.log(
      `${currentMethod.name} (${currentState.value.idx}/${
        stateStack.length - 1
      }):`,
      stateStack[currentState.value.idx],
    );

    // Render graph and update scene
    const node2D = currentMethod.render(
      currentState as Signal<MethodState<any>>,
      lastExpression,
    );
    scene.value = node2D;
  });

  const centerGraph = (node2D: Node2D) => {
    const graphEl = document.getElementById("graph")!;
    const rect = graphEl.getBoundingClientRect();
    const s = Math.min(
      rect.width / node2D.getWidth(),
      rect.height / node2D.getHeight(),
    );
    batch(() => {
      scale.value = Math.min(s, MAX_AUTO_SCALE);
      translate.value = { x: -node2D.bounds.min.x, y: -node2D.bounds.min.y };
      isFirstLoad.value = false;
    });
  };

  // Center graph when scene changes if auto-centering is enabled or if on first load
  useSignalEffect(() => {
    const node2D = scene.value;
    if (node2D !== null && (center.value || isFirstLoad.peek())) {
      centerGraph(node2D);
    }
  });

  // Rerender when `scene` or `theme` changes.
  // (`scene`, `theme`) -> render()
  useSignalEffect(() => {
    if (scene.value === null) {
      return;
    }
    const zSVGs = scene.value.render(theme.value, debug.value);
    const SVGs = render(zSVGs);
    document.getElementById("root")!.replaceChildren(...SVGs);
  });

  // Set up callbacks
  useEffect(() => {
    // Resize the editor when the window size changes
    const handleResize = () => {
      if (codeEditorRef.current !== null) {
        const newEditorWidth = Math.min(
          Math.max(editorWidth.value, MIN_PANE_SIZE),
          (window.innerWidth - MIN_PANE_SIZE) - 3 * 8 - 4,
        );
        editorWidth.value = newEditorWidth;
        window.localStorage.setItem("editorWidth", newEditorWidth.toString());
        codeEditorRef.current.layout({
          height: window.innerHeight - 44 - 3 * 8 - 2,
          width: newEditorWidth,
        });
      }
    };
    addEventListener("resize", handleResize);

    // Resize the editor when the mouse moves and is dragging the splitter
    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingSplitter.value) {
        const newEditorWidth = Math.min(
          Math.max(e.clientX - 8 - 6, MIN_PANE_SIZE),
          (window.innerWidth - MIN_PANE_SIZE) - 3 * 8 - 4,
        );
        editorWidth.value = newEditorWidth;
        window.localStorage.setItem("editorWidth", newEditorWidth.toString());
        codeEditorRef.current.layout({
          height: window.innerHeight - 44 - 3 * 8 - 2,
          width: newEditorWidth,
        });

        // Recenter graph if center is enabled
        if (center.value) {
          centerGraph(scene.peek()!);
        }
      }
    };
    addEventListener("mousemove", onMouseMove);

    const onMouseUp = () => {
      isDraggingSplitter.value = false;
    };
    addEventListener("mouseup", onMouseUp);

    return () => {
      removeEventListener("resize", handleResize);
      removeEventListener("mousemove", onMouseMove);
      removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Change the editor theme when the theme changes
  useSignalEffect(() => {
    const newTheme = theme.value;
    if (codeEditorRef.current !== null) {
      codeEditorRef.current.updateOptions({
        theme: newTheme === "light" ? "default" : "vs-dark",
      });
    }
  });

  const squareButtonClass =
    `border-1 rounded p-2 text-xl min-h-[44px] min-w-[44px] bg-inherit flex flex-row justify-center items-center disabled:opacity-[0.4] disabled:cursor-not-allowed hover:bg-[${
      theme.value === "light" ? "white" : "#2A2A2A"
    }] disabled:bg-transparent`;

  const toolbar = (
    <div
      class="flex flex-row bg-inherit gap-[8px]"
      style={{
        overflowX: "scroll",
        scrollbarWidth: "none",
      }}
    >
      <select
        onChange={(e) => {
          const newMethod = (e?.target as HTMLSelectElement).value;
          window.localStorage.setItem("method", newMethod);
          batch(() => {
            method.value = newMethod;
            // Set isFirstLoad to true to force centering when method changes
            isFirstLoad.value = true;
          });
        }}
        tabIndex={-1}
        onFocus={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        value={method.value}
        class="border-1 rounded px-1 text-xl min-h-[44px] bg-inherit flex-1"
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
          background: theme.value === "light" ? "white" : "#1A1A1A",
        }}
      >
        {Object.entries(METHODS).map(([methodKey, methodData]) => (
          <option key={methodKey} value={methodKey}>
            {methodData.name}
          </option>
        ))}
      </select>
      <select
        // This select is just an indicator in the lambda calculus method
        disabled={method.value === "lambdacalc"}
        onChange={(e) => {
          // const newMethod = (e?.target as HTMLSelectElement).value;
          // window.localStorage.setItem("method", newMethod);
          // batch(() => {
          //   method.value = newMethod;
          //   // Set isFirstLoad to true to force centering when method changes
          //   isFirstLoad.value = true;
          // });
        }}
        tabIndex={-1}
        onFocus={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        value={subMethod.value}
        class="border-1 rounded px-1 text-xl min-h-[44px] bg-inherit"
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
          background: theme.value === "light" ? "white" : "#1A1A1A",
        }}>
        <option value="l">Linear (L)</option>
        <option value="a">Affine (A)</option>
        <option value="i">Relevant (I)</option>
        <option value="k">Full (K)</option>
      </select>
      {method.value === "deltanets" && <select
        class="border-1 rounded px-1 text-xl min-h-[44px] bg-inherit"
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
          background: theme.value === "light" ? "white" : "#1A1A1A",
        }}>
        <option value="l">3 Agents (default)</option>
        <option value="a">Single-agent</option>
      </select>}
      {method.value === "deltanets" && <select
        class="border-1 rounded px-1 text-xl min-h-[44px] bg-inherit"
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
          background: theme.value === "light" ? "white" : "#1A1A1A",
        }}>
        <option value="l">Absolute levels (default)</option>
        <option value="a">Relative levels</option>
      </select>}
      <select
        onChange={(e) => {
          const selectedExampleIndex = parseInt(
            (e?.target as HTMLSelectElement).value,
          );
          const newCode = examples[selectedExampleIndex].code;

          // Prevent the selected item from changing (we're using this <select> as a dropdown menu)
          (e?.target as HTMLSelectElement).value = "examples";

          // Trigger centering (but store original value)
          const originalCenter = center.peek();
          center.value = true;

          // Update the editor content
          if (codeEditorRef.current !== null) {
            codeEditorRef.current.setValue(newCode);
          }

          // Update expression and AST
          updateAst(newCode);

          // Reset centering
          center.value = originalCenter;
        }}
        class={`border-1 rounded px-1 text-xl min-h-[44px] bg-inherit w-[120px] bg-transparent hover:bg-[${
          theme.value === "light" ? "white" : "#2A2A2A"
        }] disabled:bg-transparent`}
        style={{
          borderColor: theme.value === "light" ? "#FAFAFA" : "#222",
        }}
      >
        <option
          value="examples"
          disabled
          selected
          style={{ display: "none" }}
        >
          Examples
        </option>
        {examples.map((ex, i) => (
          <option value={i}>
            {ex.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        title="Return to the beginning. Keyboard shortcut: Shift + left arrow key."
        class={squareButtonClass}
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
        onClick={METHODS[method.value].state.value?.reset}
        disabled={!METHODS[method.value].state.value?.reset}
      >
        <IconArrowBarToLeft />
      </button>
      <button
        type="button"
        title="Step backwards in history. Keyboard shortcut: left arrow key."
        class={squareButtonClass}
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
        onClick={METHODS[method.value].state.value?.back}
        disabled={!METHODS[method.value].state.value?.back}
      >
        <IconArrowLeft />
      </button>
      <div
        class="border-0 rounded text-xl min-h-[44px] bg-inherit flex flex-row justify-center items-end font-mono p-1"
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
      >
        {METHODS[method.value].state.value?.idx ?? 0}/
        {METHODS[method.value].state.value?.stack?.length
          ? METHODS[method.value].state.value?.stack?.length! - 1
          : 0}
      </div>
      <button
        type="button"
        title="Step forward in history or, if no history available, apply a new reduction if possible. In the λ-calculus method, redexes are applied in normal order. Keyboard shortcut: right arrow key."
        class={squareButtonClass}
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
        onClick={METHODS[method.value].state.value?.forward}
        disabled={!METHODS[method.value].state.value?.forward}
      >
        {METHODS[method.value].state.value?.idx! <
            METHODS[method.value].state.value?.stack.length! - 1
          ? <IconArrowRight />
          : <IconArrowRightToArc />}
      </button>
      <button
        type="button"
        title="Go to the last step in the history. Keyboard shortcut: Shift + right arrow key."
        class={squareButtonClass}
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
        onClick={METHODS[method.value].state.value?.last}
        disabled={!METHODS[method.value].state.value?.last}
      >
        <IconArrowBarToRight />
      </button>
      <button
        type="button"
        title={`Toggle auto-centering (currently ${
          center.value ? "ON" : "OFF"
        })`}
        class={squareButtonClass}
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
        onClick={() => {
          const newCenter = !center.peek();
          window.localStorage.setItem("center", newCenter ? "true" : "false");
          center.value = newCenter;
        }}
      >
        {center.value ? <IconFocusCentered /> : <IconMaximize />}
      </button>
      <button
        type="button"
        title="Download SVG of the current graph"
        class={squareButtonClass}
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
        onClick={() => {
          // Store current theme and debug value
          const currTheme = theme.peek();
          const currDebug = debug.peek();
          // Switch to light theme and debug-mode-off for exporting
          theme.value = "light";
          debug.value = false;
          // Get svg element and serialize
          const svg = document.getElementById("root");
          const serializer = new XMLSerializer();
          let source = serializer.serializeToString(svg as any);
          // Revert to previous theme and debug mode
          theme.value = currTheme;
          debug.value = currDebug;
          // Compute viewBox
          const s = scene.peek()!;
          const width = s.getWidth();
          const height = s.getHeight();
          // TODO: use s.bounds.min.y
          const viewBox =
            `${s.bounds.min.x} ${s.bounds.min.y} ${width} ${height}`;
          // Add XML and SVG boilerplate
          source =
            `<?xml version="1.0"?>\r\n<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" version="1.1">` +
            source +
            "</svg>";
          // Convert source to URI data scheme.
          const url = "data:image/svg+xml;charset=utf-8," +
            encodeURIComponent(source);
          // Download
          const downloadLink = document.createElement("a");
          downloadLink.href = url;
          downloadLink.download = "lambda.svg";
          downloadLink.click();
        }}
      >
        <IconDownload />
      </button>
      <button
        type="button"
        title={`Toggle visual debugging helpers (currently ${
          debug.value ? "ON" : "OFF"
        })`}
        class={squareButtonClass}
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
        onClick={() => {
          const newDebug = !debug.peek();
          window.localStorage.setItem("debug", newDebug ? "true" : "false");
          debug.value = newDebug;
        }}
      >
        {debug.value ? <IconBug /> : <IconBugOff />}
      </button>
      <a
        class={squareButtonClass}
        style={{
          borderColor: theme.value === "light" ? "#000D" : "#FFF6",
        }}
        href="https://github.com/danaugrs/deltanets"
        target={"_blank"}
        rel="noopener noreferrer"
      >
        <GitHubIcon />
      </a>
      <button
        type="button"
        title={`Toggle theme (currently ${theme.value})`}
        class={squareButtonClass}
        style={{ borderColor: theme.value === "light" ? "#000D" : "#FFF6" }}
        onClick={() => {
          if (theme.value === "light") {
            theme.value = "dark";
            window.localStorage.setItem("theme", "dark");
          } else {
            theme.value = "light";
            window.localStorage.setItem("theme", "light");
          }
        }}
      >
        {theme.value === "light" ? <DarkThemeIcon /> : <LightThemeIcon />}
      </button>
    </div>
  );

  return (
    <>
      <Head>
        <title>{TITLE}</title>
      </Head>
      <div
        id="main"
        class="w-screen h-[100dvh] p-2 flex flex-col gap-[8px]"
        style={{
          color: theme.value === "light" ? "#000D" : "#FFFD",
          background: theme.value === "light" ? "#FAFAFA" : "#222",
          // fontFamily: "Optima, Candara, 'Noto Sans', source-sans-pro, sans-serif",
          // fontFamily: "NewComputerModern",
          // fontFamily: "Inter",
          fontFamily: "OpenSans",
        }}
      >
        {toolbar}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
            flex: 1,
          }}
        >
          <div
            id="editor-container"
            class="border-1 rounded"
            style={{
              overflow: "hidden",
              borderColor: theme.value === "light" ? "#000D" : "#FFF6",
            }}
          >
            <div id="editor"></div>
          </div>
          <div
            id="splitter"
            class={`hover:(bg-[${
              theme.value === "light" ? "white" : "#2A2A2A"
            }] cursor-ew-resize)`}
            style={{ width: "8px" }}
            onDragStart={(e) => {
              e.preventDefault();
              isDraggingSplitter.value = true;
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingSplitter.value = true;
            }}
          />
          <div class="flex-1">
            <LambdaGraph
              theme={theme.value}
              translate={translate}
              scale={scale}
              center={center}
            />
          </div>
        </div>
      </div>
    </>
  );
}

const GitHubIcon = () => {
  return (
    <svg width="24" height="24" fill="currentColor" viewBox="3 3 18 18">
      <title>GitHub</title>
      <path d="M12 3C7.0275 3 3 7.12937 3 12.2276C3 16.3109 5.57625 19.7597 9.15374 20.9824C9.60374 21.0631 9.77249 20.7863 9.77249 20.5441C9.77249 20.3249 9.76125 19.5982 9.76125 18.8254C7.5 19.2522 6.915 18.2602 6.735 17.7412C6.63375 17.4759 6.19499 16.6569 5.8125 16.4378C5.4975 16.2647 5.0475 15.838 5.80124 15.8264C6.51 15.8149 7.01625 16.4954 7.18499 16.7723C7.99499 18.1679 9.28875 17.7758 9.80625 17.5335C9.885 16.9337 10.1212 16.53 10.38 16.2993C8.3775 16.0687 6.285 15.2728 6.285 11.7432C6.285 10.7397 6.63375 9.9092 7.20749 9.26326C7.1175 9.03257 6.8025 8.08674 7.2975 6.81794C7.2975 6.81794 8.05125 6.57571 9.77249 7.76377C10.4925 7.55615 11.2575 7.45234 12.0225 7.45234C12.7875 7.45234 13.5525 7.55615 14.2725 7.76377C15.9937 6.56418 16.7475 6.81794 16.7475 6.81794C17.2424 8.08674 16.9275 9.03257 16.8375 9.26326C17.4113 9.9092 17.76 10.7281 17.76 11.7432C17.76 15.2843 15.6563 16.0687 13.6537 16.2993C13.98 16.5877 14.2613 17.1414 14.2613 18.0065C14.2613 19.2407 14.25 20.2326 14.25 20.5441C14.25 20.7863 14.4188 21.0746 14.8688 20.9824C16.6554 20.364 18.2079 19.1866 19.3078 17.6162C20.4077 16.0457 20.9995 14.1611 21 12.2276C21 7.12937 16.9725 3 12 3Z">
      </path>
    </svg>
  );
};

const DarkThemeIcon = () => (
  <svg
    fill="none"
    viewBox="2 2 20 20"
    width="16"
    height="16"
    stroke="currentColor"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      fill="currentColor"
      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
    >
    </path>
  </svg>
);

const LightThemeIcon = () => (
  <svg
    fill="none"
    viewBox="3 3 18 18"
    width="16"
    height="16"
    stroke="currentColor"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      fill="currentColor"
      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
    >
    </path>
  </svg>
);
