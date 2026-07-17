// Make the built CLI/MCP entrypoints executable so `npm link` global symlinks
// keep working across rebuilds (tsc --build emits 0644 and drops the +x bit).
// chmodSync is a no-op on platforms without POSIX permissions, so this is safe
// to run everywhere.
import { chmodSync } from 'node:fs';

const bins = [
  'packages/cli/dist/bin/flyway.js',
  'packages/mcp/dist/bin/flyway-mcp.js',
];

for (const bin of bins) {
  try {
    chmodSync(bin, 0o755);
  } catch (err) {
    // Not fatal — the file may not exist yet if a package wasn't built.
    console.warn(`postbuild: could not chmod ${bin}: ${err.message}`);
  }
}
