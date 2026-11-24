# Echo Show Dash Builder

## Why it was built

This project began with cameras. Existing Home Assistant camera cards did not work reliably on our Echo Show: feeds had connection problems, and the camera wall was difficult to use on its small screen. We wanted a camera view designed for the Echo, where we could choose the feeds, control their size and refresh, and tap a tile to open the Echo's native camera viewer.

That camera view grew into a dashboard builder. A single, editable **Echo Show Dash Builder** holds named Dash setups. You can put cameras, lights, temperatures, and existing Lovelace cards into menus, add controls to the top bar, and choose whether content fits the screen or scrolls below the menu. Save a setup in the builder, then apply it to a selected Echo. Applying it creates or replaces that Echo's dashboard; the builder remains available for later changes.

![A real Echo Show 8 camera wall, with a person redacted](docs/images/show-8-cameras.png)

## How it works

1. Open the builder on a computer and create or select a named Dash.
2. Choose its menus, camera feeds, controls, and screen layout. Save the setup for later use.
3. Select an Echo and apply the Dash. Changes to a saved setup reach the Echo only when you apply it again.

For the controls and illustrated steps, see the [user guide](docs/USER_GUIDE.md).

## What you need

- **Home Assistant** with the dashboard's JavaScript resource installed. The repository declares Home Assistant 2024.12.0 as its minimum version; that is metadata, not a verified compatibility range.
- **A TECHO5 Echo Show connected to Home Assistant** to assign a Dash to a device and open its native camera viewer from a camera tile. Camera menus also need camera entities available in Home Assistant.
- **Dashcast for Streamed presentation.** It renders the Home Assistant dashboard for the Echo, including custom Lovelace cards. TECHO5's Drawn presentation does not render this project's custom cards as designed. See [TECHO5's dashboard guide](https://github.com/HuskerMinion/techo5/blob/main/docs/dashboards.md).
- **Any optional custom Lovelace cards** you select in the builder must already be installed and working in Home Assistant.

Node.js and the packages in `package.json` are needed only by a developer building the JavaScript from source. They are not runtime dependencies on the Echo.

## Install

Install the **Echo Show Dash Builder** dashboard plugin through HACS or Home Assistant Marketplace. The [installation guide](docs/INSTALLATION.md) covers the first launch and the required TECHO5 and Dashcast setup. The [developer setup](docs/DEVELOPER_SETUP.md) is only for people changing the source code.
