import * as core from '@actions/core';
import { execFileSync } from 'child_process';
import * as path from 'path';

import type { ValidateResult } from './gen/validate_result';
import type { RunTestsResult } from './gen/run_tests_result';

// Internal representations the rest of this file consumes. Decoupled from
// the wire formats so an upstream rename or removal breaks the mappers at
// compile time, rather than silently propagating to the runtime code below.
// Mirrors the discriminated union shape of the wire schema so downstream
// code can switch on `status` with TS narrowing the variant.

type ValidateFile =
  | { status: 'Valid'; filePath: string; warning: string | undefined }
  | { status: 'Invalid'; filePath: string; error: string; warning: string | undefined }
  | { status: 'ExecutionError'; filePath: string; error: string };

interface ValidateOutput {
  files: ValidateFile[];
}

interface RunTestsTestResult {
  name: string;
  passed: boolean;
}

type RunTestsFile =
  | { status: 'Passed'; filePath: string; warning: string | undefined; tests: RunTestsTestResult[] }
  | { status: 'TestsFailed'; filePath: string; warning: string | undefined; tests: RunTestsTestResult[] }
  | { status: 'Invalid'; filePath: string; error: string; warning: string | undefined }
  | { status: 'ExecutionError'; filePath: string; error: string };

interface RunTestsOutput {
  files: RunTestsFile[];
}

function toValidateOutput(wire: ValidateResult): ValidateOutput {
  return {
    files: wire.files.map((f): ValidateFile => {
      switch (f.status) {
        case 'Valid':
          return {
            status: 'Valid',
            filePath: f.file_path,
            warning: f.warning ?? undefined,
          };
        case 'Invalid':
          return {
            status: 'Invalid',
            filePath: f.file_path,
            error: f.error,
            warning: f.warning ?? undefined,
          };
        case 'ExecutionError':
          return {
            status: 'ExecutionError',
            filePath: f.file_path,
            error: f.error,
          };
        default:
          throw new Error(`Unknown validate file status: ${String(f.status)}`);
      }
    }),
  };
}

function toRunTestsOutput(wire: RunTestsResult): RunTestsOutput {
  return {
    files: wire.files.map((f): RunTestsFile => {
      switch (f.status) {
        case 'Passed':
          return {
            status: 'Passed',
            filePath: f.file_path,
            warning: f.warning ?? undefined,
            tests: (f.tests ?? []).map((t) => ({
              name: t.name,
              passed: t.status === 'Passed',
            })),
          };
        case 'TestsFailed':
          return {
            status: 'TestsFailed',
            filePath: f.file_path,
            warning: f.warning ?? undefined,
            tests: f.tests.map((t) => ({
              name: t.name,
              passed: t.status === 'Passed',
            })),
          };
        case 'Invalid':
          return {
            status: 'Invalid',
            filePath: f.file_path,
            error: f.error,
            warning: f.warning ?? undefined,
          };
        case 'ExecutionError':
          return {
            status: 'ExecutionError',
            filePath: f.file_path,
            error: f.error,
          };
        default:
          throw new Error(`Unknown run-tests file status: ${String(f.status)}`);
      }
    }),
  };
}

// Best-effort extraction of line/column from a free-form error message so
// GitHub annotations link to the failing location. The CLI's error strings
// often embed e.g. `... at line: 12 column: 4`; if they don't, the annotation
// still renders, just at file scope.
function extractLineColumn(message: string): { line?: number; column?: number } {
  const lineMatches = [...message.matchAll(/line: (\d+)/g)];
  const columnMatches = [...message.matchAll(/column: (\d+)/g)];
  return {
    line: lineMatches.length > 0
      ? parseInt(lineMatches[lineMatches.length - 1][1])
      : undefined,
    column: columnMatches.length > 0
      ? parseInt(columnMatches[columnMatches.length - 1][1])
      : undefined,
  };
}

