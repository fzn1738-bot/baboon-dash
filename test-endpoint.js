async function test() {
  try {
    const res = await fetch('http://localhost:3000/api/payment/invoice', {
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
}

test();
