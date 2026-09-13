// Vitest runs everything in Node, so there's no real client/server bundle
// split to enforce here — this stub keeps the "server-only" import working
// in tests without pulling in the package's browser-condition throw.
export {};
