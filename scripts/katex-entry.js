// Entry for dist/bre.katex.umd.js — exposes KaTeX as window.__BRE_KATEX__ for the UMD core loader.
import katex from 'katex';
(typeof window !== 'undefined' ? window : globalThis).__BRE_KATEX__ = katex;
