# Perk sheets (`dbd-sheet perks`)

Reads a YAML file describing one killer's *allowed* perks and produces two PNG
"allowed perks" sheets (killer side and survivor side), plus optional text-free
icon-grid PNGs with `--icons-only`.

```bash
dbd-sheet perks test/fixtures/perks/the-trapper.yaml --out output

# via Docker
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" \
  ghcr.io/shenapse/dbd-balancing-sheet-generator:main \
  perks test/fixtures/perks/the-trapper.yaml --out /work/output --json
```

## CLI

```
dbd-sheet perks <file.yaml...>
     [--out <dir>]            Output directory (default: ./output)
     [--columns <n>]          Grid columns (default: 8)
     [--icons-only]           Also write text-free, transparent icon-grid PNGs
     [--universes-dir <dir>]  Directory of universe files that `universe: <id>` resolves
                              against (default: nearest `universes/` directory found walking
                              up from each input file's directory)
     [--json]                 Print a JSON summary on stdout
```

## YAML schema

```yaml
killer: The Trapper     # Matched against dbd-assets killer names and killer aliases

balancing: DBDLeague    # Optional. Label of the balancing ruleset these allow-lists
                        # come from. Rendered on both sheets.

# Optional. Restricts which perks are considered for each side.
# Default: every perk in dbd-assets for that side.
# universe: quartet-standard   # shorthand: id of a universe file, used for both sides
# universe:                    # or per side; each is `all`, a universe id, or a list of perk names
#   killer: quartet-standard   # -> the `killer` list of universes/quartet-standard.yaml
#   survivor: all              # or an inline list: [Sprint Burst, Borrowed Time]

killerPerks:
  default: allow        # allow | deny — applied to the whole killer-side universe
  deny:                 # exceptions to the default
    - Bamboozle         # individual perk by name (alias-aware)
  allow: []             # opposite-direction exceptions

survivorPerks:
  default: deny
  allow:
    - Sprint Burst
    - Borrowed Time
  deny: []

# Optional. Combination bans — perk PAIRINGS that are restricted even though each
# perk is individually allowed. Rendered on the sheets only.
survivorComboBans:            # map keyed by scope (all keys optional)
  survivor:                   # one survivor may not bring both perks
    - [Prove Thyself, Botany Knowledge]
  duo:                        # neither duo may bring both between its two members
    - [Bond, Kindred]
  team:                       # if one survivor brings one, no other may bring the other
    - [Adrenaline, Sprint Burst]

killerComboBans:              # killer is one player -> a flat list, single "build" scope
  - ["Scourge Hook: Pain Resonance", Pop Goes the Weasel]

# Optional. Repetition limits — cap how many survivors may each bring the SAME perk
# within a scope (survivor side only).
survivorRepetitionLimits:     # a list of { scope, max, perks } rules
  - scope: duo                # duo | team
    max: 1                    # <= this many members may bring any covered perk
    perks: all                # "all"/omitted -> every allowed perk
  - scope: team
    max: 2
    perks: [Self-Care, Botany Knowledge]   # a subset -> cap applies per listed perk

# Optional. Pick limits — "pick at most N perks from this list". Both sides.
survivorPickLimits:           # a list of { scope, max, perks } rules
  - scope: duo                # survivor | duo | team
    max: 1                    # the group may bring <= this many perks from the list
    perks: [Sprint Burst, Lithe, Balanced Landing]   # 2+ perks to choose from (required)

killerPickLimits:             # killer is one player -> { max, perks } (no scope)
  - max: 2
    perks: [Pop Goes the Weasel, Corrupt Intervention, Overcharge, Eruption]
```

A complete example: [`test/fixtures/perks/the-trapper.yaml`](../test/fixtures/perks/the-trapper.yaml).

## Resolution rules (applied independently per side)

