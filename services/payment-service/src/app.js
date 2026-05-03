const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
require('dotenv').config();
let observabilityUtils;
try {
  observabilityUtils = require('../../../shared/utils/observability');
} catch (e) {
  observabilityUtils = {
    createMetricsCollector: () => ({ middleware: (req, res, next) => next(), metricsHandler: (req, res) => res.send('') }),
    createRequestContextMiddleware: () => (req, res, next) => next(),
    createSecurityHeadersMiddleware: () => (req, res, next) => next()
  };
}
const {
  createMetricsCollector,
  createRequestContextMiddleware,
  createSecurityHeadersMiddleware
} = observabilityUtils;

const app = express();
const observability = createMetricsCollector({ serviceName: 'payment-service' });

function normalizeMethod(method) {
  return String(method || 'card').toLowerCase();
}

function buildPaymentIdempotencyKey(req) {
  return String(req.headers['idempotency-key'] || req.body?.idempotencyKey || req.body?.idempotency_key || '').trim();
}

function paymentResponse(payment, meta = {}) {
  return {
    success: true,
    message: 'Thanh toán đã được khởi tạo thành công',
    data: {
      ...payment.toObject(),
      ...meta
    }
  }
}

async function createPaymentRecord({ rideId, amount, userId, driverId, method, provider, idempotencyKey }) {
  const Payment = require('./models/Payment');
  const { v4: uuidv4 } = require('uuid');

  if (!rideId) {
    const error = new Error('rideId is required');
    error.status = 400;
    throw error;
  }

  const existingByRide = await Payment.findOne({ rideId });
  if (existingByRide) {
    return { replay: true, payment: existingByRide };
  }

  if (idempotencyKey) {
    const existingByKey = await Payment.findOne({ tags: idempotencyKey });
    if (existingByKey) {
      return { replay: true, payment: existingByKey };
    }
  }

  const payment = new Payment({
    paymentId: `PAY-${uuidv4().substring(0, 8)}`,
    rideId,
    userId: userId || 'postman_user',
    driverId,
    amount: Number(amount || 50000),
    method: normalizeMethod(method),
    provider: provider || 'stripe',
    status: 'pending',
    tags: idempotencyKey ? [idempotencyKey] : []
  });

  payment.calculateFees();
  await payment.save();
  return { replay: false, payment };
}

// 1. Middlewares
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(createRequestContextMiddleware({ serviceName: 'payment-service' }));
app.use(createSecurityHeadersMiddleware({ serviceName: 'payment-service' }));
app.use(observability.middleware);
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.get('/metrics', observability.metricsHandler);

// 2. Health Check
app.get('/api/payments/health', (req, res) => {
  res.json({
    service: 'payment-service',
    status: 'healthy',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    requestId: req.requestId || null,
    traceId: req.traceId || null,
    timestamp: new Date().toISOString()
  });
});

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_51TNRP6LcXlRTJQee7kyueHw8lmtrATfOSOKLRmX4VDzgR5muRuvqY03GBdkwNtjuRJ8jMNMcVOI2TsKV2ASQ6107000ujSxrae';
const stripe = require('stripe')(STRIPE_KEY);

// 3. API Endpoints
app.post('/api/payments/create-intent', async (req, res) => {
  try {
    const { amount, currency = 'vnd', rideId } = req.body;
    
    if (!amount || !rideId) {
      return res.status(400).json({ error: 'amount and rideId are required' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(amount),
      currency: currency,
      metadata: { rideId }
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('❌ Stripe Create Intent Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const created = await createPaymentRecord({
      rideId: req.body?.rideId,
      amount: req.body?.amount,
      userId: req.body?.userId,
      driverId: req.body?.driverId,
      method: req.body?.method,
      provider: req.body?.provider,
      idempotencyKey: buildPaymentIdempotencyKey(req)
    });

    return res.status(created.replay ? 200 : 201).json(paymentResponse(created.payment, { replay: created.replay }));
  } catch (err) {
    console.error('❌ Payment create error:', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

app.post('/api/payments/test-order', async (req, res) => {
  try {
    const created = await createPaymentRecord({
      rideId: req.body?.rideId,
      amount: req.body?.amount,
      userId: req.body?.userId,
      driverId: req.body?.driverId,
      method: 'card',
      provider: 'stripe',
      idempotencyKey: buildPaymentIdempotencyKey(req)
    });

    if (created.replay) {
      return res.status(200).json({ success: true, message: 'Thanh toán đã tồn tại', data: created.payment });
    }

    console.log(`✅ Lưu thành công: ${created.payment.paymentId}`);

    res.status(200).json(paymentResponse(created.payment));

  } catch (err) {
    console.error('❌ Lỗi xử lý:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/payments/:paymentId/confirm', async (req, res) => {
  try {
    const Payment = require('./models/Payment');
    const payment = await Payment.findOne({ paymentId: req.params.paymentId });
    if (!payment) return res.status(404).json({ success: false, error: 'Không tìm thấy giao dịch' });

    payment.status = 'completed';
    payment.processingCompletedAt = new Date();
    payment.auditLog.push({
      action: 'payment_confirmed',
      actor: req.body?.actor || 'system',
      timestamp: new Date(),
      details: { source: 'api' }
    });
    await payment.save();

    return res.status(200).json(paymentResponse(payment, { confirmed: true }));
  } catch (err) {
    console.error('❌ Payment confirm error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy chi tiết một giao dịch
app.get('/api/payments/:paymentId', async (req, res) => {
  try {
    const Payment = require('./models/Payment');
    const payment = await Payment.findOne({ paymentId: req.params.paymentId });
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    res.json({ success: true, data: payment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lấy thu nhập của tài xế
app.get('/api/payments/driver/:driverId/earnings', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { period } = req.query; // 'day' or 'week'
    
    const Payment = require('./models/Payment');
    
    const now = new Date();
    let startDate = new Date();
    if (period === 'week') {
      startDate.setDate(now.getDate() - 7);
    } else {
      startDate.setHours(0, 0, 0, 0); // start of today
    }

    const payments = await Payment.find({
      driverId,
      status: 'completed',
      createdAt: { $gte: startDate }
    }).sort({ createdAt: -1 });

    const total = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    
    const history = payments.map(p => ({
      id: p.paymentId,
      date: p.createdAt,
      amount: p.amount,
      pickup: 'Điểm đón', // Trong thực tế lấy từ Ride
      dropoff: 'Điểm đến' // Trong thực tế lấy từ Ride
    }));

    res.json({
      success: true,
      data: {
        total,
        rides: payments.length,
        history
      }
    });
  } catch (err) {
    console.error('❌ Earnings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Xử lý Route không tồn tại (Middleware này phải nằm dưới cùng của các route)
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint không tồn tại',
    path: req.originalUrl,
    method: req.method
  });
});

// 5. Bộ xử lý lỗi tập trung
app.use((err, req, res, next) => {
  console.error('🔴 [PaymentService Error]:', err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Lỗi hệ thống' });
});

module.exports = app;