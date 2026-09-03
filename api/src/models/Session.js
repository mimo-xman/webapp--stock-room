/**
 * Session model — one production batch created by an AI agent run.
 * Titles are unique (case-insensitive collation on the unique index).
 */
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 120,
      index: true,
    },
  },
  { timestamps: true, collation: { locale: 'en', strength: 2 } }
);

module.exports = mongoose.models.Session || mongoose.model('Session', sessionSchema);
