# Installation

This is the user installation path. You do not need Node.js, npm, TypeScript or a source checkout.

## Requirements

- Home Assistant 2024.12.0 or newer.
- HACS, or Home Assistant Marketplace on versions that include it.
- A TECHO5 Echo Show connected to Home Assistant.
- Dashcast running for **Streamed** presentation. This is what lets the Echo show the complete Home Assistant page, including custom Lovelace cards.
- Any optional custom Lovelace cards you plan to add must already be installed in Home Assistant.

## Install the dashboard plugin

The first release is available immediately as a custom repository. It can be added to the public HACS/Marketplace catalog later after community review.

1. Open **HACS → Frontend**, open the three-dot menu, and choose **Custom repositories**.
2. Enter `https://github.com/icpiot/EchoShowDashBuilder` and choose **Dashboard** as the type.
3. Open the new **Echo Show Dash Builder** entry and choose **Download/Install**.
4. Reload the Home Assistant browser page when prompted.
5. Open **Settings → Dashboards → Add dashboard**.
6. Choose **Echo Show Dash Builder** under the community dashboard strategies.
7. Name the dashboard **Echo Show Dash Builder** and create it.

On Home Assistant versions with Marketplace, use **Settings → Marketplace → Dashboard** and add the same repository if it is not already listed.

The builder is the master dashboard. It is where named Dash setups are created and stored. It is not a kiosk dashboard and is intended to be edited on a computer.

## First setup

Open the builder and choose **New Dash** for a blank setup. Select the menus and entities to show, then save the Dash. Choose the Echo under **Echo Assignment and Deployment** and press **Apply Dash to Echo**. The builder creates or replaces the managed dashboard for that Echo and attaches it through TECHO5.

Use **Streamed** as the Echo presentation mode when you want the page to look exactly like the builder preview and when you use Custom Card Holder cards. TECHO5's **Drawn** mode supports only its own limited set of card types.

For the full menu, camera, card, toggle and deployment instructions, see the [user guide](USER_GUIDE.md).

## Updates

Install updates from HACS or Marketplace, reload Home Assistant in the browser, and reopen the builder. Saved Dash setups live in Home Assistant and are not replaced by updating the JavaScript plugin.
