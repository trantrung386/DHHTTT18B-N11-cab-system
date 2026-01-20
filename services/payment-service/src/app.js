const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/payments/health', (req, res) => {
	res.json({
		service: 'payment-service',
		status: 'healthy',
		timestamp: new Date().toISOString()
	});
});

// Minimal endpoints (placeholders)
app.post('/api/payments', (req, res) => {
	res.status(201).json({ id: `pay_${Date.now()}`, status: 'PENDING', payload: req.body });
});

app.post('/api/payments/refund', (req, res) => {
	res.status(202).json({ status: 'REFUND_REQUESTED', payload: req.body });
});

app.use((req, res) => {
	res.status(404).json({
		error: 'Endpoint not found',
		path: req.originalUrl,
		method: req.method
	});
});

app.use((err, req, res, next) => {
	console.error('Unhandled error:', err);
	res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
