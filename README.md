# balancing-sheet-generator

Generates Dead by Daylight balancing sheets as PNGs from YAML files:

- **perks**: allowed killer/survivor perks (plus combo bans and limits)
- **addons**: allowed killer power add-ons
- **items**: allowed survivor items and their add-ons
- **builds**: concrete killer/survivor builds, optionally checked against an allow-list

It is a TypeScript tool distributed only as a Docker image
(`ghcr.io/shenapse/balancing-sheet-generator`). Game data and icons come from
[shenapse/dbd-assets](https://github.com/shenapse/dbd-assets), pinned by commit and baked into
the image. There is no JavaScript API.

## Quick start

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" \
  ghcr.io/shenapse/balancing-sheet-generator:<tag> \
  builds killer-builds.yaml --rules rules.yaml --out out --json
```

- Mount your repository root at `/work` (the working directory). Paths are relative to it, and
  files are written there as your own uid (`--user`).
- `<tag>` is `latest`, a version (`1.2.3`, `1.2`, `1`), `main`, or `sha-<short>`.

## Commands

```
dbd-sheet <command> [files...] [options]

  perks   <allowlist.yaml...>   perk allow-list sheets          docs/perks.md
  addons  <allowlist.yaml...>   power add-on sheets             docs/addons.md
  items   <allowlist.yaml...>   item / item add-on sheets       docs/items.md
  builds  <builds.yaml...>      build sheets                    docs/builds.md
  version                       print tool version and dbd-assets ref

Options:
  --out <dir>             output directory (default ./output)
  --columns <n>           icon columns (perks, addons)
  --rules <file>          rules file (builds)
  --universes-dir <dir>   universe files directory (perks, builds)
  --icons-only            also render text-free icon-only sheets
  --json                  print a JSON summary on stdout
  --strict                exit 1 if violations are found (builds)
  -h, --help              show help
```

In the image `dbd-sheet` is the entrypoint, so `docker run ... <image> perks x.yaml` runs
`dbd-sheet perks x.yaml`. Output filenames are unchanged from the legacy tools (for example
`The-Trapper-killer-perks.png`); see the per-command docs.

Compared with the legacy generators: `--preset`, `--name`, `--asset-root` and
`DBD_BALANCING_TOOL_ROOT` are gone (no preset compilation), and the `{ exhaustion: true }` /
`{ tag: ... }` perk selectors are not supported (dbd-assets has no such data); they fail with an
error.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | OK (violations alone do not fail the run) |
| 1 | violations found and `--strict` given |
| 2 | authoring or usage error (bad YAML, unknown name, unknown flag, missing assets) |
| 3 | unexpected internal error |

Human-readable progress and warnings go to **stderr**; stdout carries only the `--json` summary.
Errors print `error: ...` on stderr and produce no JSON.

### JSON summary (`--json`)

```json
{
  "tool": "balancing-sheet-generator",
  "version": "0.1.0",
  "assetsRef": "5efc1cb9ee4f8053f2cad5fed12b4d81d1fccd62",
  "command": "builds",
  "files": [
    {
      "input": "killer-builds.yaml",
      "outputs": ["out/The-Trapper-killer-builds.png"],
      "warnings": [],
      "violations": [{ "rule": "combo-ban", "message": "..." }]
    }
  ],
  "warnings": []
}
```

`violations` is present only for `builds` when rules were checked. Each violation has at least
`rule` and `message`, and may carry extra fields (scope, build row, ...). Top-level `warnings`
are not tied to one input.

## Name resolution

Names in YAML (killers, perks, add-ons, items, offerings) are matched against the dbd-assets
catalog, case-insensitively, with whitespace, `-`, `_`, `'`, `.`, `&` and quotes ignored:

- the English **name** in dbd-assets;
- **`renamed_from`** former names (an old name still resolves to the renamed entity);
- **perk aliases and abbreviations** (`data/aliases/perks-{killer,survivor}.json`, e.g. `DS`);
- **killer aliases** (`data/aliases/killers.json`);
- add-ons resolve within the chosen killer's pool, item add-ons within the item's type.

A name matching more than one entity is an **ambiguity error** (exit 2) that lists the
candidates; use the full name. Colon names (`"Hex: Ruin"`) must be quoted in YAML.

## Universe files

`universe: <id>` in an allow-list (or `--rules` file) loads `<id>.yaml` from a `universes/`
directory: `--universes-dir` if given, otherwise the nearest `universes/` directory found by
walking up from the YAML file's directory. In Docker, mount the caller's repo root at `/work` so
the walk reaches it. See [docs/perks.md](docs/perks.md#universe-files) and
`test/fixtures/universes/`.

## Assets pinning

`dbd-assets.ref` holds the dbd-assets commit SHA baked into the image. At build time the image
fetches exactly that commit, keeps `data/` and `images/`, and writes the SHA to
`/opt/dbd-assets/.ref`. The SHA is reported by:

```bash
docker run --rm ghcr.io/shenapse/balancing-sheet-generator:latest version
docker image inspect ghcr.io/shenapse/balancing-sheet-generator:latest \
  --format '{{ index .Config.Labels "io.github.shenapse.dbd-assets.ref" }}'
```

To bump the assets: edit the SHA in `dbd-assets.ref`, open a PR (CI runs the tests against that
dbd-assets commit and smoke-tests the built image), and merge. Publishing to GHCR happens on
merge to `main`.

## Development

Requires Node 24+ and a dbd-assets checkout.

```bash
npm ci
export DBD_ASSETS_ROOT=../dbd-assets        # see .env.example
npm run dev -- perks test/fixtures/perks/the-trapper.yaml --out output
npm run typecheck
npm test
```

Local image build (uses the pinned SHA):

```bash
docker build --build-arg DBD_ASSETS_REF=$(cat dbd-assets.ref) -t bsg:dev .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" bsg:dev \
  perks test/fixtures/perks/the-trapper.yaml --out /work/output
```

Releases: pushing a `v*` tag publishes `:X.Y.Z`, `:X.Y`, `:X` and `:latest`.

## Documentation

Per-command YAML schemas, selectors, limits and outputs: [docs/perks.md](docs/perks.md),
[docs/addons.md](docs/addons.md), [docs/items.md](docs/items.md),
[docs/builds.md](docs/builds.md).
