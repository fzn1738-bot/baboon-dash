const fs = require('fs');
const path = require('path');

const usersPath = path.resolve(process.cwd(), 'components', 'Users.tsx');
const source = fs.readFileSync(usersPath, 'utf8');

const forbiddenTokens = ['FAQItem', 'addDoc', 'updateDoc', 'HelpCircle'];
const hits = forbiddenTokens.filter((token) => source.includes(token));

if (hits.length > 0) {
  console.error(`Boundary check failed in components/Users.tsx. Forbidden token(s): ${hits.join(', ')}`);
  process.exit(1);
}

console.log('Boundary check passed: components/Users.tsx has no FAQ-manager tokens.');
