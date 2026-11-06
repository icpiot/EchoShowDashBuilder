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

## Menu requirements

- The menu is configured during dashboard setup.
- The setup must allow the user to choose exactly which menu items are shown and their order.
- A dashboard profile may contain any practical number of menu items, including one item or five items.
- Menu configuration belongs to the dashboard profile, so different dashboards can have different menus.
- A dashboard profile may be assigned to a specific Echo Show or room. For example, a lounge profile can expose five menu items while a bedroom profile exposes one or two.
- The menu should support the built-in Cameras and Lights destinations, with future destinations added without changing the profile model.
- Menu items should retain their label, icon, destination, and optional active-state styling.
- The runtime dashboard must render only the configured items for that profile; it must not show unused destinations by default.
- Each dashboard profile must include a kiosk mode toggle, independently set to on or off.
- Kiosk mode is a profile preference, so a lounge display can use kiosk mode while a bedroom display does not.
- When kiosk mode is enabled, the dashboard should present the configured dashboard content without unnecessary Home Assistant chrome; the exact supported presentation mechanism must be verified against the HA111 frontend before implementation.

The initial configuration model should therefore be equivalent to:

```yaml
profiles:
  lounge:
    target: "Echo Show Lounge"
    kiosk_mode: true
    menu:
      - cameras
      - lights
      - home
      - weather
      - security
  bedroom:
    target: "Echo Show Bedroom"
    kiosk_mode: false
    menu:
      - cameras
```

The exact Home Assistant storage and device-assignment mechanism remains to be selected during implementation. The important boundary is that menu selection is per dashboard profile, not a single global setting.

## To define before implementation

- The exact configuration editor experience after installation; it should be selected based on the dashboard creation flow and may be a strategy editor rather than a standalone settings page.
- Whether users can override a detected aspect ratio or mark a feed as panoramic when the delivered image does not convey the desired layout.
- How included cameras are ordered, and how much space a wide feed should receive relative to other feeds.
- The specific navigation and Lights dashboard behavior.

The camera wall, package, and acceptance details in the original brief are provisional until reconciled with this direction.
