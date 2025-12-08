# Detection Rule Validator Action

> **⚠️ Beta Feature**: This action uses scanner-cli, which is currently in beta. See [Scanner.dev Beta Features](https://docs.scanner.dev/scanner/using-scanner/beta-features) for more information.

GitHub Actions that validate and test detection rules by scanning YAML files in a repository using the scanner-cli tool.

## Actions

This repository provides two actions:

- **Validate Action**: Validates detection rules to ensure they are correctly formatted and syntactically valid
- **Test Action**: Tests detection rules against your Scanner instance to verify they work as expected

## Usage

### Validate Action

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
          scanner_api_url: '${{ secrets.SCANNER_API_URL }}'
          scanner_api_key: '${{ secrets.SCANNER_API_KEY }}'
          dir: 'rules'
          recursive: true
```

### Test Action

```yaml
name: Test Detection Rules
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: scanner-inc/validate-detection-rules/test@v0.2.0
        with:
          scanner_api_url: '${{ secrets.SCANNER_API_URL }}'
          scanner_api_key: '${{ secrets.SCANNER_API_KEY }}'
          dir: 'rules'
          recursive: true
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `scanner_api_url` | The API URL of your Scanner instance | Yes | - |
| `scanner_api_key` | Scanner API key | Yes | - |
| `file` | Detection rule file(s) - comma separated list | No | - |
| `dir` | Directory of detection rule files | No | - |
| `recursive` | Recursively search directory for valid YAML files | No | `true` |

If neither `file` nor `dir` is specified, the action will recursively scan the current directory (`.`).

See the [Scanner.dev CLI documentation](https://docs.scanner.dev/scanner/using-scanner/beta-features/detection-rules-as-code/cli) for details on obtaining your API URL and key.

## How it works

Both actions install the scanner-cli tool and run the appropriate command:
- **Validate Action**: Runs `scanner-cli validate` to check detection rules for syntax and formatting errors
- **Test Action**: Runs `scanner-cli test` to test detection rules against your Scanner instance

Both actions create individual GitHub annotations for each error, pointing to the exact file and line where issues are found.

## Development

To prepare a release:

1. Install dependencies: `npm install`
2. Build the bundled distributions:
   - Validate action: `npm run build` (creates `dist/index.js`)
   - Test action: `npm run build:test` (creates `dist-test/index.js`)
3. Commit the `dist/` and `dist-test/` folders: `git add dist dist-test && git commit -m "Build dist"`
4. Tag the release: `git tag v0.2.0 && git push --tags`

The bundled files contain all dependencies, so users don't need to install anything.

