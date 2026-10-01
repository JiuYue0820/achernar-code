# Achernar Code — bundled resource notices

The release archive includes original Achernar application code, official Skills,
and official plugin adapters. Third-party runtime packages are installed by
`npm ci` from the included lockfile. Their license texts remain in the installed
packages under node_modules; this notice does not replace those texts.

Direct runtime packages: Commander, Ajv, Model Context Protocol TypeScript SDK,
partial-json, LinkeDOM, Zod, TypeScript, typescript-language-server, jsdiff and Picomatch. Exact versions, resolved locations and integrity
values are recorded in package-lock.json.

The three official UI templates contain Lucide theme-icon paths. Their complete
ISC notice is embedded in each template and must be retained when those paths are
redistributed. The page layouts and sample text are original Achernar resources.

The official Context7 adapter connects to Upstash's external service; the
service's returned documentation is not bundled with this archive. Search,
registry, and other remote resources retain their original source ownership.

Achernar's own CLI code is released under the MIT License (see LICENSE).
Third-party license grants and notices remain applicable to their respective
resources.
