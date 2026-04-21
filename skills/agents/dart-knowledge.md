---
name: pixel-twin/dart-knowledge
description: Authoritative reference for @datavant/dart font, spacing, and component behavior. Read this before writing any dart code. Never assume dart = Mantine defaults.
---

# @datavant/dart — Implementation Knowledge Base

**Critical premise:** dart overrides Mantine's defaults at the token level. Values here are authoritative.
Do NOT assume any standard Mantine documentation value — dart remaps the entire scale.

---

## Font-Size + Line-Height Token Scale

| dart `size` prop | font-size | line-height (`lh` omitted) | CSS token |
|---|---|---|---|
| `"xs"` | **10px** | 14px | `--mantine-font-size-xs` / `--mantine-line-height-xs` |
| `"sm"` | **12px** | 16px | `--mantine-font-size-sm` / `--mantine-line-height-sm` |
| `"md"` | **14px** | 20px | `--mantine-font-size-md` / `--mantine-line-height-md` |
| `"lg"` | **16px** | 24px | `--mantine-font-size-lg` / `--mantine-line-height-lg` |
| `"xl"` | **18px** | 28px | `--mantine-font-size-xl` / `--mantine-line-height-xl` |

### Critical size-selection rule

Before writing any `<Text size="...">` or passing `size` to `HighlightedText`, look up the target px in the table above. **Never guess.**

| Figma font-size | → dart `size` prop |
|---|---|
| 10px | `size="xs"` |
| 12px | `size="sm"` |
| 14px | `size="md"` |
| 16px | `size="lg"` |
| 18px | `size="xl"` |

### Line-height pairing rule

`size="md"` (14px) comes with `lh="md"` = 20px. For dense table rows (52px height), 20px line-height is too tall.
When Figma specifies 14px font / 16px line-height: use **`size="md" lh="sm"`**.

| Figma line-height | → dart `lh` prop | Computed value |
|---|---|---|
| 14px | `lh="xs"` | 14px |
| 16px | `lh="sm"` | 16px |
| 20px | `lh="md"` | 20px |
| 24px | `lh="lg"` | 24px |

---

## Spacing Tokens

```
--mantine-spacing-xs  = 10px   (0.625rem)
--mantine-spacing-sm  = 12px   (0.75rem)
--mantine-spacing-md  = 16px   (1rem)
--mantine-spacing-lg  = 20px   (1.25rem)
--mantine-spacing-xl  = 32px   (2rem)  ← NOT 24px. Mantine default is 2rem × scale.
```

Gap shortcuts: `gap="xs"` = 10px, `gap="sm"` = 12px, `gap="md"` = 16px, `gap="lg"` = 20px, `gap="xl"` = **32px**.

**There is NO named token for 24px.** Use `gap={24}` (numeric) for Figma's 24px gaps.

---

## Table (`<Table>`) — Confirmed Gotchas

### Gotcha 1: Sort click handlers are NOT wired
dart renders `<th>` with no `onClick`. Always wire manually in every header render function:
```tsx
<Group
  onClick={column?.getToggleSortingHandler()}
  style={{ cursor: column?.getCanSort() ? "pointer" : "default" }}
>
```

### Gotcha 2: `meta.column.width` is ignored — use CSS nth-child
dart's `Table` component reads `meta.column` only for `isSortable`. The `width` field (e.g., `width: "16rem"`) is dead code — dart never passes it to `<th>` or `<td>` in the DOM.

To set column widths, use CSS nth-child selectors scoped to the table container:
```css
/* Scope by tab if columns differ between tabs */
.tableContainer[data-tab-id="all"] th:nth-child(1),
.tableContainer[data-tab-id="all"] td:nth-child(1) {
  min-width: 164px;
  max-width: 164px;
}
```
Add a `data-tab-id={tabId}` attribute to the outer Box wrapping `<Table>` to enable tab-aware column widths.

### Gotcha 3: `<td>` default padding is `8px 16px` — overridable via CSS
dart applies `padding: 8px 16px` to every `<td>`. If Figma specifies `px-[8px]`, override in CSS:
```css
.tableContainer td {
  padding-left: 8px;
  padding-right: 8px;
}
```
Do NOT fight dart's specificity with `!important`. A scoped CSS module class wins with standard specificity.

