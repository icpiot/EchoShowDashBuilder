export interface CameraEntity {
  entity_id: string;
  attributes?: {
    friendly_name?: string;
    entity_picture?: string;
  };
}

export interface HomeAssistantState {
  states: Record<string, CameraEntity>;
}

export interface CameraFeed {
  entityId: string;
  label: string;
  pictureUrl?: string;
}

/** Return only cameras visible to the current Home Assistant session. */
export function listAvailableCameras(hass: HomeAssistantState): CameraFeed[] {
  return Object.values(hass.states)
    .filter((state) => state.entity_id.startsWith("camera."))
    .map((state) => ({
      entityId: state.entity_id,
      label: state.attributes?.friendly_name || state.entity_id,
      pictureUrl: state.attributes?.entity_picture,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface FeedDimensions {
  width: number;
  height: number;
  aspectRatio: number;
}

/** Measure the image Home Assistant actually delivered, after it has loaded. */
export function getFeedDimensions(image: HTMLImageElement): FeedDimensions | null {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) return null;
  return { width, height, aspectRatio: width / height };
}
