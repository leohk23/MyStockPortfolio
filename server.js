const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.static('.')); // Serve static files from current directory

app.get('/api/:symbol', async (req, res) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${req.params.symbol}?interval=1d`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));