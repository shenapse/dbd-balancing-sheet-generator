# Sample sheets

What each command produces, rendered from real balancing files borrowed from dbd-arena-web
(1v4 Quartet: The Blight and The Lich). The inputs are in [`input/`](input/), the PNGs in
[`sheets/`](sheets/).

| Input | Role |
|-------|------|
| [`blight-allowlist.yaml`](input/blight-allowlist.yaml) | allow-list for `perks`, `addons`, `items`; `--rules` for the survivor builds |
| [`blight-survivor-builds.yaml`](input/blight-survivor-builds.yaml) | survivor builds (`survivors:`) |
| [`lich-allowlist.yaml`](input/lich-allowlist.yaml) | `--rules` for the killer builds |
| [`lich-killer-builds.yaml`](input/lich-killer-builds.yaml) | killer builds (`builds:`) |

## perks

```bash
dbd-sheet perks examples/input/blight-allowlist.yaml --icons-only
```

One sheet per side. Repetition limits (`survivorRepetitionLimits`) are listed under the grid.

![Killer perks](sheets/The-Blight-killer-perks.png)

![Survivor perks](sheets/The-Blight-survivor-perks.png)

## addons

```bash
dbd-sheet addons examples/input/blight-allowlist.yaml --icons-only
```

Allowed power add-ons, grouped by rarity.

![Killer add-ons](sheets/The-Blight-killer-addons.png)

## items

```bash
dbd-sheet items examples/input/blight-allowlist.yaml --icons-only
```

Allowed items with their add-ons, plus item duplicate limits (`itemDuplicateLimits`).

![Items](sheets/The-Blight-items.png)

## builds

```bash
dbd-sheet builds examples/input/blight-survivor-builds.yaml --rules examples/input/blight-allowlist.yaml
dbd-sheet builds examples/input/lich-killer-builds.yaml     --rules examples/input/lich-allowlist.yaml
```

One row per build (perks, offering, item and add-ons). With `--rules`, the top right says whether
any build breaks the allow-list.

![Survivor builds](sheets/The-Blight-survivor-builds.png)

![Killer builds](sheets/The-Lich-killer-builds.png)

## Icon-only variants (`--icons-only`)

`perks`, `addons` and `items` also write text-free sheets next to the regular ones:

| Killer perks | Survivor perks | Add-ons | Items |
|---|---|---|---|
| ![](sheets/The-Blight-killer-perks-icons.png) | ![](sheets/The-Blight-survivor-perks-icons.png) | ![](sheets/The-Blight-killer-addons-icons.png) | ![](sheets/The-Blight-items-icons.png) |

## Regenerating

```bash
examples/generate.sh
```

The script uses the dbd-assets commit in [`dbd-assets.ref`](../dbd-assets.ref) unless
`DBD_ASSETS_ROOT` is set. The sheets carry the generation date, so regenerating changes every PNG.
The same inputs are also golden regression cases (see the README's "Regression tests").
