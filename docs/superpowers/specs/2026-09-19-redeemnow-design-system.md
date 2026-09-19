# RedeemNow Design System

**Status:** binding. Every surface in `web/` follows this document. Where it and a plan disagree, this document wins on visual matters and the plan wins on behaviour.

---

## 1. What we are designing

**Subject.** RedeemNow is an instant-redemption liquidity layer for tokenized real-world assets. A holder of a tokenized Treasury, CLO tranche, private-credit note or equity deposits it and receives stablecoins in the same block at NAV minus a spread. Liquidity providers fund the advance and earn that spread. The protocol collects par from the issuer at settlement.

**Audience.** Two, in this order: (1) investors and trading-desk operators watching a five-minute live demo, who price risk professionally and will disbelieve any number they cannot see decomposed; (2) the holders and LPs who will use it afterwards.

**The design's primary job.** Make the **spread legible as four separate priced risks**. Everything else on every screen is subordinate to that. If a viewer leaves understanding that the spread is `base + utilisation + time + credit` and that each moves for its own reason, the design worked.

**Vernacular.** Institutional credit and market-making: basis points, NAV, settlement windows, exposure limits, haircuts, realised default rates. The register is a prime-brokerage statement, not a crypto dashboard. No gradients-as-decoration, no glow, no "×" multipliers, no rocket language.

---

## 2. Design position

The brief specifies Apple's design language, so that is the frame. But the frame is **Apple's system language — Stocks, Wallet, Numbers, Settings** — not Apple's marketing pages. That distinction decides almost everything:

| Apple marketing (not this) | Apple system (this) |
|---|---|
| Full-bleed hero imagery | Content begins immediately; chrome is thin |
| Huge display type as spectacle | Type scale serves reading order |
| Scroll-triggered reveals | Motion only answers a user action |
| Decorative colour | Colour carries identity or state, nothing else |

**Restraint budget.** One element is allowed to be memorable: **the spread decomposition bar**. Everything around it is quiet — hairlines, neutral ink, generous space. Per the dataviz method, the decomposition is the hero because the data's job is *identity of parts within a whole*, and that is also the product's central claim.

**What the Overview opens with.** Not a grid of stat tiles with a big number and a gradient — that is the default treatment for every dashboard and says nothing about this product. It opens with a **live quote band**: pick an asset, and a single horizontal bar resolves into four proportional segments with their basis-point values, summing to the total spread, above the payout. The stat tiles sit *below* it. The most characteristic thing in this product's world is a spread coming apart into its reasons, so that is what a viewer sees first.

---

## 3. Colour

Authored in OKLCH. Light is the default and dark is a **selected** counterpart — each step chosen against its own surface, never an algorithmic inversion.

### 3.1 Neutrals and accent

```css
@theme {
  /* Surfaces — light */
  --color-ground:        oklch(0.977 0.0015 264);  /* page */
  --color-surface:       oklch(1     0      0  );  /* cards */
  --color-sunken:        oklch(0.958 0.0025 264);  /* wells, insets, table headers */
  --color-hairline:      oklch(0.906 0.004  264);  /* 1px separators */
  --color-hairline-firm: oklch(0.858 0.005  264);  /* input borders */

  /* Ink — light */
  --color-ink:           oklch(0.205 0.012  264);  /* primary */
  --color-ink-2:         oklch(0.468 0.011  264);  /* secondary */
  --color-ink-3:         oklch(0.632 0.009  264);  /* tertiary / captions */

  /* Accent — interactive only, never decorative */
  --color-accent:        oklch(0.505 0.168  266);
  --color-accent-press:  oklch(0.448 0.172  266);
  --color-accent-wash:   oklch(0.955 0.028  266);
  --color-on-accent:     oklch(0.995 0      0  );

  /* Semantic — P&L and pass/fail ONLY. Never a chart series, never decoration. */
  --color-gain:          oklch(0.545 0.135  152);
  --color-gain-wash:     oklch(0.955 0.035  152);
  --color-loss:          oklch(0.545 0.190  25 );
  --color-loss-wash:     oklch(0.957 0.036  25 );
  --color-caution:       oklch(0.600 0.130  75 );
  --color-caution-wash:  oklch(0.962 0.040  75 );
}
```