1. **Universe** `U` = the perks named by `universe` for that side (see
   [Universe declaration](#universe-declaration)), else all perks of that side.
2. **Seed**: `default: allow` -> `allowed = U`; `default: deny` -> `allowed = {}`.
3. Apply each `deny` selector -> remove matched perks from `allowed`.
4. Apply each `allow` selector -> add matched perks (intersected with `U`) to `allowed`.

**Precedence: `allow` is applied last and WINS on any conflict.**
If a perk appears in both `deny` and `allow`, it ends up allowed.

## Universe declaration

`universe` is optional; omitted means `all` on both sides. It may be:

- a **string id** (`universe: quartet-standard`): use that universe file for both sides;
- a **map** `{ killer?, survivor? }`, where each side is `all`, a universe id, or an inline
  list of perk names. An omitted side means `all`.

A side set to an id uses that side of the file, so `universe: { killer: X }` takes
`X.killer`. The word `all` is reserved and cannot be used as an id. Because `allow` and
`deny` resolve inside the universe, an `allow` entry outside it is an "Unknown perk" error.

### Universe files

A universe id names the file `<universes-dir>/<id>.yaml` (kebab-case id, no extension in
the reference). The directory is `--universes-dir`, otherwise the nearest `universes/`
directory walking up from the input YAML's directory. When running in Docker, mount the
caller's repository root at `/work` so that walk can reach it. If an id is used and no
directory is found, or the id does not exist, the run fails (the latter lists the ids
that do exist).

```yaml
# universes/quartet-standard.yaml
name: Quartet standard pool    # optional label (unused by resolution)
description: ...               # optional
killer:                        # optional; omitted => all
  - Agitation
  - "Hex: Ruin"                # colon names must be quoted, as in build YAMLs
survivor: all                  # `all` | non-empty list of perk names
```

- Allowed top-level keys: `name`, `description`, `killer`, `survivor`; anything else is an
  error (catches typos).
- `killer` / `survivor` each take `all` or a non-empty list of strings; a missing key
  means `all`.
- Names are matched with the same normalization and aliases as everywhere else, against
  the perks of that side. An unknown name fails the run and names the file and side.
- A perk listed twice (after normalization / alias lookup) is an error.

The same `universe:` forms are honoured by `dbd-sheet builds` for its `--rules` file.
Examples: [`test/fixtures/universes/`](../test/fixtures/universes).

## Selectors

Each item in `allow:` / `deny:` is a **perk name string**: the dbd-assets English name,
a `renamed_from` former name, or an alias / abbreviation (e.g. `DS`), matched
case-insensitively with spaces, dashes, underscores, apostrophes, `&`, `.` and quotes
folded. See [name resolution in the README](../README.md#name-resolution).

Group selectors `{ exhaustion: true }` and `{ tag: ... }` are **not supported** (dbd-assets
carries no exhaustion or tag data); using one fails with an error. List the perks by name.

### Perk names with colons

Many perk names contain a colon (e.g. "Boon: Circle of Healing", "Hex: Ruin"). An
unquoted `- Boon: Circle of Healing` is parsed by YAML as a mapping, not a string.
**Always quote colon names:**

```yaml
deny:
  - "Boon: Circle of Healing"
  - "Hex: Ruin"
```

**Hard errors** (exit 2): an unknown perk name, an ambiguous name (matches several
perks), an unknown killer name.

## Combination bans

`survivorComboBans` / `killerComboBans` declare perk **pairings** that are restricted even
though each perk stays individually allowed.

- **`survivorComboBans`** is a map keyed by scope; all keys are optional:

  | Scope | Meaning |
  |-------|---------|
  | `survivor` | One survivor may not bring both perks. |
  | `duo` | The team is two duos A=(A1,A2), B=(B1,B2); neither duo may split the pair between its two members. A1+A2 is illegal; A1+B1 is fine. |
  | `team` | If any survivor brings one perk, no other survivor may bring the other. |
- **`killerComboBans`** is a flat list of combos (single scope: the killer's own build).
- Each combo is a **list of 2+ perk names** (quote colon names).
- A combo naming a perk that is not in that side's allowed set emits a non-fatal
  **warning** (the combo is moot).

**Hard errors**: an unknown scope key under `survivorComboBans`, a combo with fewer than
2 perks, or an unknown perk name.

## Repetition limits

`survivorRepetitionLimits` caps how many members of a scoped group may each bring the
**same** perk. **Survivor side only.** A list of `{ scope, max, perks }`:

| Field | Meaning |
|-------|---------|
| `scope` | `duo` or `team`. |
| `max` | Positive integer. Within each group of that scope, at most `max` members may bring any single covered perk. |
| `perks` | `all` / omitted -> every allowed survivor perk. A **list of perk names** -> the cap applies per-perk to each listed perk. |

Examples: `{ scope: duo, max: 1, perks: all }` — duo partners may not double up on any
perk. `{ scope: team, max: 2, perks: [Self-Care, Botany Knowledge] }` — each of those two
perks may be brought by at most two of the four survivors.

**Hard errors**: not a list, an unknown `scope`, a non-integer or `< 1` `max`, an unknown
perk name. **Warnings**: a listed perk not in the allowed set (moot), or a `duo` rule with
`max >= 2` (vacuous).

## Pick limits

`survivorPickLimits` / `killerPickLimits` express **"pick at most N perks from this
list"**.

- **`survivorPickLimits`**: list of `{ scope, max, perks }`; `scope` is `survivor`, `duo`
  or `team`.
- **`killerPickLimits`**: list of `{ max, perks }` (no scope).
- `perks` is **required**: an explicit list of **2+ perk names**.
- `max` is a positive integer.

Example: `{ scope: duo, max: 1, perks: [Sprint Burst, Lithe, Balanced Landing] }` — a duo
may bring at most one of those three perks between its two members.

> **Distinct-pick nuance.** A pick limit counts *slots*, so `max: 2` over a duo is
> satisfied by two members both bringing the same listed perk. To forbid that, pair the
> pick limit with a repetition limit on the same subset (`max: 1`).

**Hard errors**: not a list, an unknown/omitted `scope` (survivor side), a scope on a
`killerPickLimits` entry, a bad `max`, `perks` missing or with fewer than 2 names, an
unknown perk name. **Warnings**: a listed perk not in the allowed set.

## Generalized perk-limit model

Combination bans, repetition limits and pick limits are authoring sugar for one model:
a cap on how a scoped group may use a set of perks, `{ scope, count, max, perks }`.

- `count: perPerk` -> each perk in the set may be brought by at most `max` members of the
  group (the **repetition** family).
- `count: total` -> the group may bring at most `max` perks from the set in total
  (the **pick / combo** family).

Each limit is reduced to exactly one render target:

| Render target | When |
|---------------|------|
| **Duplicate limit** | `count: perPerk` |
| **Combination ban** | `count: total`, explicit list, `max = (list length - 1)` |
| **Pick limit** | `count: total`, explicit list, `1 <= max < (list length - 1)` |
| *dropped (warned)* | `count: total` with `max >= list length` (vacuous) |

So a pick limit authored with `max = length - 1` renders under **Combination Bans**.

## Output

Two PNG files per killer into `<out>/`:

- `<KillerSlug>-killer-perks.png`
- `<KillerSlug>-survivor-perks.png`

With `--icons-only`, two more: `<KillerSlug>-killer-perks-icons.png` and
`<KillerSlug>-survivor-perks-icons.png`.

Perks are sorted **alphabetically by name**; the last row is left-aligned. The header shows
the killer portrait, a title, side label, `(N perks)`, and a provenance block with the
`balancing` label (if set) and generation timestamp. On the survivor-side sheet the title
reads **"Going against: \<killer\>"**. With zero allowed perks the header still renders
with a "None allowed" note.

Below the grid, up to three restriction sections appear in a fixed order —
**Duplicate Limit -> Pick Limits -> Combination Bans**.

### Icon-only sheets (`--icons-only`)

Stripped-down variants for compositing elsewhere:

- Just the allowed-perk icon grid — same order, `--columns` and icon geometry.
- No header, no restriction sections, no text of any kind.
- Fully transparent background (regular sheets use opaque `#100f16`).
- Tight crop: no outer margin, width matches the columns actually used.
- A side with zero allowed perks is skipped (no file, a log note).
