const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  firstName: String,
  username: String,
  joinedAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  totalScore: { type: Number, default: 0 },
  quizzesSolved: { type: Number, default: 0 },
  coins: { type: Number, default: 0 }, // Coinlar hisobi
  lastBonusDate: Date,
});

module.exports = mongoose.model("User", userSchema);
