import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../utils/http-error.js';

// Saves uploaded files to Firebase Storage and returns a token download URL.
export function createFileStorage(app, bucketName) {
  const bucket = () => {
    if (!bucketName) throw new HttpError(503, 'Image storage is not configured. Set FIREBASE_STORAGE_BUCKET in era_admin_backend/.env.');
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
