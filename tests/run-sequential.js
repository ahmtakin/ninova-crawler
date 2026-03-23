#!/usr/bin/env node
/**
 * Sequential Test Runner
 *
 * Runs all test files sequentially to avoid mock interference.
 * This is a workaround for the node:test parallel execution model.
 */

const { execSync } = require('child_process');
const { glob } = require('glob');
const path = require('path');

const testFiles = glob.sync('**/*.test.js', {
  cwd: path.join(__dirname, '..'),
  absolute: false
}).map(f => path.join('..', f));

let totalPassed = 0;
let totalFailed = 0;
const failedFiles = [];

console.log(`Running ${testFiles.length} test files sequentially...\n`);

for (const testFile of testFiles) {
  process.stdout.write(`\x1b[36m${testFile}\x1b[0m... `);

  try {
    const output = execSync(`node --test ${testFile}`, {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Parse output for pass/fail counts
    const match = output.match(/# pass (\d+)\n# fail (\d+)/);
    if (match) {
      const passed = parseInt(match[1], 10);
      const failed = parseInt(match[2], 10);

      totalPassed += passed;
      totalFailed += failed;

      if (failed > 0) {
        console.log(`\x1b[31m✗\x1b[0m ${passed} passed, ${failed} failed`);
        failedFiles.push({ file: testFile, passed, failed, output });
      } else {
        console.log(`\x1b[32m✓\x1b[0m ${passed} passed`);
      }
    } else {
      console.log('\x1b[33m?\x1b[0m (could not parse results)');
    }

  } catch (error) {
    // Test execution failed
    console.log(`\x1b[31m✗\x1b[0m execution failed`);
    failedFiles.push({ file: testFile, error: error.message });
  }
}

console.log(`\n\x1b[1mResults:\x1b[0m`);
console.log(`Total tests: ${totalPassed + totalFailed}`);
console.log(`\x1b[32mPassed: ${totalPassed}\x1b[0m`);
console.log(`\x1b[31mFailed: ${totalFailed}\x1b[0m`);

if (failedFiles.length > 0) {
  console.log(`\n\x1b[31mFailed test files:\x1b[0m`);
  for (const { file, passed, failed } of failedFiles) {
    console.log(`  ${file} (${passed || 0} passed, ${failed || 0} failed)`);
  }
  process.exit(1);
} else {
  console.log('\x1b[32m\nAll tests passed!\x1b[0m');
  process.exit(0);
}
