const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getStorage } = require('firebase-admin/storage');
const { randomUUID } = require('node:crypto');
const { createRepository } = require('./createRepository.cjs');
const { readConfig } = require('../../config.cjs');

function createFirebaseDependencies(environment = process.env, existingApp) {
  const { databaseURL, projectId, storageBucket } = readConfig(environment).firebase;
  if (!databaseURL && !existingApp) {
    throw new Error('FIREBASE_DATABASE_URL is required. Create era_admin_backend/.env using era_admin_backend/.env.example, then run npm start from era_admin_backend.');
  }
  const app = existingApp || initializeApp({
    credential: applicationDefault(),
    databaseURL,
    ...(projectId ? { projectId } : {}),
  });
  return { repository: createRepository(getDatabase(app)), auth: getAuth(app), files: createFileStorage(app, storageBucket) };
}

// Saves uploaded files to Firebase Storage and returns a token download URL.
function createFileStorage(app, bucketName) {
  const bucket = () => {
    if (!bucketName) throw Object.assign(new Error('Image storage is not configured. Set FIREBASE_STORAGE_BUCKET in era_admin_backend/.env.'), { status: 503 });
    return getStorage(app).bucket(bucketName);
  };
  return {
    async save(path, buffer, contentType) {
      const target = bucket(); const token = randomUUID();
      await target.file(path).save(buffer, { resumable: false, contentType, metadata: { cacheControl: 'public, max-age=3600', metadata: { firebaseStorageDownloadTokens: token } } });
      return `https://firebasestorage.googleapis.com/v0/b/${target.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    },
    async remove(path) {
      await bucket().file(path).delete({ ignoreNotFound: true });
    },
  };
}

module.exports = { createFirebaseDependencies };
