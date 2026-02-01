const mongoose = require("mongoose");

const resultSchema = new mongoose.Schema({
  userId: Number,
  userName: String,
  quizId: mongoose.Schema.Types.ObjectId,
  score: Number,
  totalQuestions: Number,
  finishedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Result", resultSchema);