Do NOT add `py` or `px` to inner `Group`/`Stack` elements — td padding is the sole source of cell spacing. Double-padding adds 16px top/bottom instead of 8px.

Always use `h="100%"` on inner cell elements for vertical centering.

### Gotcha 4: Row backgrounds must go on `<td>` via `:has()`, not inner divs
If you apply `background-color` to an inner `<Stack>` or `<Group>`, the background only fills the content area (td height minus padding), not the full row height. This creates visible gaps at row edges.

Correct pattern:
```css
td:has(.negativeRowBg) {
  background-color: var(--surface-error-muted-default);
}
```
```tsx
<Stack h="100%" className={rowCls.bg}>...</Stack>
// rowCls.bg = "negativeRowBg" — acts as a semantic marker only
```

---

## Badge — Confirmed Gotchas

### Gotcha 5: `filled` variant overrides `<Text c={...}>` with white
dart/Mantine Badge with the default `filled` variant applies `color: white` to child text via a class-based CSS rule. A `<Text c="...">` prop inside Badge uses a CSS custom property that the filled-variant rule defeats.

**Wrong:**
```tsx
<Badge><Text c={config.color}>{label}</Text></Badge>
```
**Correct (inline style wins unconditionally):**
```tsx
<Badge bg={config.bgColor} leftSection={null}>
  <Text size="sm" style={{ color: config.color }}>{label}</Text>
</Badge>
```

### Gotcha 6: Badge text font-size and line-height
Figma badge text spec: `sys/fontSize/14` (14px) / `sys/fontSize/20` (20px).
Use `size="md"` (14px). The default line-height for `size="md"` is 20px — do NOT add `lh="sm"`.
Never use `size="xs"` (10px) or `size="sm"` (12px) for badges.

### Gotcha 7: Badge transparent prop removes background — white text becomes invisible
**Never pass** `bg="transparent"` or a `transparent` prop that sets `bg="transparent"` on a filled Badge.
With the default `filled` variant, Badge text is white (from Mantine CSS). If `bg="transparent"`,
the background disappears but text stays white → invisible on a light table background.
For progress column in a table: do NOT pass `transparent`. Render the filled colored badge directly.

### Gotcha 8: Custom badge colors — use explicit bgColor, not the dart colorMap
dart Badge `color` prop (neutral/success/warning/error) does NOT reliably match Figma's filled badge colors.
For badges with custom colors, always use explicit `bg={config.bgColor}` with `style={{ color: config.textColor }}`.
Always source the hex values from your Figma file — never guess or use default dart color names.

---

## HighlightedText — Known Limitation

`React.ComponentProps<typeof Text>` does not fully resolve in this project's TypeScript config.
The `c`, `size`, `lh`, and `wrap` props must be explicitly declared in the Props type:

```tsx
type Props = React.ComponentProps<typeof Text> & {
  text: string
  terms: string[]
  c?: string
  size?: "xs" | "sm" | "md" | "lg" | "xl"
  lh?: string
  wrap?: React.CSSProperties["flexWrap"]
}
```

---

## Tabs — Stable Interaction Selectors

dart's Tabs component uses Mantine's internal ID generation (`mantine-<random>-tab-<value>`) for tab element IDs. These IDs are random and unstable across page loads — never use them in selectors.

**Stable selectors for tab interactions:**

```
Click a tab:     [data-testid='<tabs-testid>'] [aria-controls$='-panel-<tabValue>']
Wait for panel:  [data-tab-id='<tabValue>'] <content-selector>
```

Example:
```json
[
  { "action": "click",   "selector": "[data-testid='my-tabs'] [aria-controls$='-panel-settings']" },
  { "action": "waitFor", "selector": "[data-tab-id='settings'] .tab-content" }
]
```

---

## Figma Panel `size-full` → Read Parent for Width

When a Figma panel uses `size-full`, no explicit width is shown. Call `get_design_context` on the parent frame to get the actual container width.

