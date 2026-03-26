import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

admin.initializeApp({
  projectId: config.projectId,
});

try {
  const firestore = getFirestore(config.firestoreDatabaseId);
  console.log('Success');
} catch (e) {
  console.error('Error:', e);
}
