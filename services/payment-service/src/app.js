const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

// 1. Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// 2. Health Check
app.get('/api/payments/health', (req, res) => {
  res.json({
    service: 'payment-service',
    status: 'healthy',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// 3. API Endpoints
// --- THÊM ROUTE TEST POSTMAN TẠI ĐÂY ---
app.post('/api/payments/test-order', async (req, res) => {
  try {
    const Payment = require('./models/Payment');
    const { v4: uuidv4 } = require('uuid');
    const { rideId, amount, userId } = req.body;

    console.log(`🚀 [Postman] Đang xử lý RideID: ${rideId}`);

    // 1. Kiểm tra xem RideID này đã được thanh toán chưa
    const existingPayment = await Payment.findOne({ rideId: rideId });
    if (existingPayment) {
      return res.status(400).json({ 
        success: false, 
        error: "RideID đã tồn tại!", 
        message: "Vui lòng đổi rideId trong Postman (ví dụ: RIDE-NEW-008) để tạo đơn mới." 
      });
    }

    // 2. Tạo instance mới
    const payment = new Payment({
      paymentId: `PAY-${uuidv4().substring(0, 8)}`,
      rideId: rideId,
      userId: userId || 'postman_user',
      amount: amount || 50000,
      method: 'card',
      provider: 'stripe',
      status: 'pending'
    });

    // 3. Chỉ lưu MỘT LẦN duy nhất
    // Không gọi startProcessing() hay completeProcessing() nếu các hàm đó có chứa lệnh .save() bên trong
    await payment.save();

    console.log(`✅ Lưu thành công: ${payment.paymentId}`);

    res.status(200).json({ 
      success: true, 
      message: "Thanh toán đã được khởi tạo thành công", 
      data: payment 
    });

  } catch (err) {
    console.error('❌ Lỗi xử lý:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy chi tiết một giao dịch
app.get('/api/payments/:paymentId', async (req, res) => {
  try {
    const Payment = require('./models/Payment');
    const payment = await Payment.findOne({ paymentId: req.params.paymentId });
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    res.json(payment);
  } catch (err) { res.status(500).json({ error: err.message }); }
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