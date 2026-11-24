# Project design skills

These five skills were installed from [google-labs-code/stitch-skills](https://github.com/google-labs-code/stitch-skills) for this repository:

- `taste-design` — design-system guidance for `DESIGN.md`
- `design-md` — extract a design system from an existing Stitch project
- `generate-design` — generate or edit screens in Stitch
- `manage-design-system` — dependency for applying `DESIGN.md` to a Stitch project
- `upload-to-stitch` — dependency for image-based generation

The copied upstream files are governed by [the included Apache 2.0 license](LICENSE.stitch-skills). The project-specific direction is in [`../../DESIGN.md`](../../DESIGN.md); owner reference images and `docs/PRODUCT_DIRECTION.md` take precedence over generic examples in these skills.

The skills are available to Codex in this project. `design-md`, `generate-design`, `manage-design-system`, and `upload-to-stitch` require a configured Google Stitch MCP connection for their Stitch operations. `design-md` also requires a Stitch project with at least one designed screen. The current Codex tool inventory has no Stitch MCP tools, so those operations cannot yet run here. Local design guidance and the project `DESIGN.md` remain usable.

The owner has paused redesign implementation pending explicit approval. Installing these skills and writing `DESIGN.md` does not lift that pause.
