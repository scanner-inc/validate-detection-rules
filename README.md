# Detection Rule Validator Action

> **⚠️ Beta Feature**: This action uses scanner-cli, which is currently in beta. See [Scanner.dev Beta Features](https://docs.scanner.dev/scanner/using-scanner/beta-features) for more information.

A GitHub Action that validates detection rules by scanning YAML files in a repository using the scanner-cli tool.

## Usage

```yaml
name: Validate Detection Rules
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: scanner-inc/validate-detection-rules@v0.2.0
        with:
          check_action: "validate_and_run_tests"
          scanner_api_url: "${{ secrets.SCANNER_API_URL }}"
          scanner_api_key: "${{ secrets.SCANNER_API_KEY }}"
          dir: "rules"
          recursive: true
```

## Inputs

| Input             | Description                                                    | Required | Default         |
| ----------------- | -------------------------------------------------------------- | -------- | --------------- |
| `check_action`    | Action to perform: `validate_only` or `validate_and_run_tests` | No       | `validate_only` |
| `scanner_api_url` | The API URL of your Scanner instance                           | Yes      | -               |
| `scanner_api_key` | Scanner API key                                                | Yes      | -               |
| `file`            | Detection rule file(s) - comma separated list                  | No       | -               |
| `dir`             | Directory of detection rule files                              | No       | -               |
| `recursive`       | Recursively search directory for valid YAML files              | No       | `true`          |

### Check Action Modes

- **`validate_only`** (default): Runs `scanner-cli validate` to check that detection rules are valid YAML and conform to the expected schema.
- **`validate_and_run_tests`**: Runs `scanner-cli run-tests` to validate rules and also execute any embedded tests defined in the detection rules.

If neither `file` nor `dir` is specified, the action will recursively scan the current directory (`.`).

See the [Scanner.dev CLI documentation](https://docs.scanner.dev/scanner/using-scanner/beta-features/detection-rules-as-code/cli) for details on obtaining your API URL and key.

## How it works

The action installs the scanner-cli tool and runs either `scanner-cli validate` or `scanner-cli run-tests` (depending on the `check_action` input) with the specified files, directories, and options. It creates individual GitHub annotations for each validation error, pointing to the exact file and line where issues are found.

## Development

To prepare a release:

1. Install dependencies: `npm install`
2. Build the bundled distribution: `npm run build`
3. Commit the `dist/` folder: `git add dist && git commit -m "Build dist"`
4. Tag the release: `git tag v0.1.0 && git push --tags`

The bundled `dist/index.js` contains all dependencies, so users don't need to install anything.
