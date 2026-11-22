# TECHO5 Echo Show assignment

The editor's **Apply to Echo Show** section uses the TECHO5 entities already exposed by Home Assistant. It does not use device credentials or a separate control protocol.

## Discovered controls

For each TECHO5 device, the editor discovers:

- `select.<device>_dashboard` for the presentation mode (`Streamed`, `Drawn on the device`, and other integration-provided options)
- `select.<device>_dashboard_to_show` for the dashboard selection
- `switch.<device>_dashboard_when_idle` for idle presentation

The editor reads the dashboard-to-show options before allowing an assignment. This prevents sending an unsupported dashboard name to a device. After an assignment, it reads the selected entity state back and reports whether Home Assistant has confirmed the requested dashboard.

## Example device entities

- Al Office Echo 8: `select.al_office_echo_8_dashboard`, `select.al_office_echo_8_dashboard_to_show`, `switch.al_office_echo_8_dashboard_when_idle`
- Al Show 5: `select.al_show_5_dashboard`, `select.al_show_5_dashboard_to_show`, `switch.al_show_5_dashboard_when_idle`

At discovery time, the Echo 8 exposed `Echo Show HTML Dash Dev` in its dashboard list. The Show 5 exposed only `Automatic`, so the development dashboard cannot be assigned to that device through the verified interface until TECHO5 exposes the dashboard option.

## Safety and rollback

The editor only calls standard Home Assistant `select.select_option`, `switch.turn_on`, and `switch.turn_off` services after the user presses **Apply to Echo Show**. No assignment was invoked during development validation. To roll back a test assignment, select the previous dashboard and mode, then restore the prior idle switch state; existing production dashboards and resources are not modified by this project.

Streamed mode remains dependent on the TECHO5 Dashcast configuration. Dashcast server details and keys are not displayed or stored by this card.
