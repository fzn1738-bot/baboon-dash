import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

admin.initializeApp({
  projectId: config.projectId,
});

async function test() {
  try {
    const firestore = getFirestore(config.firestoreDatabaseId);
    console.log('Database ID:', firestore._settings.databaseId);
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
