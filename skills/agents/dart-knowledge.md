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

⚠️ **`[data-value]` does NOT exist on `Tabs.Tab` buttons.** Do not write selectors like `[data-value='settings']` — this attribute is never rendered on Tab buttons. Use `[aria-controls$='-panel-<tabValue>']` or positional `[role='tablist'] [role='tab']:nth-child(N)` instead.

⚠️ **`keepMounted` gotcha:** Mantine Tabs defaults to `keepMounted={true}`. All tab panels stay in the DOM simultaneously — only the active panel is visible. After clicking to a tab, `waitFor: "[data-testid='my-content']"` may match a hidden panel from another tab. Prefer `[data-state='active'] [data-testid='my-content']`, or verify the bounding box is non-zero, to confirm you're measuring the visible panel.

---

## Combobox / MultiSelect / Select — DOM Selector Reference

**dart v1 uses Mantine v8 underneath** (`@mantine/core@8.x`, NOT v9). Mantine v8 MultiSelect/Select dropdowns use class-based selectors, NOT `data-*` attributes.

**Correct selectors for Mantine v8 dropdowns:**

| Component | DOM class | Notes |
|-----------|-----------|-------|
| `MultiSelect` dropdown | `.mantine-MultiSelect-dropdown` | Scoped with testid when `withinPortal:false` |
| `Select` dropdown | `.mantine-Select-dropdown` | Same scoping rules |
| `Combobox.Dropdown` | `.mantine-Combobox-dropdown` | Generic combobox dropdown |
| `DateInput` calendar | `.mantine-Popover-dropdown` | Uses Popover, not Combobox — different class |

**`[data-combobox-dropdown]` does NOT exist in Mantine v8.** This attribute is a Mantine v9 addition. Never use it as a selector for this project.

**When withinPortal:false (MultiSelect default override):** the dropdown renders inside the component's DOM subtree — use scoped selector:
```
[data-testid='filter-request-type'] .mantine-MultiSelect-dropdown
```