---

## Form / Detail Field Labels — Confirmed Gotcha

### Gotcha 9: Field labels are 14px medium dark, NOT gray/small

The most common mistake: using `size="sm" c="var(--text-contrast-low)"` (12px gray) for field labels in detail/form views. Figma specifies 14px medium dark for all field labels.

**Wrong:**
```tsx
<Text size="sm" c="var(--text-contrast-low)">{label}</Text>
```
**Correct:**
```tsx
<Text size="md" fw={500} c="var(--text-on-base, #020202)">{label}</Text>
```

---

## Breadcrumbs — Confirmed Gotchas

### Gotcha 10: Never rely on Breadcrumbs `size` prop for font-size — use explicit CSS

The dart Breadcrumbs `size` prop applies dart's text classes to each breadcrumb item. For `size="lg"`, the class sets `font-size: var(--mantine-font-size-lg) = 1rem = 16px` and `line-height: var(--mantine-line-height-lg) = 1.5rem = 24px`.

BUT: relying on CSS variables creates ambiguity in DevTools — the element bounding box HEIGHT equals the line-height (24px), which can be mistaken for font-size. Use explicit CSS instead to make the intent clear:

```css
/* your-header.module.css */
.header :global(.mantine-Breadcrumbs-breadcrumb) {
  font-size: 16px;   /* match Figma spec */
  line-height: 24px;
}
```

Use `<Breadcrumbs>` without a `size` prop — let the CSS handle font-size explicitly.

Also: pin separator margin explicitly — dart's `--bc-separator-margin: 0.25rem` (4px) can fall back to 10px if the CSS variable fails to cascade:
```css
.header :global(.mantine-Breadcrumbs-separator) {
  margin-inline: 4px; /* match Figma gap */
}
```

For breadcrumb link color (not applied automatically):
```css
.header :global(a) {
  color: var(--text-link, #2945f0);
}
```

For active breadcrumb items with mixed text sizes (e.g., a bold label at 14px inline with a value at 16px), use `<Text span size="md" fw={700}>` for the bold part — the explicit `size="md"` overrides the breadcrumb item's font-size to 14px:

```tsx
<Breadcrumbs>
  <Link to="/list">All Items</Link>
  <span>
    <Text span size="md" fw={700}>Category</Text>
    {` • value text`}  {/* inherits 16px from breadcrumb item */}
  </span>
</Breadcrumbs>
```

---

## Project Setup — Confirmed Gotcha

### Gotcha 11: app.css must import the dart design system font

dart's MantineProvider sets `--mantine-font-family` to the design system font (e.g. `"Geist"`). However, Mantine only applies this to components via `font-family: var(--mantine-font-family)`. Native elements (`html`, `body`) still inherit from the body font-family — this must be explicitly set in `app.css`.

If `app.css` is stale (still imports old font weights or sets an old font family), native elements render in the wrong font even though dart components appear correct.

**Correct pattern:**
```css
/* Import all used weight files for the design system font */
@import "@fontsource/geist/400.css";
@import "@fontsource/geist/500.css";
@import "@fontsource/geist/700.css";

:root {
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif, ...;
}

html, body {
  font-family: var(--font-sans), sans-serif;
}
```

Any stale `font-family: "OldFont"` declarations in CSS modules should be replaced with `font-family: inherit` or removed entirely.

---

## Outside-In Verification Order (Critical Process Rule)

**Never start at Level 3 (colors/spacing) without first verifying Level 1 (major sections).**

When pixel-twin runs on a details page or any multi-section layout:

1. **Level 0 first**: Verify page shell (layout structure exists, background color)
2. **Level 1 next**: Verify ALL major sections (header, sidebar, content area) — structure, width, padding, font hierarchy
3. **Level 2**: Component structure within each section
4. **Level 3 last**: Colors, border widths, icon sizes

The sidebar being 320px instead of 297px, using 12px gray field labels instead of 14px dark, and missing Delivery Method badge are all Level 1 failures. Fixing badge border colors (Level 3) while missing these is waste.
