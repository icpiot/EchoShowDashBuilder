import assert from "node:assert/strict";
import test from "node:test";
globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => undefined, define: () => {} };
globalThis.window = { customStrategies: [] };
const { reconcileCardLibrary } = await import("../dist/echo-dashboard-card.js");

const card = (name) => ({ config: { type: "custom:button-card", name, entity: `light.${name.toLowerCase().replaceAll(" ", "_")}` }, view_path: "cards", position: 0 });

test("card-library identities survive reordering and names remain independent", () => {
  let next = 0;
  const ids = () => `id-${++next}`;
  const original = reconcileCardLibrary([], [card("Office Lamp"), { ...card("Spare Room"), position: 1 }, { ...card("Office"), position: 2 }], "holder", ids);
  original[0].name = "Desk lamp";
  const reordered = reconcileCardLibrary(original, [{ ...card("Office"), position: 0 }, { ...card("Office Lamp"), position: 1 }, { ...card("Spare Room"), position: 2 }], "holder", ids);
  assert.equal(reordered.find((item) => item.name === "Desk lamp")?.id, "id-1");
  assert.equal(reordered.find((item) => item.id === "id-3")?.source_position, 0);
});

test("removing a holder card leaves its reference visibly missing", () => {
  let next = 0;
  const initial = reconcileCardLibrary([], [card("Office Lamp"), { ...card("Office"), position: 1 }], "holder", () => `id-${++next}`);
  const afterRemoval = reconcileCardLibrary(initial, [card("Office Lamp")], "holder", () => `id-${++next}`);
  assert.equal(afterRemoval.find((item) => item.id === "id-2")?.missing, true);
  assert.equal(afterRemoval.find((item) => item.id === "id-1")?.missing, false);
});