function splitList(input: string): string[] {
  return input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function buildTargetArgs(fileInput: string, dirInput: string, recursive: boolean): string[] {
  const args: string[] = [];

  const files = splitList(fileInput);
  for (const file of files) {
    args.push('-f', file);
  }

  const dirs = splitList(dirInput);
  for (const dir of dirs) {
    args.push('-d', dir);
  }
  if (dirs.length > 0 && recursive) {
    args.push('-r');
  }

  // Default to current directory if nothing was specified.
  if (files.length === 0 && dirs.length === 0) {
    args.push('-d', '.', '-r');
  }

  return args;
}

// `execFileSync`'s thrown error carries `stdout` / `stderr` properties that
// `@types/node` doesn't expose on `Error`, and the runtime can hand back a
// Buffer in some edge cases (e.g. when the child is killed by a signal
// before encoding takes effect). `asString` is the only place that decides
// what counts as a usable string — values that aren't `string` or `Buffer`
// are normalized to `''`, so an unsound shape can't escape into the return.
function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

// Runs scanner-cli with `--json`. `--json` guarantees structured stdout on
// both success and failure (rule-level failures); the process exits non-zero
// iff any file/test failed, which makes execFileSync throw with `error.stdout`
// populated. Pre-flight errors (missing CLI, bad inputs) skip the JSON path
// and surface on stderr — callers get `stdout: ''` and `threw: true` in that
// case, and should fall back to plain failure reporting.
function runCliJson(args: string[]): { stdout: string; threw: boolean; stderr: string } {
  // `execFileSync` (no shell) prevents shell-metacharacter injection from
  // `file` / `dir` inputs — each arg is passed verbatim to the binary's argv.
  try {
    const stdout = execFileSync('scanner-cli', args, { encoding: 'utf8' });
    return { stdout, threw: false, stderr: '' };
  } catch (error: unknown) {
    if (!(error instanceof Error)) {
      return { stdout: '', threw: true, stderr: '' };
    }
    // Errors are objects, so widening to a string-keyed `unknown` record is
    // sound. The runtime shape of `stdout` / `stderr` is then re-validated
    // by `asString` — no unchecked claims about their types.
    const extras = error as unknown as Record<string, unknown>;
    return {
      stdout: asString(extras.stdout),
      threw: true,
      stderr: asString(extras.stderr),
    };
  }
}

async function run(): Promise<void> {
  try {
    const checkAction = core.getInput('check_action');
    const apiUrl = core.getInput('scanner_api_url', { required: true });
    const apiKey = core.getInput('scanner_api_key', { required: true });
    const fileInput = core.getInput('file');
    const dirInput = core.getInput('dir');
    const recursive = core.getInput('recursive') === 'true';

    if (checkAction !== 'validate_only' && checkAction !== 'validate_and_run_tests') {
      throw new Error(
        `Invalid check_action: "${checkAction}". Must be "validate_only" or "validate_and_run_tests".`
      );
    }

    process.env.SCANNER_API_URL = apiUrl;
    process.env.SCANNER_API_KEY = apiKey;

    const targetArgs = buildTargetArgs(fileInput, dirInput, recursive);

    if (checkAction === 'validate_and_run_tests') {
      runTests(targetArgs);
    } else {
      runValidate(targetArgs);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${message}`);
  }
}

function annotateFileError(filePath: string, message: string): void {
  const relativePath = path.relative(process.cwd(), filePath);
  const { line, column } = extractLineColumn(message);
  core.error(message, {
    file: relativePath,
    startLine: line,
    startColumn: column,
  });
}

function annotateFileWarning(filePath: string, message: string): void {
  const relativePath = path.relative(process.cwd(), filePath);
  core.warning(message, { file: relativePath });
}

function runValidate(targetArgs: string[]): void {
  const args = ['validate', '--json', ...targetArgs];
  core.info(`Running: scanner-cli ${args.join(' ')}`);

  const { stdout, threw, stderr } = runCliJson(args);
  if (!stdout) {
    if (stderr) core.info(stderr);
    core.setFailed(stderr.trim() || 'scanner-cli validate failed');
    return;
  }

  let output: ValidateOutput;
  try {
    output = toValidateOutput(JSON.parse(stdout) as ValidateResult);
  } catch {
    core.info(stdout);
    core.setFailed('scanner-cli validate did not emit valid JSON');
    return;
  }

  let invalidCount = 0;
  let executionErrorCount = 0;
  for (const file of output.files) {
    switch (file.status) {
      case 'Valid':
        if (file.warning) annotateFileWarning(file.filePath, file.warning);
        break;
      case 'Invalid':
        if (file.warning) annotateFileWarning(file.filePath, file.warning);
        invalidCount += 1;
        annotateFileError(file.filePath, file.error);
        break;
      case 'ExecutionError':
        executionErrorCount += 1;
        annotateFileError(file.filePath, `Could not validate: ${file.error}`);
        break;
    }
  }

  if (threw || invalidCount > 0 || executionErrorCount > 0) {
    core.setFailed(buildFailureSummary({ invalidCount, executionErrorCount }));
    return;
  }

  core.info(`Validated ${output.files.length} file(s)`);
}

function buildFailureSummary(counts: {
  invalidCount: number;
  executionErrorCount: number;
  testFailures?: number;
}): string {
  const { invalidCount, executionErrorCount, testFailures = 0 } = counts;
  const parts: string[] = [];
  if (invalidCount > 0) {
    parts.push(`${invalidCount} file${invalidCount === 1 ? '' : 's'} failed validation`);
  }
  if (executionErrorCount > 0) {
    parts.push(
      `${executionErrorCount} file${executionErrorCount === 1 ? '' : 's'} could not be validated`
    );
  }
  if (testFailures > 0) {
    parts.push(`${testFailures} test${testFailures === 1 ? '' : 's'} failed`);
  }
  return parts.join('; ') || 'scanner-cli exited non-zero';
}

function runTests(targetArgs: string[]): void {
  const args = ['run-tests', '--json', ...targetArgs];
  core.info(`Running: scanner-cli ${args.join(' ')}`);

  const { stdout, threw, stderr } = runCliJson(args);
  if (!stdout) {
    if (stderr) core.info(stderr);
    core.setFailed(stderr.trim() || 'scanner-cli run-tests failed');
    return;
  }

  let output: RunTestsOutput;
  try {
    output = toRunTestsOutput(JSON.parse(stdout) as RunTestsResult);
  } catch {
    core.info(stdout);
    core.setFailed('scanner-cli run-tests did not emit valid JSON');
    return;
  }

  let invalidCount = 0;
  let executionErrorCount = 0;
  let testFailures = 0;
  let totalTests = 0;

  for (const file of output.files) {
    switch (file.status) {
      case 'Passed':
        if (file.warning) annotateFileWarning(file.filePath, file.warning);
        totalTests += file.tests.length;
        break;
      case 'TestsFailed':
        if (file.warning) annotateFileWarning(file.filePath, file.warning);
        totalTests += file.tests.length;
        for (const test of file.tests) {
          if (!test.passed) {
            testFailures += 1;
            annotateFileError(file.filePath, `Test failed: ${test.name}`);
          }
        }
        break;
      case 'Invalid':
        if (file.warning) annotateFileWarning(file.filePath, file.warning);
        invalidCount += 1;
        annotateFileError(file.filePath, file.error);
        break;
      case 'ExecutionError':
        executionErrorCount += 1;
        annotateFileError(file.filePath, `Could not validate: ${file.error}`);
        break;
    }
  }

  if (threw || invalidCount > 0 || executionErrorCount > 0 || testFailures > 0) {
    core.setFailed(
      buildFailureSummary({ invalidCount, executionErrorCount, testFailures })
    );
    return;
  }

  core.info(
    `Ran ${totalTests} test(s) across ${output.files.length} file(s)`
  );
}

run();
