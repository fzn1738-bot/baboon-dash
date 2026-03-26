import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

admin.initializeApp({
  projectId: config.projectId,
});

async function test() {
  try {
    const firestore = getFirestore(admin.app(), config.firestoreDatabaseId);
    await firestore.collection('deposits').doc('1').set({ test: 1 });
    console.log('Success');
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
