/* ============================================================
   MineralHoldings.online — Backend API
   Express + MongoDB (Mongoose) + JWT Auth
   Deploy on your VPS:  npm install && npm start
   ============================================================ */

   require('dotenv').config();
   const express = require('express');
   const mongoose = require('mongoose');
   const bcrypt = require('bcryptjs');
   const jwt = require('jsonwebtoken');
   const cors = require('cors');
   
   const app = express();
   const PORT = process.env.PORT || 5000;
   const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
   const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/mineralholdings';
   const CLIENT_URL = process.env.CLIENT_URL || '*';
   
   /* ----------------------------- Middleware ----------------------------- */
   app.use(express.json());
   app.use(cors({
     origin: CLIENT_URL === '*' ? true : CLIENT_URL.split(','),
     credentials: true
   }));
   
   /* ------------------------------- Schemas ------------------------------ */
   const userSchema = new mongoose.Schema({
     name: { type: String, required: true, trim: true },
     email: { type: String, required: true, unique: true, lowercase: true, trim: true },
     password: { type: String, required: true },
     balance: { type: Number, default: 10000 },
     airtelMoney: {
       phone: { type: String, default: null },
       verified: { type: Boolean, default: false },
       linkedAt: { type: Date, default: null }
     },
     createdAt: { type: Date, default: Date.now }
   });
   
   const holdingSchema = new mongoose.Schema({
     userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
     symbol: { type: String, required: true },
     shares: { type: Number, required: true },
     avgPrice: { type: Number, required: true } // avg price paid per share, USD
   });
   
   const transactionSchema = new mongoose.Schema({
     userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
     symbol: { type: String, required: true },
     type: { type: String, enum: ['buy', 'sell'], required: true },
     shares: { type: Number, required: true },
     price: { type: Number, required: true },   // share price at execution, USD
     total: { type: Number, required: true },
     createdAt: { type: Date, default: Date.now }
   });
   
   const User = mongoose.model('User', userSchema);
   const Holding = mongoose.model('Holding', holdingSchema);
   const Transaction = mongoose.model('Transaction', transactionSchema);
   
   /* ------------------------- Mineral market engine ---------------------- */
   /* DRC-focused minerals. Prices simulated with a random-walk engine;
      swap `tick()` for a real feed (LME, etc.) when you have one.
      Each mineral is divided into shares: sharesPerUnit defines how many
      shares make one physical unit; sharePrice = price x sharesPerUnit.   */
   const MINERALS = [
     { symbol: 'COBALT',    name: 'Cobalt',            unit: 'tonne', price: 33500,  sharesPerUnit: 0.01,  volatility: 0.012, color: '#2563eb', desc: 'DRC supplies roughly 70% of the world\'s cobalt, essential for EV batteries.' },
     { symbol: 'COPPER',    name: 'Copper',            unit: 'tonne', price: 9850,   sharesPerUnit: 0.01,  volatility: 0.008, color: '#d97706', desc: 'The DRC is the world\'s #2 copper producer, led by the Katanga belt.' },
     { symbol: 'COLTAN',    name: 'Coltan (Tantalum)', unit: 'kg',    price: 145,    sharesPerUnit: 0.1,   volatility: 0.02,  color: '#7c3aed', desc: 'Tantalum ore powering every smartphone and capacitor on Earth.' },
     { symbol: 'GOLD',      name: 'Gold',              unit: 'oz',    price: 2650,   sharesPerUnit: 0.01,  volatility: 0.006, color: '#eab308', desc: 'Artisanal and industrial gold from Kibali and the eastern provinces.' },
     { symbol: 'DIAMOND',   name: 'Diamond',           unit: 'carat', price: 185,    sharesPerUnit: 0.1,   volatility: 0.015, color: '#0ea5e9', desc: 'Mbuji-Mayi remains one of Africa\'s great diamond regions.' },
     { symbol: 'LITHIUM',   name: 'Lithium',           unit: 'tonne', price: 14200,  sharesPerUnit: 0.01,  volatility: 0.018, color: '#059669', desc: 'The Manono deposit is among the world\'s largest lithium resources.' },
     { symbol: 'TIN',       name: 'Tin (Cassiterite)', unit: 'tonne', price: 31800,  sharesPerUnit: 0.01,  volatility: 0.01,  color: '#64748b', desc: 'Cassiterite from North and South Kivu feeds global solder markets.' },
     { symbol: 'MANGANESE', name: 'Manganese',         unit: 'tonne', price: 560,    sharesPerUnit: 0.1,   volatility: 0.009, color: '#dc2626', desc: 'Steel-grade manganese from the Kisenge basin of Lualaba.' }
   ];
   MINERALS.forEach(m => { m.sharePrice = Math.round(m.price * m.sharesPerUnit * 100) / 100; });
   
   // Build 90 days of history per mineral
   function buildHistory(base, volatility, days = 90) {
     const history = [];
     let price = base * (0.85 + Math.random() * 0.1);
     const now = Date.now();
     for (let i = days; i >= 0; i--) {
       history.push({ t: now - i * 86400000, p: Math.round(price * 100) / 100 });
       price *= 1 + (Math.random() - 0.485) * volatility;
     }
     history[history.length - 1].p = base;
     return history;
   }
   MINERALS.forEach(m => { m.history = buildHistory(m.price, m.volatility); });
   
   // Live tick every 15 seconds
   function tick() {
     MINERALS.forEach(m => {
       m.price = Math.round(m.price * (1 + (Math.random() - 0.485) * m.volatility / 20) * 100) / 100;
       m.sharePrice = Math.round(m.price * m.sharesPerUnit * 100) / 100;
       m.history.push({ t: Date.now(), p: m.price });
       if (m.history.length > 600) m.history.shift();
     });
   }
   setInterval(tick, 15000);
   
   function mineralPayload(m) {
     const prev = m.history[Math.max(0, m.history.length - 2)].p;
     const dayAgo = m.history[Math.max(0, m.history.length - 57)]?.p || m.history[0].p;
     return {
       symbol: m.symbol, name: m.name, unit: m.unit, color: m.color, desc: m.desc,
       price: m.price, sharePrice: m.sharePrice, sharesPerUnit: m.sharesPerUnit,
       change: Math.round((m.price - prev) * 100) / 100,
       changePct: Math.round(((m.price - dayAgo) / dayAgo) * 10000) / 100
     };
   }
   
   function publicUser(u) {
     return {
       id: u._id, name: u.name, email: u.email, balance: u.balance,
       airtelMoney: u.airtelMoney?.phone
         ? { phone: u.airtelMoney.phone, verified: !!u.airtelMoney.verified, linkedAt: u.airtelMoney.linkedAt }
         : null
     };
   }
   
   /* ------------------------------ Auth helper --------------------------- */
   function signToken(user) {
     return jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
   }
   
   async function auth(req, res, next) {
     const header = req.headers.authorization || '';
     const token = header.startsWith('Bearer ') ? header.slice(7) : null;
     if (!token) return res.status(401).json({ error: 'Authentication required' });
     try {
       const payload = jwt.verify(token, JWT_SECRET);
       req.user = await User.findById(payload.id).select('-password');
       if (!req.user) return res.status(401).json({ error: 'User not found' });
       next();
     } catch {
       return res.status(401).json({ error: 'Invalid or expired token' });
     }
   }
   
   /* -------------------------------- Routes ------------------------------ */
   app.get('/api/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));
   
   // --- Auth ---
   app.post('/api/auth/register', async (req, res) => {
     try {
       const { name, email, password } = req.body || {};
       if (!name || !email || !password)
         return res.status(400).json({ error: 'Name, email and password are required' });
       if (password.length < 6)
         return res.status(400).json({ error: 'Password must be at least 6 characters' });
       const exists = await User.findOne({ email: email.toLowerCase() });
       if (exists) return res.status(409).json({ error: 'An account with this email already exists' });
       const hash = await bcrypt.hash(password, 10);
       const user = await User.create({ name, email, password: hash });
       res.status(201).json({ token: signToken(user), user: publicUser(user) });
     } catch (err) {
       res.status(500).json({ error: 'Registration failed', detail: err.message });
     }
   });
   
   app.post('/api/auth/login', async (req, res) => {
     try {
       const { email, password } = req.body || {};
       if (!email || !password)
         return res.status(400).json({ error: 'Email and password are required' });
       const user = await User.findOne({ email: email.toLowerCase() });
       if (!user || !(await bcrypt.compare(password, user.password)))
         return res.status(401).json({ error: 'Invalid email or password' });
       res.json({ token: signToken(user), user: publicUser(user) });
     } catch (err) {
       res.status(500).json({ error: 'Login failed', detail: err.message });
     }
   });
   
   app.get('/api/auth/me', auth, (req, res) => res.json(publicUser(req.user)));
   
   // --- Markets ---
   app.get('/api/minerals', (req, res) => res.json(MINERALS.map(mineralPayload)));
   
   app.get('/api/minerals/:symbol/history', (req, res) => {
     const m = MINERALS.find(x => x.symbol === req.params.symbol.toUpperCase());
     if (!m) return res.status(404).json({ error: 'Mineral not found' });
     const days = Math.min(parseInt(req.query.days) || 30, 90);
     res.json({
       symbol: m.symbol, name: m.name, unit: m.unit,
       sharesPerUnit: m.sharesPerUnit, color: m.color, desc: m.desc,
       history: m.history.slice(-(days + 1))
     });
   });
   
   // --- Payments (Airtel Money) ---
   // Pending verification codes, in-memory: userId -> { code, phone, expires }
   const pendingAirtel = new Map();
   
   app.get('/api/payments', auth, (req, res) => {
     res.json({
       airtelMoney: publicUser(req.user).airtelMoney,
       methods: [
         { id: 'airtel',   name: 'Airtel Money',        status: 'active' },
         { id: 'mpesa',    name: 'M-Pesa',              status: 'coming_soon' },
         { id: 'orange',   name: 'Orange Money',        status: 'coming_soon' },
         { id: 'card',     name: 'Visa / Mastercard',   status: 'coming_soon' },
         { id: 'bank',     name: 'Bank Transfer',       status: 'coming_soon' }
       ]
     });
   });
   
   app.post('/api/payments/airtel/link', auth, async (req, res) => {
     const { phone } = req.body || {};
     const cleaned = (phone || '').replace(/[\s-]/g, '');
     if (!/^\+?\d{9,15}$/.test(cleaned))
       return res.status(400).json({ error: 'Enter a valid Airtel Money number (e.g. +243991234567)' });
     // In production: trigger the Airtel Money Africa API to push a real OTP.
     const code = String(Math.floor(100000 + Math.random() * 900000));
     pendingAirtel.set(String(req.user._id), { code, phone: cleaned, expires: Date.now() + 10 * 60000 });
     console.log(`[airtel] verification code for ${req.user.email}: ${code}`);
     // devCode is returned only outside production so you can test the flow
     res.json({ ok: true, message: 'Verification code sent', ...(process.env.NODE_ENV !== 'production' ? { devCode: code } : {}) });
   });
   
   app.post('/api/payments/airtel/verify', auth, async (req, res) => {
     const { code } = req.body || {};
     const pending = pendingAirtel.get(String(req.user._id));
     if (!pending) return res.status(400).json({ error: 'No pending verification — request a new code' });
     if (Date.now() > pending.expires) { pendingAirtel.delete(String(req.user._id)); return res.status(400).json({ error: 'Code expired — request a new one' }); }
     if (String(code).trim() !== pending.code) return res.status(400).json({ error: 'Incorrect verification code' });
     req.user.airtelMoney = { phone: pending.phone, verified: true, linkedAt: new Date() };
     await req.user.save();
     pendingAirtel.delete(String(req.user._id));
     res.json({ ok: true, airtelMoney: publicUser(req.user).airtelMoney });
   });
   
   app.delete('/api/payments/airtel', auth, async (req, res) => {
     req.user.airtelMoney = { phone: null, verified: false, linkedAt: null };
     await req.user.save();
     res.json({ ok: true });
   });
   
   // --- Portfolio ---
   app.get('/api/portfolio', auth, async (req, res) => {
     const holdings = await Holding.find({ userId: req.user._id });
     const prices = Object.fromEntries(MINERALS.map(m => [m.symbol, m.sharePrice]));
     let holdingsValue = 0;
     const enriched = holdings.map(h => {
       const current = prices[h.symbol] || h.avgPrice;
       const value = h.shares * current;
       holdingsValue += value;
       return {
         symbol: h.symbol, shares: h.shares, avgPrice: h.avgPrice,
         currentPrice: current, value: Math.round(value * 100) / 100,
         pnl: Math.round((value - h.shares * h.avgPrice) * 100) / 100
       };
     });
     res.json({
       balance: req.user.balance,
       airtelMoney: publicUser(req.user).airtelMoney,
       holdingsValue: Math.round(holdingsValue * 100) / 100,
       totalValue: Math.round((req.user.balance + holdingsValue) * 100) / 100,
       holdings: enriched
     });
   });
   
   app.post('/api/trade', auth, async (req, res) => {
     try {
       const { symbol, type, shares } = req.body || {};
       const qty = parseFloat(shares);
       const m = MINERALS.find(x => x.symbol === (symbol || '').toUpperCase());
       if (!m) return res.status(404).json({ error: 'Mineral not found' });
       if (!['buy', 'sell'].includes(type)) return res.status(400).json({ error: 'Type must be buy or sell' });
       if (!qty || qty <= 0) return res.status(400).json({ error: 'Shares must be a positive number' });
   
       const user = await User.findById(req.user._id);
   
       // Buying requires a linked and verified Airtel Money account
       if (type === 'buy' && !user.airtelMoney?.verified) {
         return res.status(402).json({
           error: 'Link and verify your Airtel Money account before buying shares',
           code: 'PAYMENT_REQUIRED'
         });
       }
   
       const total = Math.round(qty * m.sharePrice * 100) / 100;
       let holding = await Holding.findOne({ userId: user._id, symbol: m.symbol });
   
       if (type === 'buy') {
         if (user.balance < total) return res.status(400).json({ error: 'Insufficient balance' });
         user.balance = Math.round((user.balance - total) * 100) / 100;
         if (holding) {
           holding.avgPrice = Math.round(((holding.avgPrice * holding.shares + m.sharePrice * qty) / (holding.shares + qty)) * 100) / 100;
           holding.shares += qty;
         } else {
           holding = new Holding({ userId: user._id, symbol: m.symbol, shares: qty, avgPrice: m.sharePrice });
         }
       } else {
         if (!holding || holding.shares < qty) return res.status(400).json({ error: 'Not enough shares to sell' });
         user.balance = Math.round((user.balance + total) * 100) / 100;
         holding.shares -= qty;
         if (holding.shares <= 0) await Holding.deleteOne({ _id: holding._id });
       }
   
       await user.save();
       if (holding && holding.shares > 0) await holding.save();
       await Transaction.create({ userId: user._id, symbol: m.symbol, type, shares: qty, price: m.sharePrice, total });
       res.json({ ok: true, balance: user.balance });
     } catch (err) {
       res.status(500).json({ error: 'Trade failed', detail: err.message });
     }
   });
   
   app.get('/api/transactions', auth, async (req, res) => {
     const txs = await Transaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
     res.json(txs);
   });
   
   /* -------------------------------- Start ------------------------------- */
   mongoose.connect(MONGODB_URI)
     .then(() => {
       console.log('[mineralholdings] MongoDB connected:', MONGODB_URI.replace(/\/\/.*@/, '//***@'));
       app.listen(PORT, () => console.log(`[mineralholdings] API running on port ${PORT}`));
     })
     .catch(err => {
       console.error('[mineralholdings] MongoDB connection failed:', err.message);
       process.exit(1);
     });
   