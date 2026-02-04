// backend/models/Portfolio.js
const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  stocks: [
    {
      symbol: String,      // e.g., "AAPL"
      quantity: Number,    // number of shares
      avgPrice: Number     // average purchase price per share
    }
  ]
});

module.exports = mongoose.model('Portfolio', portfolioSchema);
