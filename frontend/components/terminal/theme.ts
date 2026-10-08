import type { ITheme } from "@xterm/xterm";

export const TERMINAL_FONT =
  '"JetBrains Mono", "Cascadia Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** Deep-navy palette that sits well inside both the light and dark glass UI. */
export const TERMINAL_THEME: ITheme = {
  background: "#0f1624",
  foreground: "#d6dfec",
  cursor: "#7ea6ff",
  cursorAccent: "#0f1624",
  selectionBackground: "#3b6cff55",
  selectionInactiveBackground: "#3b6cff2e",
  black: "#1b2434",
  red: "#ff6b70",
  green: "#4fd18b",
  yellow: "#f2c063",
  blue: "#6f9bff",
  magenta: "#c49cff",
  cyan: "#5fd4e6",
  white: "#d6dfec",
  brightBlack: "#5d6b82",
  brightRed: "#ff8a8e",
  brightGreen: "#74e3a6",
  brightYellow: "#f7d48a",
  brightBlue: "#93b4ff",
  brightMagenta: "#d6b8ff",
  brightCyan: "#8ce3f0",
  brightWhite: "#f4f7fb",
};
