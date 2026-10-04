# Feedback for this preview

Please open a focused issue with:

1. OS, Node version and `achernar --version`.
2. Provider protocol (no API key) and a small reproducible task.
3. Expected result and actual behavior.
4. Redacted error output and whether the issue also occurs in a fresh session.

Run `npm ci`, `npm run lint`, `npm run format:check`, `npm test` and `npm run test:package` from the source repository to check the CLI and installed package. `npm run test:cli-coverage` measures coverage. Tests use local fixtures; they do not establish real model quality. Keep new commands and input handlers in their relevant modules; keep secret storage separate from display code.

Do not include credentials, private source, full personal session histories, or environment files. Keep permission enforcement and official extension resources intact.

Contributions are accepted under the project's [MIT License](LICENSE). Discuss substantial code changes in an issue before submitting them.
