const mongoose = require('mongoose');
require('dotenv').config();

// Database connection URL (add to your .env file)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/trivia-extension';

// Connect to database
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

module.exports = mongoose;