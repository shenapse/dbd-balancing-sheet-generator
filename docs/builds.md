# Build sheets (`dbd-sheet builds`)

Reads a YAML file describing **specific builds** — what players *actually brought* to a
match — and renders them as a PNG sheet, one row per build.

The other commands ([perks](perks.md), [addons](addons.md), [items](items.md)) answer "what
are you allowed to bring?". This one renders a concrete loadout (a tournament organiser
publishing the builds from a match, or a player registering theirs), optionally checking it
against an allow-list with `--rules`.

```bash
dbd-sheet builds test/fixtures/builds/the-trapper-killer.yaml \
                 test/fixtures/builds/the-trapper-survivors.yaml \
                 --out output --rules test/fixtures/rules/the-trapper.yaml

# via Docker
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" \
  ghcr.io/shenapse/dbd-balancing-sheet-generator:latest \
  builds test/fixtures/builds/the-trapper-killer.yaml \
         test/fixtures/builds/the-trapper-survivors.yaml \
         --rules test/fixtures/rules/the-trapper.yaml --out /work/output --json
```

## CLI

```
dbd-sheet builds <file.yaml...>
     [--out <dir>]            Output directory (default: ./output)
     [--rules <file.yaml>]    Validate the builds against an allow-list YAML
     [--universes-dir <dir>]  Universe files for the rules file's `universe: <id>`
                              (default: nearest `universes/` directory above the rules file)
     [--icons-only]           Also write a text-free, transparent icon-strip PNG
     [--json]                 Print a JSON summary on stdout
     [--strict]               Exit 1 if any violation is found
```

There is no `--columns`: passing it is an error (exit 2). Row width is fixed by the slot layout (4 perks +
offering + optional item + 2 add-ons); it does not wrap.

## YAML schema

**One YAML file describes one side.** A top-level `builds:` key renders a killer sheet; a
top-level `survivors:` key renders a survivor sheet. A file with both, or neither, is a hard
error.

Killer side ([`test/fixtures/builds/the-trapper-killer.yaml`](../test/fixtures/builds/the-trapper-killer.yaml)):

```yaml
killer: The Trapper           # required; matched against dbd-assets killer names and aliases
balancing: DBDLeague          # optional; rendered as a second header line under the title
# title: "Grand Finals — Map 3"   # optional; overrides the default header title text

builds:                       # 1-4 rows, each an alternate loadout for this killer
  - perks:                    # 0-4; missing slots render the empty-slot art
      - Corrupt Intervention
      - Dead Man's Switch
      - "Scourge Hook: Pain Resonance"   # names with a colon MUST be quoted in YAML
      - Bamboozle
    addons: [Trapper Bag, Bloody Coil]   # 0-2, from The Trapper's own add-on pool
    offering: Ebony Memento Mori         # optional

  - perks: [Lethal Pursuer, Discordance]   # only 2 -> 2 blank perk slots
    addons: [Honing Stone]                # only 1 -> 1 blank add-on slot
    # no offering -> blank offering slot
```

Survivor side ([`test/fixtures/builds/the-trapper-survivors.yaml`](../test/fixtures/builds/the-trapper-survivors.yaml)):

```yaml
killer: The Trapper           # OPTIONAL; drives the "Going against:" header + killer art
balancing: DBDLeague

survivors:                    # 1-4 rows, one loadout per survivor
  - perks: [Sprint Burst, Windows of Opportunity, Prove Thyself, Resilience]
    item: Sport Flashlight            # optional; an item VARIANT name
    addons: [Wide Lens, Power Bulb]   # optional; add-ons of that item's type
    offering: Shroud of Union         # optional

  - perks: [Adrenaline, Bond]
    # no item -> blank item slot; add-ons without an item is a hard error
```

A row's perks (0-4, no duplicates) and add-ons (0-2, no duplicates) are optional; unfilled
slots render the game's empty-slot art. `>4` rows, `>4` perks in a row, or `>2` add-ons in a
row are hard errors, independent of `--rules`.

## Name resolution

- **Perks are side-aware.** A killer perk named in a `survivors:` row (or vice versa) is a
  hard error distinct from "unknown name" — the message says which side the perk belongs to.
- **Killer add-ons resolve within the named killer's own pool** — add-on names are not
  unique across killers, so `killer:` is required on the killer side.
