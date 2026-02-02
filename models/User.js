const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  firstName: String,
  username: String,
  joinedAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  totalScore: { type: Number, default: 0 }, // Umumiy ball
  quizzesSolved: { type: Number, default: 0 }, // Nechta test yechgani
});

module.exports = mongoose.model("User", userSchema);
