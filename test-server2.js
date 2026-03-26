import { spawn } from 'child_process';

const server = spawn('npx', ['tsx', 'server.ts'], {
  env: { ...process.env, PORT: '3006' }
});

server.stdout.on('data', (data) => {
  console.log(`stdout: ${data}`);
});

server.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`);
});

server.on('close', (code) => {
  console.log(`child process exited with code ${code}`);
});

setTimeout(async () => {
  try {
    const res = await fetch('http://localhost:3006/api/payment/invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, userId: '123', userEmail: 'test@test.com' })
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Body:', text);
  } catch (e) {
    console.error(e);
  }
  server.kill('SIGKILL');
  setTimeout(() => process.exit(0), 1000);
}, 8000);
