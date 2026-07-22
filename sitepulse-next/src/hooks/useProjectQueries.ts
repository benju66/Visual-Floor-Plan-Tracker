// ==== The data-layer barrel (Frontend Structure W3 — split complete, P3–P5) ====
// This file was the 1,555-line data-layer god-file; it is now a pure re-export
// barrel. Every domain lives in its own file under ./projectQueries/ and is
// re-exported here so all importers keep resolving from
// '@/hooks/useProjectQueries' (or the relative './useProjectQueries') unchanged —
// `export *` carries values AND types. Add new data hooks in the matching domain
// file (or a new one + an export line here), never inline in this file again.
export * from './projectQueries/shared';
export * from './projectQueries/project';
export * from './projectQueries/contacts';
export * from './projectQueries/history';
export * from './projectQueries/sheets';
export * from './projectQueries/units';
export * from './projectQueries/walkSequence';
export * from './projectQueries/activities';
export * from './projectQueries/applicability';
export * from './projectQueries/statuses';
