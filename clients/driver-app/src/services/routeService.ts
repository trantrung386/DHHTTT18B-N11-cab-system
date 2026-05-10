const routeCache = new Map<string, [number, number][]>();

/**
 * Fetches a driving route from OSRM public API.
 * Returns array of [lat, lng] points for Leaflet.
 * Uses caching + retries with exponential backoff.
 * 
 * NOTE: Only real OSRM results are cached. Straight-line fallbacks
 * are NOT cached so that subsequent calls can retry the API.
 */
async function fetchRoute(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  retries = 3
): Promise<[number, number][]> {
  // Validate coordinates before proceeding
  if (!isValidCoord(start.lat, start.lng) || !isValidCoord(end.lat, end.lng)) {
    console.warn('[routeService] Invalid coordinates:', start, end);
    return [
      [start.lat, start.lng],
      [end.lat, end.lng]
    ];
  }

  const cacheKey = `${start.lat.toFixed(4)},${start.lng.toFixed(4)}-${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;

  // Return cached result if available (only real routes are cached)
  const cached = routeCache.get(cacheKey);
  if (cached) {
    console.log('[routeService] Cache hit for', cacheKey, `(${cached.length} points)`);
    return cached;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.warn(`[routeService] Retry #${attempt} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`[routeService] OSRM HTTP ${response.status} (attempt ${attempt + 1}/${retries + 1})`);
        if (response.status === 429 && attempt < retries) {
          continue; // retry
        }
        throw new Error(`OSRM API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        const coordinates = data.routes[0].geometry.coordinates;
        // OSRM returns [lng, lat], Leaflet needs [lat, lng]
        const path = coordinates.map((c: number[]) => [c[1], c[0]]) as [number, number][];
        
        // Only cache real OSRM results (not fallbacks)
        routeCache.set(cacheKey, path);
        console.log(`[routeService] Route fetched: ${path.length} points`);
        return path;
      }
    } catch (error) {
      if (attempt >= retries) {
        console.warn('[routeService] All retries exhausted', error);
      }
    }
  }

  // Fallback: straight line between start and end
  // NOTE: We intentionally do NOT cache this so future attempts can try OSRM again
  console.warn('[routeService] Using straight-line fallback (not cached)');
  return [
    [start.lat, start.lng],
    [end.lat, end.lng]
  ];
}

/**
 * Check if coordinate values are valid numbers within plausible range
 */
function isValidCoord(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    lat !== 0 &&
    lng !== 0
  );
}

/**
 * Manually set a cached route (used to pre-populate from store data)
 */
function setCachedRoute(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  path: [number, number][]
): void {
  if (path.length <= 2) return; // Don't cache straight-line fallbacks
  const cacheKey = `${start.lat.toFixed(4)},${start.lng.toFixed(4)}-${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;
  routeCache.set(cacheKey, path);
}

export const routeService = {
  getRoutePath: fetchRoute,
  setCachedRoute
};
