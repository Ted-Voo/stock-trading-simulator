const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const User = require('../models/User');
const Portfolio = require('../models/Portfolio');
const Transaction = require('../models/Transaction');
require('dotenv').config();

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

// Fetch live stock price from Finnhub
async function getStockPrice(symbol) {
  try {
    const response = await axios.get('https://finnhub.io/api/v1/quote', {
      params: {
        symbol,
        token: process.env.STOCK_API_KEY
      }
    });
    const price = response.data.c; // current price
    if (!price) throw new Error('Price not available');
    return price;
  } catch (err) {
    console.error(`Error fetching price for ${symbol}:`, err.message);
    return null;
  }
}

// Get portfolio + balance + optional live prices
router.get('/', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user);
    let portfolio = await Portfolio.findOne({ userId: req.user });
    if (!portfolio) portfolio = { stocks: [] };

    // Add live price and unrealized P/L for each stock
    const portfolioWithLive = await Promise.all(
      portfolio.stocks.map(async (stock) => {
        const livePrice = await getStockPrice(stock.symbol);
        return {
          symbol: stock.symbol,
          quantity: stock.quantity,
          avgPrice: stock.avgPrice,
          currentPrice: livePrice,
          unrealizedPL: livePrice ? (livePrice - stock.avgPrice) * stock.quantity : null
        };
      })
    );

    res.json({
      balance: user.balance,
      portfolio: portfolioWithLive
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Buy stock
router.post('/buy', authMiddleware, async (req, res) => {
  const { symbol, quantity } = req.body;
  if (!symbol || quantity <= 0) return res.status(400).json({ msg: 'Invalid symbol or quantity' });

  try {
    const pricePerShare = await getStockPrice(symbol);
    if (!pricePerShare) return res.status(500).json({ msg: 'Failed to fetch stock price' });

    const totalCost = pricePerShare * quantity;
    const user = await User.findById(req.user);
    if (user.balance < totalCost) return res.status(400).json({ msg: 'Insufficient balance' });

    user.balance -= totalCost;
    await user.save();

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

    await Transaction.create({
      userId: req.user,
      symbol,
      quantity,
      price: pricePerShare,
      type: 'buy'
    });

    res.json({
      balance: user.balance,
      portfolio: portfolio.stocks
    });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

// Sell stock
router.post('/sell', authMiddleware, async (req, res) => {
  const { symbol, quantity } = req.body;
  if (!symbol || quantity <= 0) return res.status(400).json({ msg: 'Invalid symbol or quantity' });

  try {
    const portfolio = await Portfolio.findOne({ userId: req.user });
    if (!portfolio) return res.status(400).json({ msg: 'No portfolio found' });

    const stockIndex = portfolio.stocks.findIndex(s => s.symbol === symbol);
    if (stockIndex === -1 || portfolio.stocks[stockIndex].quantity < quantity)
      return res.status(400).json({ msg: 'Not enough shares to sell' });

    const pricePerShare = await getStockPrice(symbol);
    if (!pricePerShare) return res.status(500).json({ msg: 'Failed to fetch stock price' });

    const proceeds = pricePerShare * quantity;

    // Update portfolio
    const stock = portfolio.stocks[stockIndex];
    stock.quantity -= quantity;
    if (stock.quantity === 0) portfolio.stocks.splice(stockIndex, 1);
    await portfolio.save();

    // Update user balance
    const user = await User.findById(req.user);
    user.balance += proceeds;
    await user.save();

    // Create transaction
    await Transaction.create({
      userId: req.user,
      symbol,
      quantity,
      price: pricePerShare,
      type: 'sell'
    });

    res.json({
      balance: user.balance,
      portfolio: portfolio.stocks
    });
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
