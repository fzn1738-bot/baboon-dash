import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const app = admin.initializeApp({ projectId: config.projectId });
admin.auth(app).createCustomToken('test-uid', { role: 'admin' })
  .then(token => console.log("Token:", token))
  .catch(e => console.error("Error:", e.message));
