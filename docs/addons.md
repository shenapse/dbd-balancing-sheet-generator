# Power add-on sheets (`dbd-sheet addons`)

Reads a YAML file describing one killer's *allowed* power add-ons and produces a PNG
"allowed add-ons" sheet grouped by rarity (Common -> Uncommon -> Rare -> Very Rare ->
Ultra Rare) with rarity-bordered icons, plus an optional text-free icon-grid PNG with
`--icons-only`.

Add-ons are killer-side only. Survivor items and their add-ons are handled by
[`dbd-sheet items`](items.md).

```bash
dbd-sheet addons test/fixtures/addons/the-trapper.yaml --out output

# via Docker
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" \
  ghcr.io/shenapse/balancing-sheet-generator:latest \
  addons test/fixtures/addons/the-trapper.yaml --out /work/output --json
```

## CLI

```
dbd-sheet addons <file.yaml...>
     [--out <dir>]        Output directory (default: ./output)
     [--columns <n>]      Max icons per row within a rarity section (default: 8)
     [--icons-only]       Also write a text-free, transparent icon-grid PNG
     [--json]             Print a JSON summary on stdout
```

## YAML schema

```yaml
killer: The Trapper     # Matched against dbd-assets killer names and killer aliases

balancing: DBDLeague    # Optional. Label of the balancing ruleset these allow-lists
                        # come from. Rendered on the sheet.

addons:
  default: allow        # allow | deny — applied to the whole add-on pool (default: deny)
  deny:                 # exceptions to the default
    - Honing Stone               # individual add-on by name
    - { rarity: "Ultra Rare" }   # group: every add-on of that rarity
    - { tier: 4 }                # same group, by numeric rarity index (0-4)
  allow:                # opposite-direction exceptions (win on conflict)
    - Bloody Coil
```

The `default` / `allow` / `deny` keys may also be placed at the top level instead of under
`addons:`, but the nested `addons:` block is the documented form.

Examples: [`test/fixtures/addons/`](../test/fixtures/addons).

## Resolution rules

The killer's full add-on list is the universe `U`.

1. **Seed**: `default: allow` -> `allowed = U`; `default: deny` -> `allowed = {}`.
2. Apply each `deny` selector -> remove matched add-ons.
3. Apply each `allow` selector -> add matched add-ons (from `U`).

**Precedence: `allow` is applied last and WINS on any conflict.**

## Selectors

| Form | Matches |
|------|---------|
| `"Add-on Name"` | A single add-on by name (case-insensitive; spaces/dashes/underscores/apostrophes/`&`/quotes folded; former names via `renamed_from` also match) |
| `{ rarity: "Ultra Rare" }` | Every add-on of that rarity. Names: `Common`, `Uncommon`, `Rare`, `Very Rare`, `Ultra Rare` |
| `{ tier: 4 }` | Same as `rarity`, by numeric index `0`=Common ... `4`=Ultra Rare |

`{ exhaustion: ... }` and `{ tag: ... }` selectors are not supported.

**Hard errors** (exit 2): an unknown add-on name, an unknown rarity, an unknown or ambiguous
killer — the message names the offending token and the input file. The killer may be given
by an alias (e.g. a short nickname); the add-on pool is resolved for the matched killer.

## Output

One PNG per killer into `<out>/` (plus one more with `--icons-only`):

- `<KillerSlug>-killer-addons.png`
- `<KillerSlug>-killer-addons-icons.png` (`--icons-only`)

Add-ons are grouped into one labelled section per rarity, **Common -> Ultra Rare**; empty
rarities are skipped. Within a rarity, add-ons are sorted alphabetically and wrap at
`--columns` icons per row. Each icon is composited over its rarity border.

The header shows the killer portrait, killer name, `Allowed Killer Add-ons`, `(N add-ons)`,
and a provenance block with the `balancing` label (if set) and the generation timestamp.
With zero allowed add-ons the header renders with a "None allowed" note.

### Icon-only sheets (`--icons-only`)

- Rarity sections stay stacked in order, same add-ons and `--columns` wrapping, but with
  **no rarity labels** (and no left gutter for them).
- No header, no text of any kind.
- Fully transparent background (regular sheets use opaque `#100f16`).
- Tight crop: no outer margin; width matches the largest rarity section's column count
  (capped at `--columns`).
- With zero allowed add-ons the icon sheet is skipped (no file, a log note).

Missing add-on art still renders its rarity border (or a grey placeholder) and adds a
warning rather than failing the run.
