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
--mantine-spacing-xs  = 10px
--mantine-spacing-sm  = 12px
--mantine-spacing-md  = 16px
--mantine-spacing-lg  = 20px
--mantine-spacing-xl  = 24px
```

Gap shortcuts: `gap="xs"` = 10px, `gap="sm"` = 12px, `gap="md"` = 16px, etc.

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

**Authoritative Figma reference: badge mapping node 66:8296, file Zh2dn0ePJAB3oDPxDc83Y0**

### Gotcha 7: Badge transparent prop removes background — white text becomes invisible
**Never pass** `bg="transparent"` or a `transparent` prop that sets `bg="transparent"` on a filled Badge.
With the default `filled` variant, Badge text is white (from Mantine CSS). If `bg="transparent"`,
the background disappears but text stays white → invisible on a light table background.
For progress column in a table: do NOT pass `transparent`. Render the filled colored badge directly.

### Gotcha 8: Progress badge colors — use explicit bgColor, not the dart colorMap
dart Badge `color` prop (neutral/success/warning/error) does NOT reliably match Figma's filled badge colors.
For progress badges, always use explicit `bg={config.bgColor}` with `style={{ color: config.textColor }}`.
Figma-specified progress badge hex colors:
- Processing / QC pre-delivery: `#2945f0` (blue, white text)
- Delivered: `#008545` (green, white text)
- Exception / Pending Datavant Review: `#a16b00` (amber, white text)
- Cancelled: `#606a78` (gray, white text)

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

## Figma Panel `size-full` → Read Parent for Width

When a Figma panel uses `size-full`, no explicit width is shown. Call `get_design_context` on the parent frame to get the actual container width.
