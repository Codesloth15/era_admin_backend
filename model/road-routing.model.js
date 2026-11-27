// OSRM-compatible road routing adapter: driving times from one point to many, in one request (/table).
// The public OSRM server accepts at most 100 points per request: the origin plus 99 destinations.
const MAX_DESTINATIONS = 99;
const TIMEOUT_MS = 4000;

const coordinate = point => `${point.longitude},${point.latitude}`;

function createRoadRouting(baseUrl, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  return {
    // Driving time in seconds from origin to each destination, in the same order; null where there is no road route.
    // Throws when the service is unreachable, slow or returns an unusable answer.
    async travelSeconds(origin, destinations) {
      if (!destinations.length) return [];
      if (destinations.length > MAX_DESTINATIONS) throw new Error(`Road routing supports at most ${MAX_DESTINATIONS} stations per request.`);
      const points = [origin, ...destinations].map(coordinate).join(';');
      const response = await fetch(`${baseUrl}/table/v1/driving/${points}?sources=0&annotations=duration`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Road routing service answered ${response.status}.`);
      const result = await response.json();
      const row = result?.code === 'Ok' && Array.isArray(result.durations) ? result.durations[0] : null;
      if (!Array.isArray(row) || row.length !== destinations.length + 1) throw new Error('Road routing service returned no travel times.');
      return row.slice(1).map(seconds => (Number.isFinite(seconds) && seconds >= 0 ? seconds : null));
    },
  };
}

export { createRoadRouting };
