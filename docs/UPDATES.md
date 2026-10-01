# CLI distribution and updates

Only `achernar-code` is published. The Electron entry points, renderer, pets, native desktop control and private user state are excluded. The development workspace builds a standalone tree with `scripts/prepare-cli-publish.js`; publish from that tree's GitHub repository, never from the desktop root package.

## User flow

Once a release exists on npm:

```powershell
npm install --global achernar-code
achernar --version
achernar update
achernar update --install
```

For previews use `npm install --global achernar-code@next`. In the interactive CLI, `/update` checks for a release and offers installation or notification settings. `achernar update --channel next` explicitly checks previews.

Startup checks at most once a day per installed version/channel, with a six-second timeout. Only the package name is requested from the official npm registry; no task text, paths, keys or conversations are sent. An offline check never prevents starting a task. Checks notify; they do not install in the background.

The updater pins the version returned by the official registry. It does not downgrade. A preview installation also recognizes a newer stable release. Restart after installation. Models and conversations remain in `ACHERNAR_CLI_HOME` (default `~/.achernar-cli`). A source-linked `achernar` launcher is identified as a development checkout and is not replaced by the interactive updater.

To return to a known version explicitly, install that version with npm. This is a manual rollback; the automatic checker will not suggest older versions.

## Maintainer setup

1. Authenticate to the CLI GitHub repository and npm account. The first npm publication may need an interactive `npm publish --tag next --access public` from the verified standalone release directory with the account's required two-factor authentication.
2. In the npm package settings, add a GitHub Actions trusted publisher for owner `JiuYue0820`, repository `achernar-code`, workflow `publish.yml`, environment `npm`. Create the corresponding GitHub environment and set the repository variable `ACHERNAR_NPM_PUBLISH_ENABLED=true` after setup. Until then, tags still run validation but do not attempt an unauthenticated npm publication.
3. Keep `package.json` and `package-lock.json` at the same version. Previews must have `publishConfig.tag: next`; stable releases use `latest`. Do not overwrite an existing version.
4. Push the CLI-only source and a matching version tag such as `v0.2.0-rc.6`. The workflow rejects a tag/version mismatch or desktop entry points.
5. Wait for the release validation matrix (Windows/macOS/Linux, Node 22/24), lint, format, tests, fixture evaluation and installed-package checks.
6. The publish job packs and installs the exact tarball for verification, publishes it using short-lived OIDC identity, then attaches the same tarball to GitHub Releases. If a GitHub-only release already exists, it updates the matching tarball asset rather than trying to recreate the release. No saved npm token is needed after trusted publishing is configured.
7. Verify the registry's dist-tag, a fresh npm installation and `/update` on the previous version. Record the release URL and workflow run before calling it shipped.

The workflow uses a GitHub-hosted runner and npm 11.5.2. Reference: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers).

## Current state

This checkout prepares 0.2.0-rc.6. On September 27, 2026, the CLI rc.5 GitHub release was published and its public tarball installed successfully. npm login subsequently succeeded, but the registry rejected publication with HTTP 403 requesting two-factor publishing verification. The npm package has not been published. The workflow and user updater are implemented; public end-to-end npm update delivery is not yet verified.