**When withinPortal:true** (default for DateInput calendar): popup is in `document.body` — use document-wide selector:
```
.mantine-Popover-dropdown
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

---

## Known dart v1 Components

Used by pixel-twin Step 3b-dart for auto-detection. A Figma node whose name contains any of these (case-insensitive, partial match) is a dart/Mantine instance.

| Name pattern | Notes |
|---|---|
| `Badge` | Formerly `Tag` in dart v0 |
| `Button`, `ActionIcon` | All variants and sizes |
| `Alert` | |
| `Tabs`, `Tab`, `TabsList`, `TabsPanel` | |
| `TextInput`, `PasswordInput`, `NumberInput` | |
| `Select`, `MultiSelect`, `NativeSelect` | |
| `DateInput`, `DatePicker`, `DateRangePicker` | |
| `Checkbox`, `Radio`, `Switch`, `Toggle` | |
| `Modal`, `Drawer`, `Overlay` | |
| `Tooltip`, `Popover`, `HoverCard` | |
| `Notification`, `Toast` | |
| `Breadcrumbs`, `NavigationBreadcrumbs` | |
| `Loader`, `Skeleton`, `Progress` | |
| `Avatar`, `AvatarGroup` | |
| `Menu`, `MenuItem`, `MenuDivider` | |
| `Pagination` | |
| `Table` | Mantine table — do NOT override `thead`/`tbody` internals |
| `Accordion`, `AccordionItem` | |
| `StatusTag` | Datavant custom — wraps dart Badge |
| `SidebarFooter` | Datavant custom |
| `Chip`, `ChipGroup` | |

---

## Form Component Wrapper Margins — Confirmed Gotcha

### Gotcha 12: Mantine form components inject margin/padding on their inner wrapper even without a label

Mantine form components — `Radio.Group`, `TextInput`, `Select`, `Checkbox.Group`, `Textarea`, etc. — wrap their content in an `Input.Wrapper` → inner Box structure. The inner Box (with `role="radiogroup"`, `role="combobox"`, etc.) receives margin from Mantine's InputWrapper spacing CSS, even when no `label` or `description` prop is supplied.

**Observed values:**
- `Radio.Group` inner `[role="radiogroup"]` → `margin-top: 8px; margin-bottom: 8px`
- Other form components may vary; always measure before assuming zero.

**Why it happens:** Mantine's `Input.Wrapper` CSS applies spacing to accommodate optional label/description slots. When these slots are empty, the margin remains. The outer `.mantine-InputWrapper-root` wrapper has no margin, so it is invisible in DevTools box-model until you inspect the child.

**Fix pattern — anchor to the SidebarFooter container and reset globally:**
```css
.container :global([role="radiogroup"]) {
  margin-top: 0;
  margin-bottom: 0;
}
```

**Long-term rule: whenever pixel-twin implements any Mantine/dart form component inside a custom flex layout WITHOUT a label/description, add `[role="radiogroup"]` / inner-wrapper margin rows to the Coverage Map and override to 0 in CSS.** Do not wait for a visual diff — measure it proactively.

**pixel-twin enforcement:** The Implementation Agent must, for every dart/Mantine form component used labelless, add rows:
```json
{ "selector": "...[role='radiogroup']", "property": "margin-top", "expected": "0px" }
{ "selector": "...[role='radiogroup']", "property": "margin-bottom", "expected": "0px" }
```
to the Coverage Map. Missing these rows = invisible spacing bug.

---

## Coverage Map Property Matrix

> Referenced from pixel-twin Step 3e. Defines the mandatory properties to extract per element type.

### Classification: container vs instance

A FRAME or GROUP that *wraps* dart/Mantine component instances is itself a **layout container** — extract its full layout property set. The dart/Mantine component's own root element is an **instance root** — apply instance rules only to that root. Do not misclassify wrapper divs as instance roots.

---

### LAYOUT CONTAINERS (any element with child nodes — FRAME, GROUP, wrapper div)

**Always extract ALL of these:**

| Category | Properties | Tolerance |
|----------|-----------|-----------|
| Display + flex | `display`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `align-content` | `exact-string` |
| Spacing | `gap`, `row-gap`, `column-gap` | `plus-minus-0.5px` |
| Overflow | `overflow`, `overflow-x`, `overflow-y` | `exact-string` |
| Padding | `padding-top`, `padding-right`, `padding-bottom`, `padding-left` | `plus-minus-0.5px` |
| Background | `background-color` | `exact-after-hex-rgb` |
| Border | `border-width`, `border-style`, `border-color`, `border-radius` | `exact-px` / `exact-string` / `exact-after-hex-rgb` |
| Bounding box | `boundingWidth`, `boundingHeight` | `plus-minus-2px` |

**Add when present in Figma or inferable:**

| Category | Properties | When to add |
|----------|-----------|-------------|
| Size constraints | `min-height`, `max-height`, `min-width`, `max-width`, `height`, `width` | Figma specifies a fixed or minimum dimension |
| Shadow | `box-shadow` | Figma shows a drop or inner shadow |
| Opacity | `opacity` | Figma opacity ≠ 1 |
| Position | `position`, `z-index`, `top`, `left`, `right`, `bottom` | Figma shows absolute/relative position with offsets |
| Margin | `margin-top`, `margin-right`, `margin-bottom`, `margin-left` | Figma shows non-zero margin |

**If this container is also a flex child, additionally add:** `flex-grow`, `flex-shrink`, `flex-basis`, `align-self`

---

### TEXT NODES (any element with direct text content)

**Always extract ALL of these:**

| Properties | Tolerance |
|-----------|-----------|
| `font-size` | `exact-px` |
| `font-weight` | `exact-px` |
| `line-height` | `plus-minus-1px` |
| `font-family` | `font-family-contains` |
| `color` | `exact-after-hex-rgb` |
| `text-align` | `exact-string` |
| `letter-spacing` | `plus-minus-0.5px` |
| `white-space` | `exact-string` |
| `text-overflow` | `exact-string` |
| `isOverflowingX` | `exact-string` (expected always `"false"`) |

**Add when present in Figma:** `text-decoration` (underline/strikethrough), `text-transform` (uppercase/lowercase), `overflow` (text clamp)

---

### dart/Mantine INSTANCE ROOT (outermost DOM element of a dart or Mantine component)

Verify only the root element — never attempt to override internal Mantine sub-elements via CSS.

**Always extract ALL of these:**

| Properties | Tolerance |
|-----------|-----------|
| `background-color` | `exact-after-hex-rgb` |
| `border-color` | `exact-after-hex-rgb` |
| `border-radius` | `exact-px` |
| `border-width` | `exact-px` |
| `boundingWidth` | `plus-minus-2px` |
| `boundingHeight` | `plus-minus-2px` |

**Add when applicable:** `height` (fixed height), `opacity` (≠1), `box-shadow`, `flex-grow`, `flex-shrink`, `flex-basis`, `align-self` (if flex child)

---

### SVG / ICON ELEMENTS

| Properties | Tolerance |
|-----------|-----------|
| `boundingWidth` | `plus-minus-2px` |
| `boundingHeight` | `plus-minus-2px` |
| `color` | `exact-after-hex-rgb` (for `currentColor`-based icons) |
| `fill` | `exact-after-hex-rgb` (if explicitly set, not `currentColor`) |

#### Tabler icons — critical measurement rules

Tabler icons (`@tabler/icons-react`) render as `<svg>` elements with `fill="none"` and use `stroke` to draw paths. The React `color` prop sets the CSS `color` property on the `<svg>` root, which drives `currentColor` for the stroke.

**What this means for Coverage Map rows:**

| Figma shows | Code prop | Measure via `getComputedStyle` | Coverage Map property |
|---|---|---|---|
| Fill: black / any color on a path node | `color="var(--token, #hex)"` | **`stroke`** (not `color`, not `fill`) | `"property": "stroke"` |
| Fill: none on `<svg>` root | `fill="none"` attribute (implicit) | `fill` on `<svg>` root = `"none"` | `"property": "fill"`, `"expected": "none"` |

**Why `getComputedStyle(svgRoot).color` is wrong:** CSS `color` on the SVG root is inherited from the page's body/root, NOT from the Tabler `color` prop. It reads as `rgb(0, 0, 0)` regardless of the prop value. Do NOT use `color` to verify Tabler icon color.

**Correct row format for a Tabler icon:**
```json
{
  "selector": "[data-testid='dropzone-area'] > svg",
  "property": "stroke",
  "expected": "rgb(2, 2, 2)",
  "tolerance": "exact-after-hex-rgb",
  "figmaValue": "#020202"
}
```

**When Figma exports icon as an image asset (`<img src=...>`):** Use `imagePixelColor` DOM metric to sample the center pixel color via Canvas API. Add this row:
```json
{
  "selector": "[data-testid='my-icon'] img",
  "property": "imagePixelColor",
  "expected": "rgb(0, 0, 0)",
  "tolerance": "exact-after-hex-rgb",
  "figmaValue": "#000000"
}
```
Possible return values from `imagePixelColor`:
- `"rgb(R, G, B)"` — success; compare with tolerance `exact-after-hex-rgb`
- `"cross-origin"` — CORS blocks canvas read; set `status: "needs-verify"` and flag for server-side CORS config
- `"not-an-img"` — selector hit a non-`<img>` element; fix selector
- `"not-loaded"` — image not fully loaded; check `--wait-for` selector
- `"canvas-unavailable"` — rare browser context issue; treat as `needs-verify`

**Note**: `imagePixelColor` samples the exact center pixel. For icons where the center is transparent background (not the icon glyph), adjust the sampling point by cropping to the icon bounding box or using a selector that targets a non-transparent region.

**Always call `get_design_context` on the icon's Figma node** to get the actual fill color. Never assume Tabler default colors — different icons and usage contexts specify different fills.

---

### Bounding-box rows — universal safety net

Every significant container, every dart/Mantine instance root, every direct flex child, and every icon element gets `boundingWidth` and `boundingHeight` rows. Any layout bug (wrong flex, wrong overflow, wrong sizing) produces a bounding-box deviation that these rows catch, even when the specific CSS property wasn't anticipated.

For elements where Figma shows `layoutSizingHorizontal: FILL` or code uses `w-full`:
- Add `note: "fills parent — verify element.boundingWidth ≈ container.boundingWidth"`

If the app is not yet running (Build Mode before code exists): set `expected: null` and `status: "needs-verify"`.

---

### Tolerance key reference

| Key | When to use |
|-----|-------------|
| `exact-after-hex-rgb` | `color`, `background-color`, `border-color`, `fill` |
| `alpha-0.01` | rgba alpha channel (±0.01) |
| `exact-px` | `font-size`, `font-weight`, `border-radius`, `border-width`, `letter-spacing` |
| `exact-string` | `display`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `align-content`, `align-self`, `flex-basis`, `overflow`, `overflow-x`, `overflow-y`, `white-space`, `text-overflow`, `text-align`, `text-decoration`, `text-transform`, `position`, `visibility`, `isOverflowingX`, `isOverflowingY` |
| `plus-minus-1px` | `line-height`, `width`, `height`, `top`, `left`, `right`, `bottom` |
| `plus-minus-2px` | `boundingWidth`, `boundingHeight` |
| `plus-minus-0.5px` | `padding`, `gap`, `row-gap`, `column-gap`, `margin`, `letter-spacing` |
| `box-shadow-normalized` | `box-shadow` |
| `font-family-contains` | `font-family` |