```css
.dark {
  --color-ground:        oklch(0.178 0.006  264);
  --color-surface:       oklch(0.216 0.008  264);
  --color-sunken:        oklch(0.258 0.009  264);
  --color-hairline:      oklch(0.305 0.010  264);
  --color-hairline-firm: oklch(0.372 0.011  264);

  --color-ink:           oklch(0.968 0.003  264);
  --color-ink-2:         oklch(0.722 0.010  264);
  --color-ink-3:         oklch(0.566 0.010  264);

  --color-accent:        oklch(0.672 0.158  266);
  --color-accent-press:  oklch(0.730 0.148  266);
  --color-accent-wash:   oklch(0.292 0.058  266);
  --color-on-accent:     oklch(0.165 0.020  266);

  --color-gain:          oklch(0.730 0.150  152);
  --color-gain-wash:     oklch(0.278 0.050  152);
  --color-loss:          oklch(0.680 0.185  25 );
  --color-loss-wash:     oklch(0.288 0.062  25 );
  --color-caution:       oklch(0.775 0.140  75 );
  --color-caution-wash:  oklch(0.300 0.055  75 );
}
```

Dark surfaces are **not** pure black and **not** a tinted near-black like `#0B0B0B`. They are a genuine desaturated dark with a faint cool cast, so white text does not vibrate and elevation remains readable.

### 3.2 The spread-decomposition palette — validated, do not substitute

Four categorical slots in **fixed order**. These exact values passed all six checks of the dataviz validator (lightness band, chroma floor, CVD separation, normal-vision floor, contrast vs surface) in both modes. **If you change a value, re-run the validator** — do not eyeball it:

```
node scripts/validate_palette.js "<hex,hex,hex,hex>" --mode light   # and --mode dark
```

| Slot | Meaning | Light | Dark |
|---|---|---|---|
| 1 | **Base** — the protocol's operating floor | `#4C7EF3` | `#5A87F0` |
| 2 | **Utilisation** — how committed the vault already is | `#A96500` | `#BD8620` |
| 3 | **Time** — volatility over the settlement horizon | `#0E9AA7` | `#17A3AB` |
| 4 | **Credit** — expected loss on this redemption | `#8E44C9` | `#9E63D2` |

```css
@theme {
  --color-term-base:   #4C7EF3;
  --color-term-util:   #A96500;
  --color-term-time:   #0E9AA7;
  --color-term-credit: #8E44C9;
}
.dark {
  --color-term-base:   #5A87F0;
  --color-term-util:   #BD8620;
  --color-term-time:   #17A3AB;
  --color-term-credit: #9E63D2;
}
```

Validator results, light mode: worst adjacent CVD ΔE **14.2** (deutan), normal-vision floor **22.6**, all four ≥3:1 against the surface. Dark mode: worst adjacent CVD ΔE **9.8**, normal-vision floor **20.8**, all ≥3:1.

**The hue assignment is deliberate, not arbitrary:**
- **Amber for utilisation** — utilisation is heat. A vault filling up is a temperature reading, and amber is how a temperature reading looks.
- **Violet for credit, not red.** Red means *loss* everywhere else in this interface. Credit is a premium the protocol **earns**, not a loss it takes. Colouring it red would teach the exact wrong thing about the product's economics.
- **Teal for time** — cool, temporal, recedes next to amber.
- **Blue for base** — it shares the accent's family because base is the protocol's own floor rather than a market risk.

Green and red are **reserved** for P&L and pass/fail. They never appear as a chart series.

---

## 4. Typography

**One family.** Apple's system face, with Inter as the loaded cross-platform fallback because its metrics are close enough that the layout does not shift. On the demo machine this renders as genuine SF Pro.

```css
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
             var(--font-inter), "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
```

