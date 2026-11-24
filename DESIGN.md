# Echo Show Dash Builder design system

This document defines the visual and interaction standard for the PC builder and its Echo layout previews. The owner's three reference images in the repository (`ChatGPT Image 24 Nov 2026, 16_19_35.png`, `16_19_49.png`, and `16_20_12.png`) establish the intended composition for Overview, Menus & Content, and Deployment. `docs/PRODUCT_DIRECTION.md` remains the authority for product behavior and data. This design system does not change the dashboard schema or authorize a redesign implementation.

## Design character

A calm, precise workspace for configuring a household device. It should feel like one coherent product: clear hierarchy, generous but disciplined spacing, restrained color, and dense settings that remain easy to scan. Functional controls take priority over decoration. The interface may be visually refined without adding unnecessary animation, invented metrics, or decorative cards.

The PC builder has four persistent destinations: **Overview**, **Menus & Content**, **Controls & Status**, and **Deployment**. The selected destination is unmistakable. The application header, navigation, page title, panel headings, form controls, and actions retain the same visual grammar on every page.

## Palette and typography

| Role | Value | Use |
| --- | --- | --- |
| Canvas | `#F5F6FB` | Workspace background |
| Surface | `#FFFFFF` | Panels, inputs, and secondary buttons |
| Ink | `#20243A` | Primary copy |
| Muted ink | `#66708C` | Explanatory copy and metadata |
| Border | `#E1E5F2` | Structural separation and input outlines |
| Accent | `#523BD7` | One primary action, selected navigation, focus |
| Accent wash | `#F2EFFF` | Selected rows and quiet emphasis |
| Success | `#19733D` | Verified readiness only |
| Attention | `#8A5500` | Needs setup or warning only |
| Destructive | `#A23B53` | Removal actions only |

Use one restrained violet accent across the builder because it is present in the owner's examples. Avoid competing blue, green, or purple action colors. Status colors convey meaning and do not become alternate brand colors. No neon glow, gradient text, or heavy shadow.

Use a clear sans serif stack (`"Segoe UI", Arial, sans-serif`) without requiring a downloaded font. Page titles are 24–30 px, panel titles 16–18 px, body text 14–16 px, labels at least 13 px, and helper text at least 12 px with comfortable line height. Use weight and spacing before adding another color. Preserve readable Home Assistant light and dark theme behavior when the builder is embedded.

## Layout and responsive behavior

- At desktop width, keep the builder's navigation rail persistent and visually quieter than the current page. The page content must remain usable inside Home Assistant's own sidebar, not only in a full browser window.
- Use a consistent 8 px spacing rhythm: 8 px within a control, 16 px between related controls, 24 px between major groups. Panels use 12–14 px corner radii, 1 px borders, and a light shadow only where it clarifies hierarchy.
- Overview has a main workspace and a narrower device/publish rail. Menus & Content has a menu list, the selected menu editor, and an Echo preview when space allows. Controls & Status uses the same panel and form language. Deployment groups device/presentation, preview, readiness/action, and applied history.
- When three columns make the menu editor too narrow, reduce rail widths or stack the preview. Never compress a form until its fields overflow. At phone width, use one content column and make navigation usable without horizontal page overflow.
- Every grid child, field, and panel must be able to shrink (`min-width: 0` in implementation). Long entity names and native select options stay within their panel. Text may wrap or truncate with an accessible full value; no input or menu extends across adjacent columns.
- The Echo preview is a **layout guide**, clearly identified as such. It should reflect selected menu order, camera order, tile widths, and included entities. It must not imply a live image or physical Echo state unless that state was actually loaded.

## Components

**Buttons.** One primary filled accent action per decision area; secondary actions use a white surface, border, accent or ink text; destructive actions use the destructive text/border treatment. All share a 38–44 px minimum height, 8–9 px radius, consistent font weight, hover, focus, disabled, and pressed states. Similar actions have similar sizes. Avoid browser-default buttons mixed with styled buttons. Keep labels action-specific: Save Draft, Add menu, Remove menu, Apply to Echo.

**Forms.** Put labels above fields; helper text below the relevant field or group. Inputs and selects have the same height, radius, border, surface, and focus ring. A long entity option must not change the field's width. Camera settings should be a tidy, responsive grid with each select contained in its column. Checkboxes have a clear label and a comfortable click area.

**Panels and lists.** Use panels for meaningful groups, not every individual row. Menu selection is a distinct row state; editing is shown in one selected editor. Included items are ordered and visible near that editor. Dividers separate repeated rows. Empty states say what can be added next. Removal controls are visible but visually subordinate to save/apply.

**Echo previews.** Show the actual configured labels, order, and spans in a compact device frame. Keep a clear distinction between a visual preview, an applied dashboard, and the physical Echo. Camera tile width in the preview follows the configured one-to-three-box setting where the preview grid permits it; do not show a two-box Street camera as a one-box tile or place it after cameras with a later order.

**Status.** Readiness messages state the specific condition. Never use a green success treatment for an unverified deployment or device response. Applied history uses real saved data rather than placeholder metrics.

## Page composition

1. **Overview:** current Dash and Echo context, a compact setup path, real status, Dash Library, and concise links into configuration. Device and publish details sit in a secondary rail.
2. **Menus & Content:** persistent menu list; one selected menu editor; included items, camera settings, and content groups in a sensible reading order; a preview that agrees with the controls. The editor receives priority over the preview when space is tight.
3. **Controls & Status:** separate controls and status groups with the same header, spacing, field, and button rules. Keep configuration scannable and avoid a raw stack of unrelated settings.
4. **Deployment:** clear device/presentation settings, a large but honest Echo preview, readiness details, one Apply to Echo action, and applied dashboard history. Do not visually equate a draft with an applied copy.

## Interaction and quality gate

Use restrained 120–200 ms transitions for hover/selection where helpful. Respect reduced-motion preferences. Avoid perpetual animation in the builder. Keyboard focus must remain visible, icon-only actions need labels, and target sizes should be comfortable for touch. Content and state must be understandable without color alone.

Before a redesign is accepted, review screenshots of all four pages at a typical desktop width **inside Home Assistant**, plus a narrow viewport. Check at least one long camera entity and an expanded camera settings panel, menu switching, the Dash Library controls, and Deployment. Reject clipping, inconsistent button styles, mismatched preview order/size, or unreadable select values. Typecheck and existing tests must pass; live deployment and physical Echo behavior are separate verification milestones.

## Design team tools and approval boundary

Project skills live in `.agents/skills/`: `taste-design`, `design-md`, `generate-design`, `manage-design-system`, and `upload-to-stitch`. `taste-design` can inform local design guidance. The Stitch project workflows require a configured Stitch MCP connection and, for `design-md`, a Stitch project containing a designed screen. Their guidance is adapted to this product and these references; generic examples in a skill do not override the owner's design.

This document and the installed skills are design preparation. **Do not implement or deploy another redesign until the owner explicitly approves it.**
