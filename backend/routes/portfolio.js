const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Portfolio = require('../models/Portfolio');
const Transaction = require('../models/Transaction');

// Middleware to verify JWT
const authMiddleware = async (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1]; // Bearer <token>
  if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

// Mock stock prices
const mockStockPrices = {
  AAPL: 150,
  TSLA: 800,
  MSFT: 300
};

// Get portfolio + balance
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Get user's portfolio
    let portfolio = await Portfolio.findOne({ userId: req.user });
    if (!portfolio) portfolio = { stocks: [] }; // default empty portfolio

    // Get user's balance
    const user = await User.findById(req.user);

    res.json({
      balance: user.balance,
      portfolio: portfolio.stocks
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});


// Buy stock
router.post('/buy', authMiddleware, async (req, res) => {
  const { symbol, quantity } = req.body;
  if (!mockStockPrices[symbol]) return res.status(400).json({ msg: 'Invalid stock symbol' });
  if (quantity <= 0) return res.status(400).json({ msg: 'Quantity must be positive' });

  try {
    const pricePerShare = mockStockPrices[symbol];
    const totalCost = pricePerShare * quantity;

    // Get user
    const user = await User.findById(req.user);
    if (user.balance < totalCost) return res.status(400).json({ msg: 'Insufficient balance' });

    // Deduct balance
    user.balance -= totalCost;
    await user.save();

    // Update portfolio
    let portfolio = await Portfolio.findOne({ userId: req.user });
    if (!portfolio) portfolio = new Portfolio({ userId: req.user, stocks: [] });

    const stockIndex = portfolio.stocks.findIndex(s => s.symbol === symbol);
    if (stockIndex >= 0) {
      const stock = portfolio.stocks[stockIndex];
      stock.avgPrice = (stock.avgPrice * stock.quantity + pricePerShare * quantity) / (stock.quantity + quantity);
      stock.quantity += quantity;
    } else {
      portfolio.stocks.push({ symbol, quantity, avgPrice: pricePerShare });
    }

    await portfolio.save();

    // Create transaction record
    await Transaction.create({
      userId: req.user,
      symbol,
      quantity,
      price: pricePerShare,
      type: 'buy'
    });

    res.json({ balance: user.balance, portfolio: portfolio.stocks });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Sell stock
router.post('/sell', authMiddleware, async (req, res) => {
  const { symbol, quantity } = req.body;
  if (!mockStockPrices[symbol]) return res.status(400).json({ msg: 'Invalid stock symbol' });
  if (quantity <= 0) return res.status(400).json({ msg: 'Quantity must be positive' });

  try {
    const portfolio = await Portfolio.findOne({ userId: req.user });
    if (!portfolio) return res.status(400).json({ msg: 'No portfolio found' });

    const stockIndex = portfolio.stocks.findIndex(s => s.symbol === symbol);
    if (stockIndex === -1 || portfolio.stocks[stockIndex].quantity < quantity)
      return res.status(400).json({ msg: 'Not enough shares to sell' });

    const stock = portfolio.stocks[stockIndex];
    const pricePerShare = mockStockPrices[symbol];
    const proceeds = pricePerShare * quantity;

    // Update stock quantity
    stock.quantity -= quantity;
    if (stock.quantity === 0) portfolio.stocks.splice(stockIndex, 1);

    await portfolio.save();

    // Update user balance
    const user = await User.findById(req.user);
    user.balance += proceeds;
    await user.save();

    // Create transaction record
    await Transaction.create({
      userId: req.user,
      symbol,
      quantity,
      price: pricePerShare,
      type: 'sell'
    });

    res.json({ balance: user.balance, portfolio: portfolio.stocks });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Get transaction history
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user }).sort({ timestamp: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;
