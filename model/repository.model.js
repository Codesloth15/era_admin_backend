// Every committed write moves this number. Agency pages check it and refetch only when it changes.
async function bumpRevision(db) {
  try {
    await db.ref('data_revision').transaction(value => (Number(value) || 0) + 1, undefined, false);
  } catch (error) {
    console.error('Data revision was not updated.', error);
  }
}

function createRepository(db) {
  return {
    async read(path) {
      return (await db.ref(path).get()).val();
    },
    async transact(path, change) {
      let failure;
      const initial = await db.ref(path).get();
      const result = await db.ref(path).transaction(state => {
        if (state === null && initial.exists()) return state;
        try {
          failure = undefined;
          return change(state);
        } catch (error) {
          failure = error;
          return undefined;
        }
      }, undefined, false);
      if (failure) throw failure;
      if (!result.committed || !result.snapshot.exists()) {
        throw new Error('Operation was not committed.');
      }
      await bumpRevision(db);
    },
    // Deletes the record at path only when shouldRemove(current) is true; returns whether it is gone.
    // The callback must be synchronous and safe to retry. Not shown on agency pages, so no revision bump.
    async removeIf(path, shouldRemove) {
      // A first call with null is only a local guess: proposing null makes Firebase retry with the saved value.
      const result = await db.ref(path).transaction(state => (state === null || shouldRemove(state) ? null : undefined), undefined, false);
      return result.committed;
    },
  };
}

export { createRepository };
