# Item sheets (`dbd-sheet items`)

Reads a YAML file describing one killer's *allowed survivor items* and produces a single PNG
"allowed items" sheet — **one row per allowed item variant**, showing that variant alongside
the add-ons allowed for its item type — plus an optional text-free icon-strip PNG with
`--icons-only`.

Items are **survivor-only**, so there is no killer side. Killer power add-ons are handled by
[`dbd-sheet addons`](addons.md).

```bash
dbd-sheet items test/fixtures/items/the-trapper.yaml --out output

# via Docker
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" \
  ghcr.io/shenapse/balancing-sheet-generator:latest \
  items test/fixtures/items/the-trapper.yaml --out /work/output --json
```

## CLI

```
dbd-sheet items <file.yaml...>
     [--out <dir>]        Output directory (default: ./output)
     [--icons-only]       Also write a text-free, transparent icon-strip PNG
     [--json]             Print a JSON summary on stdout
```

## Data model

dbd-assets has two levels:

- **Item types** (7): `Firecracker`, `Flashlight`, `Med-Kit`, `Toolbox`, `Key`, `Map`, `Fog Vial`.
  Each type owns its **add-on pool**.
- **Item variants**: e.g. `Flashlight`, `Sport Flashlight`, `Anniversary Flashlight`, all of
  type Flashlight. Variants are what a build actually equips.

So the YAML is keyed by **item type**, and within each type you control its **variants** and
its **add-ons** independently.

## YAML schema

```yaml
killer: The Trapper        # Matched against dbd-assets killer names and aliases

balancing: DBDLeague       # OPTIONAL. Label of the balancing ruleset. Rendered on the sheet.

default: deny              # OPTIONAL. Default for any item type NOT listed under `items:`.
                           # allow | deny (default: deny).

items:
  Flashlight:              # key = item TYPE name (Firecracker | Flashlight | Med-Kit |
                           #                        Toolbox | Key | Map | Fog Vial)
    default: deny          # which VARIANTS of this type are allowed (allow | deny)
    allow:                 # variant-name exceptions to the type default
      - Sport Flashlight
    deny: []
    addons:
      default: deny        # which ADD-ONS of this type are allowed (allow | deny).
                           # If omitted, follows this type's variant default.
      allow:
        - Wide Lens
        - Power Bulb
      deny: []

  Med-Kit:
    default: allow
    deny:
      - Anniversary Med-Kit
    addons:
      default: allow
      deny:
        - Anti-Haemorrhagic Syringe
        - { rarity: "Ultra Rare" }   # ban all Ultra Rare add-ons
```

Example: [`test/fixtures/items/the-trapper.yaml`](../test/fixtures/items/the-trapper.yaml).

### Resolution rules (independently for variants and for each type's add-ons)

1. **Universe** = all variants of that type / all add-ons of that type.
2. **Seed** from `default`: `allow` -> everything; `deny` -> nothing.
   - A type omitted from `items:` uses the top-level `default` for both variants and add-ons.
   - An `addons` block with no `default` inherits its type's variant `default`.
3. Apply each `deny` selector.
4. Apply each `allow` selector. **`allow` is applied last and wins.**

### Selectors

Each entry in `allow:` / `deny:` is either:

- A **plain name string** — item-variant or add-on name (case-insensitive; spaces, dashes,
  underscores, apostrophes, ampersands folded; former names via `renamed_from` also match).
- A **rarity object** (add-on lists only) — `{ rarity: <name-or-index> }`:

  ```yaml
  addons:
    deny:
      - { rarity: "Ultra Rare" }   # by name (case-insensitive)
      - { rarity: 4 }              # equivalent numeric index
  ```

  Rarity names (indices): `Common` (0), `Uncommon` (1), `Rare` (2), `Very Rare` (3),
  `Ultra Rare` (4), `Event` (5).

`{ exhaustion: ... }` / `{ tag: ... }` selectors are not supported.

**Hard errors** (exit 2): an unknown killer, an unknown item-type key, an unknown
variant/add-on name, an unknown rarity name, or an unrecognised selector shape.

## Item limits (image-only)

The allow-list is a **candidate pool**: each survivor brings exactly **one** item. On top of
that you can express how many of a given item the team may field. These limits are
**rendered on the sheet only**. Two optional top-level keys, both lists:

```yaml
# Duplicate limits: "how many survivors may bring the SAME item."
itemDuplicateLimits:
  - scope: team          # team | duo
    max: 1               # at most this many members may bring any one item
    items: all           # "all" (or omitted) = every allowed item; or a list narrows it
  - scope: duo
    max: 1
    items:
      - First Aid Kit
      - Ranger Med-Kit

# Pick limits: "the group may bring at most N items drawn from this set."
itemPickLimits:
  - scope: team
    max: 2               # must be less than the number of resolved items
    items:               # a list of 2+ selectors
      - { type: Med-Kit }
      - { type: Toolbox }
```

### Scopes

Only **`team`** (the whole 4-survivor squad) and **`duo`** (two members). There is no
`survivor` scope: each survivor brings one item, so it would be vacuous. Scope is shown as
a coloured chip (`DUO` orange, `WHOLE TEAM` red).

### Limit selectors

Each entry under a limit's `items:` is either:

- A **plain name string** — an item **variant** name.
- A **`{ type: <TypeName> }` object** — expands to **all allowed variants of that type**
  (it also disambiguates a variant named like its type, e.g. the `Flashlight` variant vs. the
  `Flashlight` type).

A selector naming a variant **not** in the allowed pool is warned about and dropped; an
unknown name/type is a hard error.

### Validation / reduction

- `scope` must be `team` or `duo`; `max` must be a positive integer.
- A **duplicate** limit renders a scope chip + a sentence like *"No two survivors may bring
  the same item."*, then the item icons (or an `ALL ITEMS` pill for `items: all`).
- A **pick** limit requires an explicit list of 2+ items and renders *"The team may bring at
  most N of these items."* + the item icons. If `max` is at least the resolved item count the
  limit is **vacuous** and is warned about and dropped.

## Output

One PNG per input file into `<out>/` (plus one more with `--icons-only`):

- `<KillerSlug>-items.png`
- `<KillerSlug>-items-icons.png` (`--icons-only`)

Layout: a dark header (killer portrait, the title **"Going against: \<killer\>"**, "Allowed
Items & Add-ons", a legend line saying **each survivor brings one item chosen from the
pool**, the item count, one count-line per limit family present, and a provenance block
with the `balancing` label and generation timestamp). Below, allowed items are grouped under
an **item-type section header** in item-type order, one row per allowed variant — the variant
icon and its type's allowed add-on icons in a strip. Rows with no allowed add-ons show
"(no add-ons allowed)". Finally any **Duplicate Limit** and **Pick Limits** sections render
below the grid. Missing icons fall back to a grey placeholder box (with a warning) on the
regular sheet.

### Icon-only sheets (`--icons-only`)

- Same row-per-variant body — the variant icon and its type's add-on strip, same order and
  geometry.
- No item-type section headers (the gap between groups is widened so grouping still reads),
  no header, no limit sections, no "(no add-ons allowed)" note — no text of any kind.
- Fully transparent background (regular sheets use opaque `#100f16`).
- Tight crop; the sheet width is set once by the widest group's add-on strip, so every row's
  columns stay vertically aligned across groups.
- With zero allowed variants the icon sheet is skipped (no file, a log note).
