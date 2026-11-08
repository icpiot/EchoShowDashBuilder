export { getFeedDimensions, listAvailableCameras } from "./camera-feeds";
export { generateEchoDashboard, registerEchoDashboardStrategy, kioskModeSetting, localDashboardPath } from "./dashboard-strategy";
import { registerEchoDashboardStrategy } from "./dashboard-strategy";
import "./cards";
import "./editor";

registerEchoDashboardStrategy();
