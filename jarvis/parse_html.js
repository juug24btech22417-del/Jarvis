const fs = require('fs');
const html = fs.readFileSync('zoom_form.html', 'utf8');

const inputRegex = /<input[^>]*>/gi;
let m;
while (m = inputRegex.exec(html)) {
  console.log(m[0]);
}

const buttonRegex = /<button[^>]*>.*?<\/button>/gi;
while (m = buttonRegex.exec(html)) {
  console.log(m[0]);
}
