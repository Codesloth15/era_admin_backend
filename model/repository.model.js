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
  };
}

export { createRepository };
