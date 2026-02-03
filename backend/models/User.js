const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 10000 }, // starting virtual cash
  portfolio: { type: Array, default: [] }   // { symbol, shares, avgPrice }
});

module.exports = mongoose.model('User', UserSchema);
