import * as core from '@actions/core';
import { execSync } from 'child_process';
import * as path from 'path';

async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput('scanner_api_url', { required: true });
    const apiKey = core.getInput('scanner_api_key', { required: true });
    const fileInput = core.getInput('file');
    const dirInput = core.getInput('dir');
    const recursive = core.getInput('recursive') === 'true';

    // Set environment variables for scanner-cli
    process.env.SCANNER_API_URL = apiUrl;
    process.env.SCANNER_API_KEY = apiKey;

    // Build scanner-cli command
    let command = 'scanner-cli validate';

    // Add file arguments
    if (fileInput) {
      const files = fileInput.split(',').map(f => f.trim());
      for (const file of files) {
        command += ` -f "${file}"`;
      }
    }

    // Add directory arguments
    if (dirInput) {
      const dirs = dirInput.split(',').map(d => d.trim());
      for (const dir of dirs) {
        command += ` -d "${dir}"`;
      }
    }

    // Add recursive flag
    if (recursive && dirInput) {
      command += ' -r';
    }

    // Default to current directory if no files or dirs specified
    if (!fileInput && !dirInput) {
      command += ' -d . -r';
    }

    core.info(`Running: ${command}`);

    try {
      const result = execSync(command, {
        encoding: 'utf8'
      });

      // If we get here, all files are valid
      core.info(result);

    } catch (error: any) {
      // Show full stdout output
      if (error.stdout) {
        core.info(error.stdout);
      }

      // Parse stdout to create individual file annotations
      if (error.stdout) {
        const lines = error.stdout.split('\n');
        for (const line of lines) {
          // Look for lines with format: <filepath>: <error>
          const match = line.match(/^(.+?): (.+)$/);
          if (match) {
            const [, filePath, errorMsg] = match;

            // Skip "OK" messages - these are success cases
            if (errorMsg.trim() === 'OK') {
              continue;
            }

            const relativePath = path.relative(process.cwd(), filePath);

            // Try to extract line and column numbers from error message (best effort -
            // if parsing fails, the annotation will still appear but without location links)
            const lineMatches = [...errorMsg.matchAll(/line: (\d+)/g)];
            const columnMatches = [...errorMsg.matchAll(/column: (\d+)/g)];

            const lineNumber = lineMatches.length > 0
              ? parseInt(lineMatches[lineMatches.length - 1][1])
              : undefined;
            const columnNumber = columnMatches.length > 0
              ? parseInt(columnMatches[columnMatches.length - 1][1])
              : undefined;

            core.error(`${relativePath}: ${errorMsg}`, {
              file: relativePath,
              startLine: lineNumber,
              startColumn: columnNumber
            });
          }
        }
      }

      // Set overall failure with stderr details
      core.setFailed(error.stderr || 'Detection rule validation failed');
    }

  } catch (error: any) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
