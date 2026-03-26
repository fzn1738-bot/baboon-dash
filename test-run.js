import { execSync } from 'child_process';
try {
  execSync('npx tsx server.ts', { stdio: 'inherit', timeout: 5000 });
} catch (e) {
  console.error("Error:", e.message);
}