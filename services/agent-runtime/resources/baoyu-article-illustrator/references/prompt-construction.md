# Prompt Construction

## Prompt File Format

Each prompt file uses YAML frontmatter + content:

```yaml
---
illustration_id: 01
type: infographic
style: blueprint
references:                    # ⚠️ ONLY if files EXIST in references/ directory
  - ref_id: 01
    filename: 01-ref-diagram.png
    usage: direct              # direct | style | palette
---

[Type-specific template content below...]
```

**⚠️ CRITICAL - When to include `references` field**:

| Situation | Action |
|-----------|--------|
| Reference file saved to `references/` | Include in frontmatter ✓ |
| Style extracted verbally (no file) | DO NOT include in frontmatter, append to prompt body instead |
| File path in frontmatter but file doesn't exist | ERROR - remove references field |

**Reference Usage Types** (only when file exists):

| Usage | Description | Generation Action |
|-------|-------------|-------------------|
| `direct` | Primary visual reference | Pass to `--ref` parameter |
| `style` | Style characteristics only | Describe style in prompt text |
| `palette` | Color palette extraction | Include colors in prompt |

**If no reference file but style/palette extracted verbally**, append directly to prompt body:
```
COLORS (from reference):
- Primary: #E8756D coral
- Secondary: #7ECFC0 mint
...

STYLE (from reference):
- Clean lines, minimal shadows
- Gradient backgrounds
...
```

---

## Default Composition Requirements

**Apply to ALL prompts by default**:

| Requirement | Description |
|-------------|-------------|
| **Clean composition** | Simple layouts, no visual clutter |
| **White space** | Generous margins, breathing room around elements |
| **No complex backgrounds** | Solid colors or subtle gradients only, avoid busy textures |
| **Centered or content-appropriate** | Main visual elements centered or positioned by content needs |
| **Matching graphics** | Use graphic elements that align with content theme |
| **Highlight core info** | White space draws attention to key information |

**Add to ALL prompts**:
> Clean composition with generous white space. Simple or no background. Main elements centered or positioned by content needs.

---

## Color Specification Rules

Colors in prompts use hex codes for **rendering guidance only** — they tell the model which colors to use, NOT what text to display.

**⚠️ CRITICAL**: Image generation models sometimes render color names and hex values as visible text labels in the image (e.g., painting "Macaron Blue #A8D8EA" as a label). This must be prevented.

