const https = require('https');

https.get('https://html.duckduckgo.com/html/?q=site:docs.google.com/forms/d/e/+contact+information', {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const matches = data.match(/https%3A%2F%2Fdocs\.google\.com%2Fforms%2Fd%2Fe%2F[a-zA-Z0-9_\-]+%2Fviewform/g) ||
                    data.match(/https:\/\/docs\.google\.com\/forms\/d\/e\/[a-zA-Z0-9_\-]+\/viewform/g);
    if (matches) {
      const urls = matches.map(u => decodeURIComponent(u));
      console.log('Found Google Forms URLs:', [...new Set(urls)].slice(0, 5));
    } else {
      console.log('No matches found. HTML sample:', data.slice(0, 300));
    }
  });
});
