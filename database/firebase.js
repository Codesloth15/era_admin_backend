import fs from 'node:fs';
import admin from 'firebase-admin';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { readConfig } from '../config/env.js';
import { createRepository } from '../model/repository.model.js';
import { createFileStorage } from '../model/file-storage.model.js';

function readServiceAccount(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read the service account key file ${file}. Check FIREBASE_SERVICE_ACCOUNT_PATH in era_admin_backend/.env. (${error.message})`);
  }
}

function serviceAccountCredential(file) {
  const serviceAccount = readServiceAccount(file);
  const credential = admin.credential.cert(serviceAccount);
  // Request uncompressed OAuth responses to avoid premature-close errors.
  const client = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/firebase.database',
      'https://www.googleapis.com/auth/firebase.messaging',
      'https://www.googleapis.com/auth/identitytoolkit',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });
  client.transporter.defaults = { headers: { 'Accept-Encoding': 'identity' } };
  credential.getAccessToken = async () => {
    await client.getAccessToken();
    return {
      access_token: client.credentials.access_token,
      expires_in: Math.max(1, Math.floor((client.credentials.expiry_date - Date.now()) / 1000)),
    };
  };
  return credential;
}

// The one Firebase Admin app used by the agency API.
export function initializeFirebase(config) {
  if (!admin.apps.length) {
    const credential = config.firebase.serviceAccountPath
      ? serviceAccountCredential(config.firebase.serviceAccountPath)
      // GOOGLE_APPLICATION_CREDENTIALS, or the service account attached to the host on Google Cloud.
      : admin.credential.applicationDefault();
    admin.initializeApp({
      credential,
      databaseURL: config.firebase.databaseURL,
      ...(config.firebase.projectId ? { projectId: config.firebase.projectId } : {}),
    });
  }
  return admin.app();
}

// Repository, identity and file storage adapters handed to the services.
export function createFirebaseDependencies(environment = process.env, existingApp) {
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