- **Item add-ons resolve within the row's `item:` type**, not globally. `addons:` on a row
  with no `item:` is a hard error. `Firecracker` has no add-ons; giving it any is an error.
- **Offerings resolve per side.** A name is looked up on the requested side first and then
  on any side (so offerings that exist for both sides resolve either way).

**Hard errors** (exit 2, naming the offending token and file): an unknown or ambiguous
killer, an unknown or wrong-side perk, a duplicate perk or add-on within a row, an add-on not
in the resolving pool, `addons:` with no `item:`, an unknown item variant or offering, more
than 4 rows / 4 perks / 2 add-ons, and a file with both `builds:` and `survivors:` (or
neither).

## Output

- `<KillerSlug>-killer-builds.png` — killer file
- `<KillerSlug>-survivor-builds.png` — survivor file that names a `killer:`
- `<yaml-basename>-survivor-builds.png` — survivor file with no `killer:`
- `--icons-only` appends `-icons` before `.png` on any of the above

`KillerSlug` is the killer's name with spaces replaced by dashes (`The Trapper` ->
`The-Trapper`).

The canvas is a fixed 1280px wide; height is dynamic — 1-4 rows, plus the Violations section
when `--rules` finds anything. A 4-row survivor sheet with no violations is 1280x720.

A large full-body killer render bleeds up the left edge of the row area at 80% opacity,
behind the rows; each build row is drawn on a translucent `#25233380` panel.

The header is compact and two-line, on the left: `Playing as: <Killer>` on a killer sheet,
`Going against: <Killer>` on a survivor sheet that names a `killer:` (or `Survivor Builds`
with no killer) — a YAML `title:` overrides this line. A second line, `Balancing: <name>`,
appears only when `balancing:` is set. Top-right: `Image Date: <timestamp> UTC`, and — only
when `--rules` was passed — a status line below it: green `No violations found` or red
`N violations found`.

Below the header, one row per build: 4 perk icons, then the offering, then (survivor side
only) the item, then up to 2 add-ons. Killer rows use the same x positions as survivor rows
and leave the item column empty, so killer and survivor sheets line up column-for-column.

### Icon-only sheets (`--icons-only`)

- Just the row strip — same rows, slot order and sizing; no header, no killer art, no
  panels, no text.
- Fully transparent background; tight crop (the canvas is the rows' bounding box).
- Empty slots still draw the empty-slot art; the grey `#333333` placeholder for a genuinely
  missing icon is never drawn here.
- On a killer sheet the empty item column remains as a transparent gap.
- Violation outlines are still drawn.

## Validation (`--rules`)

`--rules <file.yaml>` points at an allow-list YAML (the same format
[`perks`](perks.md) / [`addons`](addons.md) / [`items`](items.md) read, e.g.
[`test/fixtures/rules/the-trapper.yaml`](../test/fixtures/rules/the-trapper.yaml); its
`universe:` forms resolve as described in [perks.md](perks.md#universe-files)) and checks
each build against it. Offending icons get a red (`#e5484d`) outline around the slot, and a
`Violations` section below the rows lists every finding, prefixed by its row (`Build 2 ·` /
`Survivor 3 ·`). Violations are also listed in the `--json` summary under
`files[].violations`.

**A violation is a finding to render, not an error.** The process exits 0 unless `--strict`
is passed, in which case it exits 1 if any violation was found.

Checked (each is confined to a single build): individual perk allow/deny, killer add-on
allow/deny, item-variant allow/deny, item add-on allow/deny, `killerComboBans`,
`killerPickLimits`, `survivorComboBans.survivor`, and `survivorPickLimits` entries scoped
`survivor`.

One deliberate suppression: a row's item add-ons are only checked when the item variant
itself is allowed. If the item is already banned, its add-ons are moot.

**Not checked, deliberately:**

- **Duo/team-scoped rules** (`survivorComboBans.duo`/`.team`, `survivorRepetitionLimits`,
  `survivorPickLimits` with `scope: duo`/`team`, `itemDuplicateLimits`, `itemPickLimits`) —
  they span multiple rows, and a build sheet's rows carry no pairing between them.
- **Offerings** — the allow-list formats have no offering section.

If the `--rules` file's `killer:` doesn't match the build file's, that is a hard error (the
power-add-on allow-list is per-killer).

Missing individual icons render a grey `#333333` placeholder on the regular sheet (with a
warning) rather than failing the run.