**Add to ALL prompts that contain a COLORS section**:
> Color values (#hex) and color names are rendering guidance only — do NOT display color names, hex codes, or palette labels as visible text in the image.

---

## Character Rendering

When depicting people:

| Guideline | Description |
|-----------|-------------|
| **Style** | Simplified cartoon silhouettes or symbolic expressions |
| **Avoid** | Realistic human portrayals, detailed faces |
| **Diversity** | Varied body types when showing multiple people |
| **Emotion** | Express through posture and simple gestures |

**Add to ALL prompts with human figures**:
> Human figures: simplified stylized silhouettes or symbolic representations, not photorealistic.

---

## Text in Illustrations

正文配图默认不渲染文字。文章正文只用于确定视觉主题，不得原样复制到 `ZONES`、`LABELS` 或图片标题中。只有用户明确要求标注时，才允许最多三个极短关键词；复杂说明应回到文章正文，而不是塞进图片。

| Element | Guideline |
|---------|-----------|
| **Size** | If explicitly requested, short and secondary; otherwise no readable text |
| **Style** | Handwritten fonts preferred for warmth |
| **Content** | At most three short keywords when explicitly requested; never paragraphs, tables, metrics, or quotes |
| **Language** | Match article language |

**Add to prompts with text**:
> Text should be large and prominent with handwritten-style fonts. Keep minimal, focus on keywords.

---

## Principles

Good prompts must include:

1. **Layout Structure First**: Describe composition, zones, flow direction
2. **Specific visual subject**: Use one concrete subject or relationship from the article; include labels only when explicitly requested
3. **Visual Relationships**: How elements connect
4. **Semantic Colors**: Meaning-based color choices (red=warning, green=efficient)
5. **Style Characteristics**: Line treatment, texture, mood
6. **Aspect Ratio**: End with ratio and complexity level

## Type-Specific Templates

### Infographic

```
[Title] - Data Visualization

Layout: [grid/radial/hierarchical]

ZONES:
- One focal subject: [single concept or relationship from the article]
- Supporting element 1: [optional simple visual cue]
- Supporting element 2: [optional simple visual cue]

LABELS: [omit by default; at most three short terms only when explicitly requested]
COLORS: [semantic color mapping]
STYLE: [style characteristics]
ASPECT: 16:9
```

**Infographic + sketch-notes + macaron palette** (legacy preset;正文配图默认使用单主体规则):
```
Single-subject hand-drawn editorial illustration in a clean, airy style.
Warm cream paper background, black hand-drawn lines with slight wobble, and at
most three soft pastel visual accents. Keep the image easy to understand at a
glance without turning the article into a presentation slide.
Diagram-style visuals ONLY — no realistic or photographic images. Do not render
readable text unless the user explicitly asks for up to three short labels.

PALETTE: macaron — soft pastel blocks on warm cream
COLORS: Warm Cream background (#F5F0E8); Black (#1A1A1A) for ALL lines, text,
        arrows, and doodles; section fills in Light Blue (#A8D8EA), Mint Green
        (#B5E5CF), Lavender (#D5C6E0), Peach (#FFD5C2); Coral Red (#E8655A)
        sparingly for one or two emphasis points only.

LAYOUT:
- CENTER: One clear focal subject representing one article concept.
- SUPPORT: At most two simple visual cues or connectors that clarify the subject.
- SPACE: Generous empty space; no grids, dashboards, card walls, or poster-like
         title and takeaway areas.

ELEMENTS: One simple icon or sketchy cartoon element (stick figure, tool, or
          object) plus at most two quiet supporting marks. Avoid labels, dense
          arrows, repeated boxes, and decorative text.

STYLE: Minimal, well-organized, airy. Color fills don't completely fill
       outlines (slight "hand-painted" overshoot). If labels are explicitly
       requested, use hand-lettered short keywords only; never long paragraphs.
       Generous white space around the focal subject.
```

**Infographic + vector-illustration**:
```
Flat vector illustration infographic. Clean black outlines on all elements.
COLORS: Cream background (#F5F0E6), Coral Red (#E07A5F), Mint Green (#81B29A), Mustard Yellow (#F2CC8F)
ELEMENTS: Geometric simplified icons, no gradients, playful decorative elements (dots, stars)
```

**Infographic + vector-illustration + warm palette**:
```
Flat vector illustration infographic. Clean black outlines on all elements.
PALETTE OVERRIDE (warm): Warm-only color palette, no cool colors.
COLORS: Soft Peach background (#FFECD2), Warm Orange (#ED8936),
        Terracotta (#C05621), Golden Yellow (#F6AD55), Deep Brown (#744210)
ELEMENTS: Geometric simplified icons, no gradients, rounded corners,
          modular card layout, consistent icon style
```

### Scene

```
[Title] - Atmospheric Scene

FOCAL POINT: [main subject]
ATMOSPHERE: [lighting, mood, environment]
MOOD: [emotion to convey]
COLOR TEMPERATURE: [warm/cool/neutral]
STYLE: [style characteristics]
ASPECT: 16:9
```

### Flowchart

```
[Title] - Process Flow

Layout: [left-right/top-down/circular]

STEPS:
1. [Step name] - [brief description]
2. [Step name] - [brief description]
...

CONNECTIONS: [arrow types, decision points]
STYLE: [style characteristics]
ASPECT: 16:9
```

**Flowchart + vector-illustration**:
```
Flat vector flowchart with bold arrows and geometric step containers.
COLORS: Cream background (#F5F0E6), steps in Coral/Mint/Mustard, black outlines
ELEMENTS: Rounded rectangles, thick arrows, simple icons per step
```

**Flowchart + sketch-notes + macaron palette**:
```
Hand-drawn educational flowchart on warm cream paper. Slight wobble on all lines.
PALETTE: macaron — soft pastel color blocks
COLORS: Warm Cream background (#F5F0E8), zone fills in Macaron Blue (#A8D8EA),
        Lavender (#D5C6E0), Mint (#B5E5CF), Coral Red (#E8655A) for emphasis
ELEMENTS: Rounded cards with dashed/solid borders, wavy hand-drawn arrows with labels,
          simple stick-figure characters, doodle decorations (stars, underlines)
STYLE: Color fills don't completely fill outlines, hand-drawn lettering, generous white space
```

**Flowchart + ink-notes + mono-ink palette**:
```
Professional hand-drawn visual-note flowchart on pure white. Black ink line work
with slight wobble, à la Mike Rohde sketchnoting.
PALETTE: mono-ink — black ink dominant, sparse semantic accents
COLORS: Pure White background (#FFFFFF), Near Black (#1A1A1A) for all lines,
        text, and figures; Coral Red (#E8655A) only for risk/emphasis,
        Muted Teal (#5FA8A8) only for positive/solution states
ELEMENTS: Left-to-right stage boxes with rounded-rect frames, wavy hand-drawn
          arrows between stages, simple stick-figure characters with role
          labels above (e.g., "ML Engineer", "Team Lead"), dashed-border box
          for future/empty stage, small doodle icons per stage
STYLE: Hand-lettered titles (bold, oversized), handwritten stage labels and
        annotations, generous white space, bottom tagline summarizing takeaway
```

### Comparison

```
[Title] - Comparison View

LEFT SIDE - [Option A]:
- [Point 1]
- [Point 2]

RIGHT SIDE - [Option B]:
- [Point 1]
- [Point 2]

DIVIDER: [visual separator]
STYLE: [style characteristics]
ASPECT: 16:9
```

**Comparison + vector-illustration**:
```
Flat vector comparison with split layout. Clear visual separation.
COLORS: Left side Coral (#E07A5F), Right side Mint (#81B29A), cream background
ELEMENTS: Bold icons, black outlines, centered divider line
```

**Comparison + vector-illustration + warm palette**:
```
Flat vector comparison with split layout. Clear visual separation.
PALETTE OVERRIDE (warm): Warm-only color palette, no cool colors.
COLORS: Left side Warm Orange (#ED8936), Right side Terracotta (#C05621),
        Soft Peach background (#FFECD2), Deep Brown (#744210) accents
ELEMENTS: Bold icons, black outlines, centered divider line
```

**Comparison + ink-notes + mono-ink palette** (Before/After, Traditional vs New):
```
Professional hand-drawn sketchnote comparison on pure white. Black ink line work
with slight wobble, à la Mike Rohde sketchnoting.
PALETTE: mono-ink — black ink dominant, sparse semantic accents
COLORS: Pure White background (#FFFFFF), Near Black (#1A1A1A) for all outlines,
        text, figures, arrows; Coral Red (#E8655A) reserved for risks/gaps
        (left/Before side); Muted Teal (#5FA8A8) reserved for positives
        (right/After side). Color accents under 10% of canvas.
LAYOUT: Left | Right split with vertical hand-drawn divider. Hand-lettered
        "Before" label (top-left) and "After" label (top-right).
LEFT SIDE: Stick figure(s) with role label above, speech bubble showing the
           pain point, bulleted pain-point list in handwritten text.
RIGHT SIDE: Stick figure(s) showing the new state, bulleted improvement list,
            small positive-action icons.
BRIDGE: Curved hand-drawn "mindset shift" arrow bridging left → right with
        small inline label describing the shift.
BOTTOM: Single-line hand-lettered tagline summarizing the takeaway.
STYLE: Hand-lettered headings (bold, oversized), handwritten body annotations,
        generous white space, no computer fonts, no gradients, no shadows.
```

### Framework

```
[Title] - Conceptual Framework

STRUCTURE: [hierarchical/network/matrix]

NODES:
- [Concept 1] - [role]
- [Concept 2] - [role]

RELATIONSHIPS: [how nodes connect]
STYLE: [style characteristics]
ASPECT: 16:9
```

**Framework + vector-illustration**:
```
Flat vector framework diagram with geometric nodes and bold connectors.
COLORS: Cream background (#F5F0E6), nodes in Coral/Mint/Mustard/Blue, black outlines
ELEMENTS: Rounded rectangles or circles for nodes, thick connecting lines
```

**Framework + vector-illustration + warm palette**:
```
Flat vector framework diagram with geometric nodes and bold connectors.
PALETTE OVERRIDE (warm): Warm-only color palette, no cool colors.
COLORS: Soft Peach background (#FFECD2), nodes in Warm Orange (#ED8936),
        Terracotta (#C05621), Golden Yellow (#F6AD55), black outlines
ELEMENTS: Rounded rectangles or circles for nodes, thick connecting lines
```

**Framework + ink-notes + mono-ink palette** (command center, OS analogy):
```
Professional hand-drawn sketchnote framework on pure white. Black ink line work
with slight wobble, à la Mike Rohde sketchnoting.
PALETTE: mono-ink — black ink dominant, sparse semantic accents
COLORS: Pure White background (#FFFFFF), Near Black (#1A1A1A) for all lines,
        text, figures; Dusty Lavender (#9B8AB5) for neutral category tags only;
        Coral Red (#E8655A) for emphasis sparingly. Color accents under 10%.
STRUCTURE: Central rounded-rectangle frame as "the system" with hand-lettered
           title inside. Inner layer of labeled sub-components (node labels
           above each). Outer layer of feeder arrows from stick-figure
           operators/users with role labels.
ELEMENTS: Stick figures at the edges with role tags ("Team Lead", "Operator"),
          wavy hand-drawn connector arrows with small inline labels, small
          doodle icons per component, dashed-border placeholder(s) for
          future/empty capabilities.
BOTTOM: Single-line hand-lettered tagline.
STYLE: Hand-lettered headings, handwritten annotations, generous white space,
        no computer fonts, no gradients.
```

### Timeline

```
[Title] - Chronological View

DIRECTION: [horizontal/vertical]

EVENTS:
- [Date/Period 1]: [milestone]
- [Date/Period 2]: [milestone]

MARKERS: [visual indicators]
STYLE: [style characteristics]
ASPECT: 16:9
```

### Screen-Print Style Override

When `style: screen-print`, replace standard style instructions with:

```
Screen print / silkscreen poster art. Flat color blocks, NO gradients.
COLORS: 2-5 colors maximum. [Choose from style palette or duotone pair]
TEXTURE: Halftone dot patterns, slight color layer misregistration, paper grain
COMPOSITION: Bold silhouettes, geometric framing, negative space as storytelling element
FIGURES: Silhouettes only, no detailed faces, stencil-cut edges
TYPOGRAPHY: Bold condensed sans-serif integrated into composition (not overlaid)
```

**Scene + screen-print**:
```
Conceptual poster scene. Single symbolic focal point, NOT literal illustration.
COLORS: Duotone pair (e.g., Burnt Orange #E8751A + Deep Teal #0A6E6E) on Off-Black #121212
COMPOSITION: Centered silhouette or geometric frame, 60%+ negative space
TEXTURE: Halftone dots, paper grain, slight print misregistration
```

**Comparison + screen-print**:
```
Split poster composition. Each side dominated by one color from duotone pair.
LEFT: [Color A] side with silhouette/icon for [Option A]
RIGHT: [Color B] side with silhouette/icon for [Option B]
DIVIDER: Geometric shape or negative space boundary
TEXTURE: Halftone transitions between sides
```

---

## Palette Override

When a palette is specified (via `--palette` or preset), it overrides the style's default colors:

1. Read style file → get rendering rules (Visual Elements, Style Rules, line treatment)
2. Read palette file (`palettes/<palette>.md`) → get Colors + Background
3. Palette Colors **replace** style's default Color Palette in prompt
4. Palette Background **replaces** style's Background color (keep style's texture description)
5. Build prompt: style rendering instructions + palette colors

**Prompt frontmatter** includes palette when specified:
```yaml
---
illustration_id: 01
type: infographic
style: vector-illustration
palette: macaron
---
```

**Example**: `vector-illustration` + `macaron` palette:
```
Flat vector illustration infographic. Clean black outlines on all elements.
PALETTE: macaron — soft pastel color blocks
COLORS: Warm Cream background (#F5F0E8), Macaron Blue (#A8D8EA), Mint (#B5E5CF),
        Lavender (#D5C6E0), Peach (#FFD5C2), Coral Red (#E8655A) for emphasis
ELEMENTS: Geometric simplified icons, no gradients, playful decorative elements
```

When no palette is specified, use the style's built-in Color Palette as before.

---

## What to Avoid

- Vague descriptions ("a nice image")
- Literal metaphor illustrations
- Missing concrete labels/annotations
- Generic decorative elements

## Watermark Integration

If watermark enabled in preferences, append:

```
Include a subtle watermark "[content]" positioned at [position].
```
