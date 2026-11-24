# Echo Show Dash Builder — product direction

This document records the requirements agreed in conversation on 7 November 2026. The original `echo-dashboard-custom-card-brief.md` remains the prototype and implementation reference. Where it assumes a different product shape, this document takes precedence until the brief is revised.

## Agreed direction

- Keep the owner's existing visual design as the reference, with the navigation menu at the top.
- Provide Cameras and Lights as the first built-in content types. The Lights content lists the selected Home Assistant light entities, provides on/off controls, and offers brightness adjustment when a light exposes brightness.
- Provide a camera setup form that lists available camera feeds and lets the user toggle each feed's inclusion in a menu.
- Accommodate feeds with different image resolutions and aspect ratios, including a 180-degree camera.
- Show the **entire image** for every included camera. Preserve its aspect ratio and do not crop it to fill a tile. Empty space around a feed is preferable to losing part of the image.
- Detect the dimensions of an image delivered to the browser when available and use its aspect ratio to help size the display. Image dimensions alone do not identify a camera's field of view or guarantee its sensor's native resolution.
- Install as a HACS dashboard plugin, then add the Echo Show dashboard through Home Assistant's dashboard creation flow.

## Menu requirements

- The menu is configured during dashboard setup.
- The setup must allow the user to choose exactly which menu items are shown and their order.
- A dashboard profile may contain any practical number of menu items, including one item or five items.
- Menu configuration belongs to the dashboard profile, so different dashboards can have different menus.
- The editor is an Echo-specific menu builder: users add or remove menus, name each one, choose its icon, and select the content shown in that menu.
- Each menu can contain selected camera feeds and selected light controls. These are the first supported content types; new types can be added without returning to a fixed Home/Cameras/Lights menu set.
- A dashboard profile may be assigned to a specific Echo Show or room. For example, a lounge profile can expose five menu items while a bedroom profile exposes one or two.
- Menu content should support the built-in camera and light controls, with future content types added without changing the profile model.
- Menu items should retain their label, icon, destination, and optional active-state styling.
- The runtime dashboard must render only the configured items for that profile; it must not show unused destinations by default.
- The master dashboard remains usable on a PC with kiosk mode off. Echo copies created from the master use kiosk mode.
- Saved setups are kept in the master dashboard independently of Echo devices, so one setup can be recreated for any Echo later.

The initial configuration model should therefore be equivalent to:

```yaml
profiles:
  front-cameras:
    name: "Front cameras"
    menus:
      - id: front
        label: "Front"
        icon: mdi:cctv
        cameras: [camera.front, camera.frontdoor]
        lights: [light.front_door]
      - id: inside
        label: "Inside"
        icon: mdi:home
        cameras: [camera.left, camera.right]
        lights: [light.living_room]
  bedroom:
    name: "Bedroom"
    menus:
      - id: cameras
        label: "Cameras"
        icon: mdi:cctv
        cameras: [camera.bedroom]
```

A saved setup defines menus and visual settings without being bound to an Echo. Select the destination Echo only when creating and applying a copy.

## Builder and Echo dashboards

- Keep one PC builder dashboard out of kiosk mode so the owner can edit it easily.
- Store reusable, named dashboard setups in the master dashboard. Selecting one loads its settings into the builder.
- In the builder, select an Echo Show and set its presentation mode and dashboard-when-idle preference.
- Applying a setup creates a kiosk-mode dashboard from its menus, cameras, lights, order, and appearance settings, then attaches it to the selected Echo Show. After the new dashboard is attached successfully, any older dashboards made by this builder for that same Echo are deleted. There is no archive of prior applied copies.
- Saved setups remain in the builder independently of Echo devices. The builder and its preview remain available on the PC; an unapplied setup does not create a separate dashboard in Home Assistant.
- The builder lists currently applied dashboards it created and lets the owner remove them without affecting the Echo device. Dashboards for other Echo devices are untouched when applying a setup.
- Editing the builder does not silently change an applied Echo dashboard; apply again to replace the current builder-created dashboard for the selected Echo.
- The existing camera reference to reproduce is **Show 8, menu 5**. It is the source dashboard for the first camera-wall implementation and comparison.
- A successful PC test does not by itself count as live Echo Show verification.

The builder uses Home Assistant's dashboard management commands and the selected TECHO5 device's dashboard-path action to create and attach the Echo copy. These operations are scoped to the selected device.

## To define before implementation

- Whether users can override a detected aspect ratio or mark a feed as panoramic when the delivered image does not convey the desired layout.
- How wide feeds should be sized on each supported Echo model beyond the current one-to-three tile span setting.
- Whether additional menu content types are needed beyond camera feeds and lights.

The camera wall, package, and acceptance details in the original brief are provisional until reconciled with this direction.
