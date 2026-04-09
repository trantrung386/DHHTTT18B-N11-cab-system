const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UserRepository = require('../repositories/userRepository');
const { tokenUtils } = require('../config/redis');
const { RabbitMQClient, EXCHANGES } = require('@cab-booking/shared');

require('dotenv').config();

class AuthService {
    constructor() {
        this.userRepository = new UserRepository();
        this.rabbitMQClient = null;
        this.tokenUtils = tokenUtils;

        // ❗ BẮT BUỘC phải có secret
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is required');
        }

        this.jwtSecret = process.env.JWT_SECRET;
        this.jwtExpire = process.env.JWT_EXPIRE || '15m';
        this.refreshTokenExpire = process.env.REFRESH_TOKEN_EXPIRE || '7d';
    }

    async initializeRabbitMQ() {
        try {
            this.rabbitMQClient = new RabbitMQClient();
            await this.rabbitMQClient.connect();
            console.log('✅ Auth Service: RabbitMQ connected');
        } catch (error) {
            console.error('❌ Auth Service: RabbitMQ connection failed:', error);
        }
    }

    async hashPassword(password) {
        const saltRounds = 12;
        return await bcrypt.hash(password, saltRounds);
    }

    async verifyPassword(password, hashedPassword) {
        return await bcrypt.compare(password, hashedPassword);
    }

    generateTokens(user) {
        const payload = {
            userId: user.id,
            email: user.email,
            role: user.role,
            deviceFingerprint: user.deviceFingerprint
        };

        const accessToken = jwt.sign(payload, this.jwtSecret, {
            expiresIn: this.jwtExpire,
            issuer: 'cab-booking-auth-service',
            audience: 'cab-booking-system'
        });

        const refreshToken = crypto.randomBytes(64).toString('hex');

        return { accessToken, refreshToken };
    }

    async verifyToken(token) {
        try {
            // 🔒 CHECK BLACKLIST
            const isBlacklisted = await tokenUtils.isBlacklisted(token);
            if (isBlacklisted) {
                throw new Error('Token is blacklisted');
            }

            return jwt.verify(token, this.jwtSecret, {
                issuer: 'cab-booking-auth-service',
                audience: 'cab-booking-system'
            });
        } catch (error) {
            throw new Error('Invalid or expired token');
        }
    }

    async register(userData, deviceInfo = {}) {
        try {
            // 🔒 VALIDATE PASSWORD
            this.validatePassword(userData.password);

            const existingUser = await this.userRepository.findByEmail(userData.email);
            if (existingUser) throw new Error('User already exists');

            const hashedPassword = await this.hashPassword(userData.password);

            const newUser = await this.userRepository.create({
                ...userData,
                password: hashedPassword,
                deviceFingerprint: deviceInfo.fingerprint,
                ipAddress: deviceInfo.ip,
                userAgent: deviceInfo.userAgent
            });

            const verificationCode = this.generateVerificationCode();
            await tokenUtils.storeVerificationCode(newUser.email, verificationCode);

            return {
                user: newUser,
                verificationCode: process.env.NODE_ENV === 'development' ? verificationCode : undefined
            };

        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    async login(credentials, deviceInfo = {}) {
        try {
            const { email, password } = credentials;

            const user = await this.userRepository.findByEmail(email);
            if (!user) throw new Error('Invalid email or password');

            if (!user.isActive) throw new Error('Account is deactivated');

            const isPasswordValid = await this.verifyPassword(password, user.password);
            if (!isPasswordValid) {
                await this.userRepository.incrementFailedAttempts(user.id);
                throw new Error('Invalid email or password');
            }

            const { accessToken, refreshToken } = this.generateTokens({
                ...user,
                deviceFingerprint: deviceInfo.fingerprint
            });

            // 🔒 ROTATE TOKEN (xóa token cũ trước)
            await tokenUtils.deleteRefreshToken(user.id);
            await tokenUtils.storeRefreshToken(user.id, refreshToken);

            await this.userRepository.updateRefreshToken(user.id, refreshToken);
            await this.userRepository.updateLastLogin(user.id);

            console.log(`🔐 [LOGIN] userId=${user.id} ip=${deviceInfo.ip}`);

            return {
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role
                },
                tokens: {
                    accessToken,
                    refreshToken
                }
            };

        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    async refreshToken(refreshToken) {
        try {
            const user = await this.userRepository.findByRefreshToken(refreshToken);
            if (!user) throw new Error('Invalid refresh token');

            const storedToken = await tokenUtils.getRefreshToken(user.id);
            if (storedToken !== refreshToken) {
                throw new Error('Token mismatch');
            }

            // 🔒 ROTATE TOKEN
            await tokenUtils.deleteRefreshToken(user.id);

            const { accessToken, refreshToken: newRefreshToken } = this.generateTokens(user);

            await tokenUtils.storeRefreshToken(user.id, newRefreshToken);
            await this.userRepository.updateRefreshToken(user.id, newRefreshToken);

            return {
                accessToken,
                refreshToken: newRefreshToken
            };

        } catch (error) {
            console.error('Refresh error:', error);
            throw error;
        }
    }

    async logout(userId, accessToken) {
        try {
            await tokenUtils.blacklistToken(accessToken);

            await tokenUtils.deleteRefreshToken(userId);
            await this.userRepository.clearRefreshToken(userId);

            console.log(`🔐 [LOGOUT] userId=${userId}`);

            return { message: 'Logged out successfully' };

        } catch (error) {
            console.error('Logout error:', error);
            throw error;
        }
    }

    validatePassword(password) {
        const minLength = 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*]/.test(password);

        if (
            password.length < minLength ||
            !hasUpperCase ||
            !hasLowerCase ||
            !hasNumbers ||
            !hasSpecialChar
        ) {
            throw new Error('Weak password');
        }
    }

    generateVerificationCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }
}

module.exports = AuthService;