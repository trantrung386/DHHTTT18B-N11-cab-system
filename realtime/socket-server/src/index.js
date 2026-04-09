const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

/* ================== CORS ================== */
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));

app.use(express.json());

/* ================== SOCKET.IO ================== */
const { Server } = require('socket.io');

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});

/* ================== AUTH MIDDLEWARE ================== */
io.use((socket, next) => {
    try {
        const token = socket.handshake.auth.token;

        if (!token) {
            return next(new Error('No token'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        socket.user = decoded;

        console.log(`🔐 Socket connected: userId=${decoded.userId}`);

        next();
    } catch (err) {
        next(new Error('Unauthorized'));
    }
});

/* ================== CONNECTION ================== */
io.on('connection', (socket) => {

    const user = socket.user;

    console.log(`📡 User connected: ${user.userId} (${user.role})`);

    /* ===== DRIVER SEND GPS ===== */
    socket.on('driver:location', (data) => {
        if (user.role !== 'driver') {
            return socket.emit('error', 'Forbidden');
        }

        console.log(`🚗 Driver ${user.userId} location:`, data);

        // broadcast cho passenger
        socket.broadcast.emit('driver:update', {
            driverId: user.userId,
            location: data
        });
    });

    /* ===== CUSTOMER LISTEN ===== */
    socket.on('join:ride', (rideId) => {
        socket.join(`ride:${rideId}`);
    });

    socket.on('disconnect', () => {
        console.log(`❌ User disconnected: ${user.userId}`);
    });
});

/* ================== HEALTH ================== */
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

/* ================== START ================== */
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
    console.log(`🚀 Socket server running on port ${PORT}`);
});