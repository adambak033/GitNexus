/**
 * Prepare script: build TypeScript and install husky hooks.
 * Uses Node child_process so it works on Windows (cmd.exe) and POSIX.
 */
const { execSync } = require('child_process');
const path = require('path');

// 1. Build
execSync('npm run build', { stdio: 'inherit', cwd: __dirname + '/..' });

// 2. Install husky (from repo root — one level up from gitnexus/)
try {
  execSync('npx husky', { stdio: 'inherit', cwd: path.resolve(__dirname, '../..') });
} catch {
  // Husky install is optional — may fail in CI or tarball installs
}
