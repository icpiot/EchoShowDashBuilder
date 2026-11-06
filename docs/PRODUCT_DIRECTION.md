# Echo Show HTML Dash — product direction

This document records the requirements agreed in conversation on 7 November 2026. The original `echo-dashboard-custom-card-brief.md` remains the prototype and implementation reference. Where it assumes a different product shape, this document takes precedence until the brief is revised.

## Agreed direction

- Keep the owner's existing visual design as the reference, with the navigation menu at the top.
- Provide Cameras and Lights as the first prebuilt dashboards. Define Lights in a later discussion.
- Provide a Cameras setup form that lists available camera feeds and lets the user toggle each feed's inclusion in the Cameras dashboard.
- Accommodate feeds with different image resolutions and aspect ratios, including a 180-degree camera.
- Show the **entire image** for every included camera. Preserve its aspect ratio and do not crop it to fill a tile. Empty space around a feed is preferable to losing part of the image.
- Detect the dimensions of an image delivered to the browser when available and use its aspect ratio to help size the display. Image dimensions alone do not identify a camera's field of view or guarantee its sensor's native resolution.
- Install as a HACS dashboard plugin, then add the Echo Show dashboard through Home Assistant's dashboard creation flow.

## To define before implementation

- The exact configuration editor experience after installation; it should be selected based on the dashboard creation flow and may be a strategy editor rather than a standalone settings page.
- Whether users can override a detected aspect ratio or mark a feed as panoramic when the delivered image does not convey the desired layout.
- How included cameras are ordered, and how much space a wide feed should receive relative to other feeds.
- The specific navigation and Lights dashboard behavior.

The camera wall, package, and acceptance details in the original brief are provisional until reconciled with this direction.
