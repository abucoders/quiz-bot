const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  question: String,
  options: [String],
  correct_option_id: Number,
  explanation: String,
  type: { type: String, default: "quiz" },
  file_id: String, // Rasm/Video bo'lsa (ixtiyoriy)
  file_type: String,
});

const quizSchema = new mongoose.Schema({
  title: String,
  description: String,
  creatorId: Number,
  questions: [questionSchema],
  // Sozlamalar
  settings: {
    time_limit: { type: Number, default: 30 }, // Soniya
    shuffle_questions: { type: Boolean, default: false }, // Savollarni aralashtirish
    shuffle_options: { type: Boolean, default: false }, // Variantlarni aralashtirish
  },
  plays: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Quiz", quizSchema);
