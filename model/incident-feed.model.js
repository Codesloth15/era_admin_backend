import { INCIDENTS } from '../config/data-paths.js';

// Realtime Database listener for citizen alerts.
function createIncidentFeed(db) {
  return {
    // Calls onIncident(id, incident) for every alert created at or after `since` (milliseconds), then for each
    // new one as it arrives. onError is called if the listener is cancelled. Returns a function that stops it.
    watchNew(since, onIncident, onError) {
      const query = db.ref(INCIDENTS).orderByChild('createdAt').startAt(since);
      const listener = query.on('child_added', snapshot => onIncident(snapshot.key, snapshot.val()), onError);
      return () => query.off('child_added', listener);
    },
  };
}

export { createIncidentFeed };
