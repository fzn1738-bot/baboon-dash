const fs = require('fs');
const path = require('path');

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace `${isInvestor ? 'light' : 'dark'}` with `'dark'`
    // We need to match the exact pattern.
    // Actually, it's better to use regex:
    // isInvestor \? '([^']*)' : '([^']*)'
    // Replace with: '$2'
    
    let newContent = content.replace(/isInvestor \? '([^']*)' : '([^']*)'/g, "'$2'");
    newContent = newContent.replace(/isInvestor \? "([^"]*)" : "([^"]*)"/g, '"$2"');
    
    // Also handle cases like:
    // ${isInvestor ? 'text-slate-900' : 'text-white'} -> text-white
    
    if (content !== newContent) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log(`Updated ${filePath}`);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.tsx')) {
            processFile(fullPath);
        }
    }
}

walkDir('./components');
processFile('./App.tsx');
