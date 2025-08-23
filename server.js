const express = require('express');
const fetch = require('node-fetch'); // Ensure node-fetch is imported
const app = express();

app.use(express.static('.')); // Serve static files (index.html, data.js)
app.get('/api/:symbol', async (req, res) => {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${req.params.symbol}?interval=1d`;
        console.log(`Fetching: ${url}`);
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const text = await response.text();
        console.log(`Response for ${req.params.symbol}:`, text.slice(0, 200)); // Log first 200 chars
        const data = JSON.parse(text);
        if (!data.chart || !data.chart.result) {
            throw new Error('Invalid API response');
        }
        res.json(data);
    } catch (error) {
        console.error(`Error for ${req.params.symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));