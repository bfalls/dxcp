import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const impl = require("./style.cjs") as {
  detectCapabilities: (opts?: {
    isTTY?: boolean;
    env?: NodeJS.ProcessEnv;
    term?: string;
  }) => { color: boolean; unicode: boolean };
  detectColorLevel: (opts?: {
    isTTY?: boolean;
    env?: NodeJS.ProcessEnv;
    term?: string;
    colorTerm?: string;
  }) => ColorLevel;
  detectSymbolMode: (opts?: {
    isTTY?: boolean;
    env?: NodeJS.ProcessEnv;
    term?: string;
    locale?: string;
  }) => SymbolMode;
  makeSymbols: (mode: SymbolMode) => SymbolSet;
  wrap: (text: string, open: string, close?: string) => string;
  reset: () => string;
  ansi16Fg: (code: number) => string;
  ansi256Fg: (n: number) => string;
  truecolorFg: (r: number, g: number, b: number) => string;
  bold: () => string;
  dim: () => string;
  makeTheme: (level: ColorLevel, symbols?: SymbolSet) => Theme;
};

export type ColorLevel = 0 | 1 | 2 | 3;
export type SymbolMode = "unicode" | "ascii";

export type SymbolSet = {
  info: "[i]";
  step: string;
  substep: string;
  success: string;
  fail: string;
};

export type Theme = {
  level: ColorLevel;
  symbolMode: SymbolMode;
  symbolMap: SymbolSet;
  symbols: {
    info: string;
    step: string;
    substep: string;
    success: string;
    fail: string;
  };
  title: (text: string) => string;
  info: (text: string) => string;
  step: (text: string) => string;
  substep: (text: string) => string;
  success: (text: string) => string;
  fail: (text: string) => string;
};

export const detectColorLevel = impl.detectColorLevel;
export const detectCapabilities = impl.detectCapabilities;
export const detectSymbolMode = impl.detectSymbolMode;
export const makeSymbols = impl.makeSymbols;
export const wrap = impl.wrap;
export const reset = impl.reset;
export const ansi16Fg = impl.ansi16Fg;
export const ansi256Fg = impl.ansi256Fg;
export const truecolorFg = impl.truecolorFg;
export const bold = impl.bold;
export const dim = impl.dim;
export const makeTheme = impl.makeTheme;