**Numbers are set in the sans face with tabular figures, not in a monospace.** This is what Apple actually does in Stocks, Numbers and Wallet; it keeps numerals in the same voice as their labels, and it avoids the monospace-for-data-labels cliché. Monospace is reserved for **addresses and transaction hashes**, where distinguishing `0`/`O` and `1`/`l` is a genuine requirement.

```css
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "cv01" 1; }
```

### Scale

Apple's named scale, adapted down slightly for dashboard density. Tracking tightens as size grows — Apple's optical-size behaviour, done manually.

| Role | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| Large title | 32 / 38 | 600 | −0.021em | Page title, once per route |
| Title 2 | 22 / 28 | 600 | −0.017em | Section heads |
| Title 3 | 17 / 22 | 600 | −0.011em | Card titles |
| Body | 15 / 22 | 400 | −0.004em | Prose, table cells |
| Callout | 14 / 20 | 400 | −0.003em | Secondary prose |
| Footnote | 13 / 18 | 400 | 0 | Captions, helper text |
| Caption | 12 / 16 | 400 | 0 | Axis ticks, dense meta |
| Metric | 28 / 32 | 590 | −0.02em | Stat-tile values (+ `.tnum`) |
| Metric large | 40 / 44 | 600 | −0.024em | The payout figure (+ `.tnum`) |

**Sentence case everywhere. No all-caps labels** — not for stat-tile labels, not for table headers, not for eyebrows. A label is distinguished by size, weight and colour, never by shouting. Prose lines cap at **72ch**.

---

## 5. Space, shape, elevation, motion

**Space — 4pt grid.** `4 8 12 16 20 24 32 40 48 64 80`. Card padding 20 (mobile 16). Section gap 24. Route top padding 32.

**Shape — continuous corners.** Apple's radii are a scale, not one value; hierarchy is encoded in radius.

```css
--radius-control: 8px;    /* buttons, inputs, chips */
--radius-card:    14px;   /* cards, panels */
--radius-sheet:   20px;   /* the quote band, modals */
--radius-pill:    999px;  /* badges, segmented control thumb */
```

**Elevation.** Apple separates with hairlines and material first, shadow second. Two levels only:

```css
--shadow-1: 0 1px 2px oklch(0.2 0.01 264 / 0.05), 0 0 0 0.5px oklch(0.2 0.01 264 / 0.045);
--shadow-2: 0 4px 16px oklch(0.2 0.01 264 / 0.07), 0 1px 3px oklch(0.2 0.01 264 / 0.05);
```
Dark mode uses a hairline `inset 0 0 0 0.5px` highlight instead of a drop shadow, because shadows do not read on dark surfaces.

**Material.** The navigation bar is translucent and blurred — the one Apple signature worth keeping:
```css
background: color-mix(in oklch, var(--color-ground) 72%, transparent);
backdrop-filter: saturate(180%) blur(20px);
```

**Motion.** Apple's curve, short durations, and only in response to an action.
```css
--ease: cubic-bezier(0.32, 0.72, 0, 1);
--dur-fast: 140ms;  --dur: 220ms;  --dur-slow: 320ms;
```
Allowed: segment/tab thumb slide, value change flash, disclosure, tooltip fade, decomposition segments re-proportioning when the amount changes. **Not allowed:** entrance animations on cards, scroll reveals, hover lifts, anything looping. Everything respects `prefers-reduced-motion`.

**Hit targets** ≥ 44×44 for primary controls, ≥ 32 for dense table affordances. Focus is a visible 2px accent ring at 2px offset — never `outline: none`.

---

## 6. Components

**Button.** Radius `control`. Filled (accent, `on-accent` text), tinted (`accent-wash` ground, accent text), plain (accent text, no fill), destructive (loss). Height 36 default, 44 primary. Press state darkens to `accent-press` and scales `0.98`. Disabled drops to 40% opacity — never changes hue.

**Segmented control.** Apple's pattern, used for Deposit/Withdraw and for the asset picker. `sunken` track, `surface` thumb with `shadow-1`, thumb slides on `--dur`/`--ease`.

