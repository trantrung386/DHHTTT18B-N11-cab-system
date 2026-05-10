const routeCache = new Map<string, [number, number][]>();

export const routeService = {
  /**
   * Fetches a driving route from OSRM public API.
   * Note: OSRM returns coordinates in [lng, lat] format,
   * we reverse them to [lat, lng] for Leaflet mapping.
   * 
   * Uses caching + retries. Only real routes are cached
   * (straight-line fallbacks are NOT cached so future retries can succeed).
   */
  async getRoutePath(start: { lat: number; lng: number }, end: { lat: number; lng: number }): Promise<[number, number][]> {
    // Validate coordinates
    if (!start?.lat || !start?.lng || !end?.lat || !end?.lng ||
        isNaN(start.lat) || isNaN(start.lng) || isNaN(end.lat) || isNaN(end.lng)) {
      console.warn('[routeService] Invalid coordinates:', start, end);
      return [[start?.lat || 0, start?.lng || 0], [end?.lat || 0, end?.lng || 0]];
    }

    const cacheKey = `${start.lat.toFixed(4)},${start.lng.toFixed(4)}-${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;

    // Return cached result if available
    const cached = routeCache.get(cacheKey);
    if (cached) {
      console.log('[routeService] Cache hit for', cacheKey, `(${cached.length} points)`);
      return cached;
    }

    // Retry up to 3 times with exponential backoff
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        if (attempt > 0) {
          const delay = 1000 * Math.pow(2, attempt - 1);
          console.warn(`[routeService] Retry #${attempt} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        
        if (!response.ok) {
          console.warn(`[routeService] OSRM HTTP ${response.status} (attempt ${attempt + 1}/4)`);
          if (response.status === 429 && attempt < 3) continue;
          throw new Error(`OSRM API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.routes && data.routes.length > 0) {
          const coordinates = data.routes[0].geometry.coordinates;
          // Convert [lng, lat] to [lat, lng]
          const path = coordinates.map((c: number[]) => [c[1], c[0]]) as [number, number][];
          // Only cache real routes (not fallbacks)
          routeCache.set(cacheKey, path);
          console.log(`[routeService] Route fetched: ${path.length} points`);
          return path;
        }
      } catch (error) {
        if (attempt >= 3) {
          console.warn('[routeService] All retries exhausted, falling back to straight line', error);
        }
      }
    }
    
    // Fallback to straight line if API fails
    // NOTE: Not cached so future calls can retry OSRM
    return [
      [start.lat, start.lng],
      [end.lat, end.lng]
    ];
  }
};
