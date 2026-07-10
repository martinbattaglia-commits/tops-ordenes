import type { Punctuator } from "../types";

/** Identidad. normalize() hace el resto, y corre siempre. */
export const nonePunctuator: Punctuator = {
  id: "none",
  apply: (text) => Promise.resolve(text),
};