**Input.** `surface` ground, `hairline-firm` border, focus swaps the border to accent and adds the ring. Numeric inputs carry `.tnum` and right-align. The label sits above in Footnote `ink-2`; helper text below in Footnote `ink-3`; error text in Footnote `loss`.

**Card.** `surface`, `radius-card`, `shadow-1`, no border in light mode (the shadow's 0.5px spread reads as one). Header: Title 3 + optional Footnote subtitle, separated by a hairline only when the body is tabular.

**Stat tile.** Footnote `ink-2` label, Metric value with `.tnum`, optional Footnote `ink-3` support line. A tile whose label could be read two ways carries an info affordance with the disambiguation — mandatory for both utilisation tiles (see §8).

**Table.** `sunken` header row, Caption `ink-2` headers in sentence case, hairline row separators at 60% opacity, numerics right-aligned with `.tnum`. Row hover is a `sunken` wash at 50%. No zebra striping.

**Badge.** Pill, tinted wash + matching ink, Caption weight 500. Tones: neutral, accent, gain, loss, caution.

---

## 7. The two charts

Both follow the dataviz mark specs: thin marks, 2px lines, ≥8px markers, 2px surface gap between adjacent fills, 4px rounded data-ends, recessive grid, hover layer present.

### 7.1 Spread decomposition — the hero

A single horizontal stacked bar, height 40, `radius-control` on the outer ends only, with a **2px surface gap between segments**. Four segments in fixed slot order. Each segment ≥ 3% of width gets a direct in-segment label (value in bp); anything narrower moves its label to the legend row beneath. A legend is always present because there are ≥2 series, and all four are direct-labeled where they fit — so identity never rests on colour alone.

Beneath the bar: the four terms as rows (swatch, name, value in bp), then a hairline, then the total. The rows and the bar are the same data twice, deliberately: the bar shows proportion, the rows show exact figures, and a viewer who distrusts one checks the other.

Segments re-proportion on `--dur` when the amount or asset changes. That is the one orchestrated motion in the product.

### 7.2 Utilisation curve

Area chart, accent stroke at 2px, fill a 22%→2% vertical fade of accent. X = utilisation 0–100%, Y = utilisation term in bp. A `ReferenceDot` (r=5, caution fill, 2px surface ring) marks live vault utilisation. Crosshair + tooltip on hover. Caption beneath states plainly that the line is modelled from the on-chain curve parameters and the marker is the live reading.

Recharts 3 notes that apply: `ResponsiveContainer` sizing always wins over chart `width`/`height`; `alwaysShow`/`isFront` are removed on `Reference*` — use `ifOverflow`; `CartesianGrid` must share axis ids or grid lines silently vanish.

---

## 8. Two rules specific to this product

**1. Never show an unlabelled utilisation figure.** Two different utilisations exist and both are correct: `vault.utilisationBps()` is **current**, `quote().utilisationBps` is **projected including the trade being quoted**. Overview and LP show current, labelled "Utilisation". The holder quote shows projected, labelled "Utilisation after this trade", with current beside it as "now". This resolves a defect that was parked in the contracts review.

**2. Credit is never red and never green.** It is a premium earned, not a loss taken. It wears `--color-term-credit` (violet) wherever it appears, including in prose and badges.

---

## 9. What we are deliberately not doing

Each of these is a default that would appear whatever the subject, so none of them is a choice:

- All-caps tracked-out labels or eyebrows
- A monospace face for small data labels (mono is for hashes and addresses only)
- Meta strings joined with middle dots, or `WORD — fragment` constructions
- `→` appended to button and link text
- Gradient washes as decoration; gradient is used once, as the area fill under the curve, where it encodes magnitude
- Identical cards with identical radius and the same soft grey shadow regardless of hierarchy
- Numbered markers (`01 / 02 / 03`) — the dashboard is not a sequence
- Accenting one word of a heading in colour or italic
- Entrance animations, scroll reveals, hover lifts
- Tinted near-black (`#0B0B0B`, `#111`) standing in for a real dark surface
- Emoji as interface iconography
