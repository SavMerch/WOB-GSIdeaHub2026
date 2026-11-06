// ---------------------------------------------------------------------
// Brand configuration — Witt O'Brien's
// ---------------------------------------------------------------------
// Logo files live in /public/brand. Colors are defined as CSS tokens in
// src/index.css (the @theme block). To apply the official brand-guide
// values, change the hex codes there; everything else follows.
// ---------------------------------------------------------------------
export const BRAND = {
  organization: "Witt O'Brien's",
  parent: "Part of the Ambipar Group",
  logoDark: "/brand/witt-obriens-logo-dark.png", // for light backgrounds
  logoLight: "/brand/witt-obriens-logo-white.png", // for dark backgrounds
  logoAlt: "Witt O'Brien's — Part of the Ambipar Group",
} as const;
