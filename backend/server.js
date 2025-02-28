/********************************
 * server.js
 ********************************/
require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Console } = require("console");
const { Sequelize, DataTypes } = require("sequelize");
const PORT = process.env.PORT || 5000; // default port

// Global state variables
const usersScores = {}; // Stores scores { "twitchUserID": score }
const userSessionScores = {}; // Stores session scores { "twitchUserID": score }
let triviaActive = false; // ✅ Trivia is inactive until manually started
let triviaRoundEndTime = 0; // Prevents countdown updates during an active trivia round
let nextQuestionTime = null; // ✅ Prevents unnecessary calls to /get-next-question on startup
let questionInProgress = false; // ✅ Prevents multiple questions at once
let usedQuestions = []; // Avoiding Repeat Questions

// Configure CORS for Twitch EBS
const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Check if the origin is allowed
    const allowedOrigins = [
      // Twitch domains - using regex to match all subdomains
      /^https:\/\/.*\.ext-twitch\.tv$/,
      /^https:\/\/.*\.twitch\.tv$/,
      'https://ext-twitch.tv',
      'https://twitch.tv',
      'https://extension-files.twitch.tv',
      // Your domain
      'https://loremaster-trivia.com',
      'https://api.loremaster-trivia.com',
      // For local development
      'http://localhost:8080',
      'http://localhost:5000',
      'http://localhost:3000'
    ];
    
    // Check against regex patterns and exact matches
    const allowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return allowedOrigin === origin;
    });
    
    if (allowed) {
      callback(null, true);
    } else {
      console.warn(`⚠️ Request from disallowed origin: ${origin}`);
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

// Create Sequelize instance
const sequelize = new Sequelize({
  dialect: "mysql",
  host: process.env.DB_HOST,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  logging: console.log, // Set to false in production
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// Define Score model
const Score = sequelize.define("Score", {
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
    comment: "Twitch User ID"
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: "Total score of the user"
  },
  lastUpdated: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: Sequelize.NOW,
    comment: "Last time the score was updated"
  }
}, {
  tableName: "user_scores",
  timestamps: true, // Enables createdAt and updatedAt
  updatedAt: "lastUpdated",
  indexes: [
    {
      unique: true,
      fields: ["userId"]
    }
  ]
});

// ✅ Define TriviaQuestion model to match your database structure
const TriviaQuestion = sequelize.define("TriviaQuestion", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  question: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  correct_answer: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  wrong_answer1: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  wrong_answer2: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  wrong_answer3: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  category_id: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  difficulty: {
    type: DataTypes.STRING(50),
    defaultValue: 'Medium'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  }
}, {
  tableName: "trivia_questions",
  timestamps: false
});

// Define QuestionCategory model (for reference only - not required for basic functionality)
const QuestionCategory = sequelize.define("QuestionCategory", {
  id: {
    type: DataTypes.STRING(100),
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: "question_categories",
  timestamps: false
});

// Define TriviaSettings model for broadcaster preferences
const TriviaSettings = sequelize.define("TriviaSettings", {
  broadcaster_id: {
    type: DataTypes.STRING(100),
    primaryKey: true
  },
  active_categories: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  active_difficulties: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: ["Easy", "Medium", "Hard"]
  }
}, {
  tableName: "trivia_settings",
  timestamps: false
});

// Initialize database connection
async function initDatabase() {
  try {
    // Test the connection
    await sequelize.authenticate();
    console.log("✅ Database connection established successfully.");
    
    // Sync models with database (create tables if they don't exist)
    await sequelize.sync();
    console.log("✅ Database tables synchronized.");
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error);
    // Don't exit the process - the app can still work without DB
    console.warn("⚠️ Continuing without database persistence. Scores will be lost on server restart.");
  }
}

// Load initial questions to memory (for backward compatibility)
async function loadInitialQuestions() {
  try {
    console.log("🔄 Loading initial questions from database...");
    
    // Get a subset of questions from the database
    const dbQuestions = await loadQuestionsFromDB();
    
    // Convert to the format expected by existing code
    triviaQuestions = dbQuestions.map(q => ({
      question: q.question,
      choices: q.choices,
      correctAnswer: q.correctAnswer
    }));
    
    console.log(`✅ Loaded ${triviaQuestions.length} questions into memory from database`);
  } catch (error) {
    console.error("❌ Error loading initial questions:", error);
    console.warn("⚠️ Starting with empty question set");
    triviaQuestions = [];
  }
}

// Call this after database initialization
initDatabase().then(() => {
  loadInitialQuestions();
});

// Function to load questions from database with optional filters
async function loadQuestionsFromDB(categories = [], difficulties = []) {
  try {
    const whereClause = {};
    
    // Apply category filter if specified
    if (categories && categories.length > 0) {
      whereClause.category_id = categories;
    }
    
    // Apply difficulty filter if specified
    if (difficulties && difficulties.length > 0) {
      whereClause.difficulty = difficulties;
    }
    
    const questions = await TriviaQuestion.findAll({
      where: whereClause,
      order: sequelize.literal('RAND()'),
      limit: 500 // Limit to prevent memory issues with large datasets
    });
    
    console.log(`✅ Loaded ${questions.length} trivia questions from database`);
    
    return questions.map(q => ({
      id: q.id,
      question: q.question,
      choices: [q.correct_answer, q.wrong_answer1, q.wrong_answer2, q.wrong_answer3],
      correctAnswer: q.correct_answer,
      categoryId: q.category_id,
      difficulty: q.difficulty
    }));
  } catch (error) {
    console.error("❌ Error loading questions from database:", error);
    return [];
  }
}

// Function to get broadcaster's question filters
async function getBroadcasterFilters(broadcasterId) {
  try {
    // Default filters if no settings are found
    let filters = {
      categories: [],
      difficulties: ["Easy", "Medium", "Hard"]
    };
    
    // Find broadcaster settings
    const settings = await TriviaSettings.findByPk(broadcasterId);
    
    if (settings) {
      // Use broadcaster's preferences if they exist
      filters.categories = settings.active_categories || [];
      filters.difficulties = settings.active_difficulties || ["Easy", "Medium", "Hard"];
    }
    
    return filters;
  } catch (error) {
    console.error(`❌ Error getting broadcaster filters for ${broadcasterId}:`, error);
    return {
      categories: [],
      difficulties: ["Easy", "Medium", "Hard"]
    };
  }
}

// Function to get a single random question from the database
async function getRandomQuestionFromDB(categories = [], difficulties = []) {
  try {
    const whereClause = {};
    
    // Apply category filter if specified
    if (categories && categories.length > 0) {
      whereClause.category_id = categories;
    }
    
    // Apply difficulty filter if specified
    if (difficulties && difficulties.length > 0) {
      whereClause.difficulty = difficulties;
    }
    
    // ✅ UPDATED: Add exclusion for already used questions if any exist
    if (usedQuestions.length > 0) {
      whereClause.id = {
        [Sequelize.Op.notIn]: usedQuestions
      };
    }
    
    const question = await TriviaQuestion.findOne({
      where: whereClause,
      order: sequelize.literal('RAND()')
    });
    
    // If no question is found with the filters AND exclusions
    if (!question) {
      console.warn("⚠️ No unused questions match the filters");
      
      // If we have used questions, check if we should reset
      if (usedQuestions.length > 0) {
        console.log(`📊 All questions in this filter set have been used (${usedQuestions.length} questions)`);
        
        // If we've used a significant number of questions (10+), reset and try again
        if (usedQuestions.length > 10) {
          console.log("🔄 Resetting used questions tracking");
          usedQuestions = []; // Reset used questions
          
          // Try again without the exclusion
          return getRandomQuestionFromDB(categories, difficulties);
        } else {
          // For small question sets, try without filters rather than resetting
          return getRandomQuestionFromDB();
        }
      }
      
      // If we still don't have a question, return null
      return null;
    }
    
    // ✅ UPDATED: Add this question ID to used questions array
    usedQuestions.push(question.id);
    console.log(`📝 Added question ID ${question.id} to used questions list. Total used: ${usedQuestions.length}`);
    
    return {
      id: question.id,
      question: question.question,
      choices: [question.correct_answer, question.wrong_answer1, question.wrong_answer2, question.wrong_answer3],
      correctAnswer: question.correct_answer,
      categoryId: question.category_id,
      difficulty: question.difficulty
    };
  } catch (error) {
    console.error("❌ Error getting random question from database:", error);
    return null;
  }
}

// Initialize Express app
const app = express();
app.use(express.static(path.join(__dirname, "frontend"))); // Serve frontend via Express
app.use(cors());
app.use(express.json());

// Add security headers
app.use((req, res, next) => {
  // Prevent browsers from incorrectly detecting non-scripts as scripts
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Don't allow site to be framed except by Twitch
  res.setHeader('X-Frame-Options', 'ALLOW-FROM https://twitch.tv');
  
  // Helps prevent XSS attacks
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Set content security policy for Twitch extensions
  res.setHeader('Content-Security-Policy', `
    default-src 'self' https://*.twitch.tv https://*.ext-twitch.tv;
    connect-src 'self' https://*.twitch.tv https://*.ext-twitch.tv wss://pubsub-edge.twitch.tv https://api.twitch.tv;
    img-src 'self' https://*.twitch.tv https://*.ext-twitch.tv data:;
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.twitch.tv https://*.ext-twitch.tv;
    style-src 'self' 'unsafe-inline' https://*.twitch.tv https://*.ext-twitch.tv;
  `.replace(/\s+/g, ' ').trim());
  
  next();
});

// ✅ Serve frontend files from the correct directory
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "viewer.html"));
  console.log("✅ Serving viewer.html from:", frontendPath);
});

// ✅ Load Environment Variables
const EXT_CLIENT_ID = process.env.EXT_CLIENT_ID;
const EXT_OWNER_ID = process.env.EXT_OWNER_ID;
const CHANNEL_ID = process.env.CHANNEL_ID || "70361469";
const EXT_SECRET = process.env.EXT_SECRET;

if (!EXT_CLIENT_ID || !EXT_OWNER_ID || !EXT_SECRET) {
  console.error("❌ ERROR: Missing required environment variables!");
  process.exit(1);
}

const extSecretRaw = Buffer.from(EXT_SECRET, "base64");
if (extSecretRaw.length !== 32) {
  console.error("❌ ERROR: EXT_SECRET is not 32 bytes after decoding.");
  process.exit(1);
}

console.log("✅ Using Extension Client ID:", EXT_CLIENT_ID);
console.log("✅ Using Extension Owner ID:", EXT_OWNER_ID);
console.log("✅ Target Channel ID:", CHANNEL_ID);

// ✅ Generate JWT Token for Twitch PubSub authentication
function generateToken() {
  return jwt.sign(
      {
          exp: Math.floor(Date.now() / 1000) + 60,
          user_id: EXT_OWNER_ID,
          role: "external",
          channel_id: CHANNEL_ID.toString(),
          pubsub_perms: { send: ["broadcast"] },
      },
      extSecretRaw,
      { algorithm: "HS256" }
  );
}

// ✅ Helper: Broadcast to Twitch PubSub
async function broadcastToTwitch(channelId, message) {
  try {
    const token = generateToken();
    const payload = {
      target: ["broadcast"],
      broadcaster_id: channelId.toString(),
      is_global_broadcast: false,
      message: JSON.stringify(message),
    };

    await axios.post(
      "https://api.twitch.tv/helix/extensions/pubsub",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": EXT_CLIENT_ID,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Message type "${message.type}" broadcasted to channel ${channelId}`);
    return true;
  } catch (error) {
    console.error("❌ Error broadcasting to Twitch:", error.response?.data || error.message);
    return false;
  }
}

// ✅ Middleware: Verify Twitch JWT tokens for secured routes
function verifyTwitchJWT(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  
  const token = auth.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, extSecretRaw, {
      algorithms: ['HS256']
    });
    
    req.twitchUser = decoded;
    next();
  } catch (error) {
    console.error('❌ JWT Verification error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ✅ Timing Constants
const QUESTION_DURATION = 30000; // 30 seconds (legacy fallback)
const NEXT_QUESTION_INTERVAL = 600000; // 10 minutes
let triviaQuestions = [];

// ✅ Trivia Settings
let triviaSettings = {
  answerTime: 30000,     // Default 30 seconds
  intervalTime: 600000,  // Default 10 minutes
};

// ✅ Helper: Shuffle Array
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ✅ IMPROVED: Start Trivia Endpoint
app.post("/start-trivia", async (req, res) => {
  if (triviaActive) {
      console.log("⚠️ Trivia is already running. Ignoring start request.");
      return res.json({ success: false, message: "Trivia is already running!" });
  }

  try {
      // Set triviaActive first to prevent race conditions
      triviaActive = true;

      usedQuestions = [];
      console.log("🔄 Used questions list reset upon trivia start");

      const token = generateToken();
      const startPayload = {
          target: ["broadcast"],
          broadcaster_id: CHANNEL_ID.toString(),
          is_global_broadcast: false,
          message: JSON.stringify({ 
              type: "TRIVIA_START",
              intervalTime: triviaSettings.intervalTime
          }),
      };

      // Send the TRIVIA_START event
      await axios.post("https://api.twitch.tv/helix/extensions/pubsub", startPayload, {
          headers: {
              Authorization: `Bearer ${token}`,
              "Client-Id": EXT_CLIENT_ID,
              "Content-Type": "application/json",
          },
      });

      console.log("🚀 TRIVIA_START event broadcasted!");

      // Set next question time AFTER broadcasting
      const intervalTime = triviaSettings?.intervalTime || 600000;
      nextQuestionTime = Date.now() + intervalTime;

      console.log(`⏳ First trivia question will be in ${Math.round((nextQuestionTime - Date.now()) / 1000)} seconds.`);
      
      // Send response to client
      return res.json({ success: true, message: "Trivia started!" });

  } catch (error) {
      console.error("❌ Error broadcasting TRIVIA_START:", error);
      // Reset trivia state if it fails to start
      triviaActive = false;
      return res.status(500).json({ success: false, error: "Failed to start trivia." });
  }
});

// ✅ IMPROVED: Send Trivia Question from Database
async function sendTriviaQuestion(channelId) {
  if (!triviaActive) {
    console.log("⏳ Trivia is inactive. Waiting for Start command.");
    return;
  }

  if (questionInProgress) {
    console.warn("⚠️ A question is already in progress! Skipping duplicate question.");
    return;
  }

  try {
    // Mark that a question is in progress
    questionInProgress = true;
    
    console.log("🧠 Selecting a trivia question from the database...");
    
    // Get broadcaster's filter preferences
    const filters = await getBroadcasterFilters(channelId);
    
    // Get a random question from the database using filters
    let questionObj = await getRandomQuestionFromDB(filters.categories, filters.difficulties);
    
    // If no question matches the filters, try without filters
    if (!questionObj) {
      console.warn("⚠️ No questions match broadcaster filters, trying any question...");
      questionObj = await getRandomQuestionFromDB();
      
      // If still no question, check if we have any in memory as fallback
      if (!questionObj && triviaQuestions.length > 0) {
        console.warn("⚠️ Falling back to in-memory questions");
        questionObj = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
      }
      
      // If we still have no question, we can't continue
      if (!questionObj) {
        console.error("❌ No trivia questions available!");
        questionInProgress = false;
        return;
      }
    }
    
    // Shuffle the choices
    const shuffledChoices = shuffleArray([...questionObj.choices]);

    // Get timing settings with fallbacks
    const answerTime = triviaSettings?.answerTime || 30000; // Default 30s
    const intervalTime = triviaSettings?.intervalTime || 600000; // Default 10 min

    console.log(`⏳ Current trivia settings → Answer Time: ${answerTime}ms, Interval: ${intervalTime}ms`);
    console.log(`📝 Selected question: "${questionObj.question.substring(0, 50)}..." (ID: ${questionObj.id}, Category: ${questionObj.categoryId}, Difficulty: ${questionObj.difficulty})`);

    const pubsubPayload = {
      target: ["broadcast"],
      broadcaster_id: channelId.toString(),
      is_global_broadcast: false,
      message: JSON.stringify({
        type: "TRIVIA_QUESTION",
        question: questionObj.question,
        choices: shuffledChoices,
        correctAnswer: questionObj.correctAnswer,
        duration: answerTime,
        categoryId: questionObj.categoryId,
        difficulty: questionObj.difficulty,
        questionId: questionObj.id
      }),
    };

    console.log("📡 Broadcasting trivia question...");

    const token = generateToken();
    await axios.post(
      "https://api.twitch.tv/helix/extensions/pubsub",
      pubsubPayload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": EXT_CLIENT_ID,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ Trivia question sent to channel ${channelId}`);

    // Set round end time and schedule the next question
    triviaRoundEndTime = Date.now() + answerTime + 5000; // Extra 5s buffer

    setTimeout(() => {
      questionInProgress = false;
      nextQuestionTime = Date.now() + intervalTime; 
      console.log(`⏳ Next trivia question in: ${intervalTime / 1000} seconds`);
    }, answerTime + 5000);
    
  } catch (error) {
    console.error("❌ Error sending PubSub message:", error.response?.data || error.message);
    questionInProgress = false; // Always reset the flag on error
  }
}

// ✅ IMPROVED: CSV Upload Route
const upload = multer({ dest: "uploads/" });
app.post("/upload-csv", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const file = req.file.path;
    const lines = fs.readFileSync(file, "utf-8").split("\n");

    // Better validation and error handling for CSV
    triviaQuestions = lines.reduce((questions, rawLine, index) => {
      const line = rawLine.trim();
      if (!line) return questions; // skip empty lines

      const q = line.replace(/\r/g, "").split(",");
      
      // Ensure at least 5 columns: question + 4 choices
      if (q.length < 5) {
        console.warn(`❌ Line ${index + 1}: Skipping invalid line (not enough columns)`);
        return questions;
      }

      // Add question with stricter validation
      try {
        questions.push({
          question: q[0],
          choices: [q[1], q[2], q[3], q[4]], // no shuffling here
          correctAnswer: q[1],
        });
      } catch (error) {
        console.error(`❌ Line ${index + 1}: Error parsing question:`, error);
      }
      
      return questions;
    }, []);

    console.log(`✅ Trivia questions updated: ${triviaQuestions.length} valid questions loaded`);
    
    if (triviaQuestions.length === 0) {
      return res.status(400).json({ error: "No valid questions found in CSV!" });
    }
    
    res.json({ message: `✅ ${triviaQuestions.length} trivia questions uploaded successfully!` });
  } catch (error) {
    console.error("❌ Error processing CSV:", error);
    res.status(500).json({ error: "Failed to upload trivia questions." });
  }
});

// ✅ Handle User Answer Submission with Improved Scoring System
// Modify the submit-answer endpoint to track both scores
app.post("/submit-answer", async (req, res) => {
  try {
    const { userId, selectedAnswer, correctAnswer, answerTime, difficulty, duration } = req.body;

    if (!userId || !selectedAnswer || !correctAnswer || answerTime === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Calculate Score Based on Difficulty and Timing
    let basePoints = 0;
    const questionDifficulty = difficulty || 'Medium';  // Default to Medium if not specified
    const questionDuration = duration || triviaSettings.answerTime || 30000; // Use provided duration or default
    
    // Set base points based on difficulty
    switch(questionDifficulty) {
      case 'Easy':
        basePoints = 500;
        break;
      case 'Hard':
        basePoints = 1500;
        break;
      case 'Medium':
      default:
        basePoints = 1000;
        break;
    }

    let points = 0;
    
    if (selectedAnswer === correctAnswer) {
      // Calculate percentage of time elapsed (0 to 1)
      const timePercentage = Math.min(1, answerTime / questionDuration);
      
      // Calculate points reduction (1% per 1% of time)
      const pointsPercentage = Math.max(0.1, 1 - timePercentage); // Minimum 10%
      
      // Final points - round to nearest integer
      points = Math.round(basePoints * pointsPercentage);

      console.log(`🎯 Scoring: Difficulty=${questionDifficulty}, Base=${basePoints}, Time=${answerTime}/${questionDuration}, Percentage=${Math.round(pointsPercentage * 100)}%, Final=${points}`);
    } else {
      console.log(`❌ Incorrect answer: ${selectedAnswer} (correct: ${correctAnswer})`);
    }

    // Track total score in memory (for backup)
    if (!usersScores[userId]) usersScores[userId] = 0;
    usersScores[userId] += points;
    
    // Track session score separately
    if (!userSessionScores[userId]) userSessionScores[userId] = 0;
    userSessionScores[userId] += points;

    // Persist total score to database
    let totalScore = 0;
    try {
      // Try to find existing score
      const userScore = await Score.findByPk(userId);
      
      if (userScore) {
        // Update existing score
        userScore.score = userScore.score + points;
        userScore.lastUpdated = new Date();
        await userScore.save();
        totalScore = userScore.score;
        console.log(`🏆 Updated DB score for ${userId}: ${totalScore}`);
      } else {
        // Create new score record
        await Score.create({
          userId: userId,
          score: points,
          lastUpdated: new Date()
        });
        totalScore = points;
        console.log(`🏆 Created new DB score for ${userId}: ${totalScore}`);
      }
    } catch (dbError) {
      // Log error but don't fail the request
      console.error("❌ Database error when saving score:", dbError);
      console.log("⚠️ Continuing with in-memory score only");
      totalScore = usersScores[userId]; // Fallback to memory score
    }

    const sessionScore = userSessionScores[userId];
    console.log(`🏆 User ${userId} earned ${points} points! Total: ${totalScore}, Session: ${sessionScore}`);
    
    res.json({ 
      success: true, 
      pointsEarned: points, 
      totalScore: totalScore,
      sessionScore: sessionScore,
      basePoints,
      difficulty: questionDifficulty,
      timePercentage: Math.round((1 - Math.min(1, answerTime / questionDuration)) * 100)
    });
  } catch (error) {
    console.error("❌ Error submitting answer:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Modify the score retrieval endpoint to include session score
app.get("/score/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    // Get session score
    const sessionScore = userSessionScores[userId] || 0;
    
    // Attempt to get total score from database
    const userScore = await Score.findByPk(userId);
    
    if (userScore) {
      console.log(`📊 Retrieved score from DB for ${userId}: Total=${userScore.score}, Session=${sessionScore}`);
      return res.json({ 
        userId, 
        totalScore: userScore.score,
        sessionScore: sessionScore,
        lastUpdated: userScore.lastUpdated 
      });
    }
    
    // Fallback to memory if not in database
    const memoryScore = usersScores[userId] || 0;
    console.log(`📊 Using memory score for ${userId}: Total=${memoryScore}, Session=${sessionScore}`);
    
    res.json({ 
      userId, 
      totalScore: memoryScore,
      sessionScore: sessionScore
    });
  } catch (error) {
    console.error(`❌ Error retrieving score for ${userId}:`, error);
    
    // Fallback to memory on database error
    const totalScore = usersScores[userId] || 0;
    const sessionScore = userSessionScores[userId] || 0;
    res.json({ 
      userId, 
      totalScore: totalScore, 
      sessionScore: sessionScore,
      fromMemory: true
    });
  }
});

// Add endpoint to reset session scores (e.g., when a broadcaster ends trivia)
app.post("/reset-session-scores", (req, res) => {
  console.log("🔄 Resetting all session scores");
  // Clear all session scores
  Object.keys(userSessionScores).forEach(key => {
    userSessionScores[key] = 0;
  });
  res.json({ success: true, message: "Session scores reset" });
});


// ✅ Manual Route to Send a Trivia Question
app.post("/send-test", async (req, res) => {
  console.log("🚀 Received request to send a trivia question.");
  try {
    await sendTriviaQuestion(CHANNEL_ID);
    console.log("✅ Trivia question sent via /send-test");
    res.json({ success: true, message: "Trivia question sent!" });
  } catch (error) {
    console.error("❌ Error in /send-test:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ GET endpoint for testing trivia
app.get("/trivia", async (req, res) => {
  try {
    await sendTriviaQuestion(CHANNEL_ID);
    res.json({ success: true, message: "Trivia question sent via GET /trivia" });
  } catch (error) {
    console.error("❌ Error in GET /trivia:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ IMPROVED: Broadcast Countdown Update to Twitch PubSub
async function sendCountdownUpdate() {
  // Don't send updates if trivia is inactive or during an active question
  if (!triviaActive || Date.now() < triviaRoundEndTime) {
      return;
  }

  // If nextQuestionTime isn't set or has passed, don't send updates
  if (!nextQuestionTime || nextQuestionTime < Date.now()) {
      return;
  }

  const timeRemaining = nextQuestionTime - Date.now();
  
  try {
      const token = generateToken();
      const countdownPayload = {
          target: ["broadcast"],
          broadcaster_id: CHANNEL_ID.toString(),
          is_global_broadcast: false,
          message: JSON.stringify({
              type: "COUNTDOWN_UPDATE",
              timeRemaining: Math.max(0, timeRemaining),
          }),
      };

      await axios.post(
          "https://api.twitch.tv/helix/extensions/pubsub",
          countdownPayload,
          {
              headers: {
                  Authorization: `Bearer ${token}`,
                  "Client-Id": EXT_CLIENT_ID,
                  "Content-Type": "application/json",
              },
          }
      );
  } catch (error) {
      console.error("❌ Error sending countdown update:", error.message || error);
  }
}

// ✅ Update Trivia Settings
app.post("/update-settings", (req, res) => {
  console.log("📩 Received settings update request.");

  // ✅ Log the raw request body
  console.log("📦 Raw request body:", req.body);

  let { answerTime, intervalTime } = req.body;

  // 🔍 If body is empty, return error
  if (!req.body || Object.keys(req.body).length === 0) {
      console.error("❌ Invalid settings update request: Empty body received!");
      return res.status(400).json({ error: "Empty request body!" });
  }

  // ✅ Fallback check in case Twitch sends incorrect keys
  if (!answerTime && req.body.answerDuration) {
      answerTime = req.body.answerDuration * 1000;
  }
  if (!intervalTime && req.body.questionInterval) {
      intervalTime = req.body.questionInterval * 60000;
  }

  console.log("🔍 Parsed values:", { answerTime, intervalTime });

  // ✅ Validate numbers
  if (
      typeof answerTime !== "number" ||
      typeof intervalTime !== "number" ||
      answerTime < 5000 || answerTime > 60000 ||  
      intervalTime < 60000 || intervalTime > 1800000  
  ) {
      console.error("❌ Invalid time values:", { answerTime, intervalTime });
      return res.status(400).json({ error: "Invalid time values" });
  }

  // ✅ Save settings
  triviaSettings.answerTime = answerTime;
  triviaSettings.intervalTime = intervalTime;
  console.log("🔧 Trivia settings updated:", triviaSettings);

  // ✅ Broadcast new settings
  sendSettingsUpdate();

  res.json({ success: true, settings: triviaSettings });
});

// ✅ Broadcast settings to Twitch viewers
function sendSettingsUpdate() {
  const token = generateToken();

  const settingsPayload = {
    target: ["broadcast"],
    broadcaster_id: CHANNEL_ID.toString(),
    is_global_broadcast: false,
    message: JSON.stringify({
      type: "SETTINGS_UPDATE",
      answerTime: triviaSettings.answerTime,
      intervalTime: triviaSettings.intervalTime,
    }),
  };

  axios.post("https://api.twitch.tv/helix/extensions/pubsub", settingsPayload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": EXT_CLIENT_ID,
      "Content-Type": "application/json",
    },
  })
  .then(() => console.log("✅ Trivia settings broadcasted to viewers"))
  .catch(error => console.error("❌ Error broadcasting trivia settings:", error));
}

// ✅ Export Scores as CSV from Database with JWT support
app.get("/export-scores", async (req, res) => {
  try {
    const jwtToken = req.query.jwt;
    
    // Validate JWT if provided
    if (jwtToken) {
      try {
        jwt.verify(jwtToken, extSecretRaw, {
          algorithms: ['HS256']
        });
        console.log("✅ Valid JWT token provided for export-scores");
      } catch (jwtError) {
        console.warn("⚠️ Invalid JWT for export-scores, continuing anyway");
      }
    }
    
    // Fetch all scores from database
    const allScores = await Score.findAll({
      order: [['score', 'DESC']]
    });

    // Create CSV content
    let csvContent = "User ID,Score,Last Updated\n";
    
    // Add database scores
    allScores.forEach(record => {
      csvContent += `${record.userId},${record.score},${record.lastUpdated}\n`;
    });

    // Add any scores that might only exist in memory
    for (const [userId, score] of Object.entries(usersScores)) {
      // Skip if already in database results
      if (allScores.some(record => record.userId === userId)) continue;
      
      csvContent += `${userId},${score},memory-only\n`;
    }

    res.setHeader("Content-Disposition", "attachment; filename=loremaster_scores.csv");
    res.setHeader("Content-Type", "text/csv");
    res.send(csvContent);
  } catch (error) {
    console.error("❌ Error exporting scores from database:", error);
    
    // Fallback to memory-only export
    let csvContent = "User ID,Score,Source\n";
    Object.entries(usersScores).forEach(([userId, score]) => {
      csvContent += `${userId},${score},memory-fallback\n`;
    });
    
    res.setHeader("Content-Disposition", "attachment; filename=loremaster_scores_fallback.csv");
    res.setHeader("Content-Type", "text/csv");
    res.send(csvContent);
  }
});

// Modify the end-trivia endpoint to also reset session scores
app.post("/end-trivia", (req, res) => {
  console.log("🛑 Trivia manually ended!");

  triviaActive = false;
  triviaRoundEndTime = 0;
  nextQuestionTime = null;
  
  // ✅ UPDATED: Clear used questions when trivia ends
  usedQuestions = [];
  console.log("🔄 Used questions list cleared upon trivia end");

  // Reset session scores when trivia ends
  Object.keys(userSessionScores).forEach(key => {
    userSessionScores[key] = 0;
  });

  const token = generateToken();
  const endPayload = {
      target: ["broadcast"],
      broadcaster_id: CHANNEL_ID.toString(),
      is_global_broadcast: false,
      message: JSON.stringify({ type: "TRIVIA_END" }),
  };

  axios.post("https://api.twitch.tv/helix/extensions/pubsub", endPayload, {
      headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": EXT_CLIENT_ID,
          "Content-Type": "application/json",
      },
  })
  .then(() => {
      console.log("⛔ Trivia end command broadcasted!");
      console.log("🔴 Trivia is now INACTIVE. Waiting for Start command.");
      res.json({ success: true, message: "Trivia ended!" });
  })
  .catch(error => {
      console.error("❌ Error sending trivia end:", error);
      res.status(500).json({ error: "Failed to end trivia." });
  });
});

// ✅ IMPROVED: Main countdown and question timing interval
setInterval(() => {
  if (!triviaActive || !nextQuestionTime) {
      return;
  }

  const now = Date.now();
  let timeRemaining = nextQuestionTime - now;

  // For logging, only show every 10 seconds to reduce spam
  if (timeRemaining % 10000 < 1000) {
    console.log(`⏳ Time remaining: ${Math.round(timeRemaining / 1000)} seconds`);
  }

  // ✅ Update countdown UI
  sendCountdownUpdate();

  // ✅ When time runs out, request the next question
  if (timeRemaining <= 0 && !questionInProgress) {
      console.log("⏳ Countdown reached 0! Sending trivia question...");
      sendTriviaQuestion(CHANNEL_ID);
  }
}, 1000); // ✅ Runs once per second

// ✅ IMPROVED: Get-Next-Question Endpoint with Database Integration
app.get("/get-next-question", async (req, res) => {
  console.log("📢 /get-next-question endpoint called!");

  if (!triviaActive) {
    console.log("⏳ Trivia is inactive. Skipping next question request.");
    return res.json({ error: "Trivia is not active." });
  }

  // Check if we need to wait before sending the next question
  const timeRemaining = nextQuestionTime - Date.now();
  if (timeRemaining > 0) {
    console.log(`⏳ Next question not ready yet! Time remaining: ${Math.round(timeRemaining / 1000)} seconds`);
    return res.json({ error: "Next question not ready yet.", timeRemaining });
  }

  // Prevent overlap with ongoing questions
  if (questionInProgress) {
    console.warn("⚠️ A question is already in progress!");
    return res.json({ error: "A question is already in progress." });
  }

  try {
    console.log("🧠 Getting next question from database...");
    
    // Get broadcaster filters
    const filters = await getBroadcasterFilters(CHANNEL_ID);
    
    // Get random question from database
    let questionObj = await getRandomQuestionFromDB(filters.categories, filters.difficulties);
    
    // If no question matches filters, try without filters
    if (!questionObj) {
      console.warn("⚠️ No questions match broadcaster filters, trying any question...");
      questionObj = await getRandomQuestionFromDB();
      
      // If still no question, check in-memory as fallback
      if (!questionObj && triviaQuestions.length > 0) {
        console.warn("⚠️ Falling back to in-memory questions");
        questionObj = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
      }
      
      // If we still have no question, return error
      if (!questionObj) {
        console.error("❌ No trivia questions available!");
        return res.status(400).json({ error: "No trivia questions available." });
      }
    }
    
    // Shuffle choices
    const shuffledChoices = shuffleArray([...questionObj.choices]);
    
    // Prepare response
    const responseObj = {
      question: questionObj.question,
      choices: shuffledChoices,
      correctAnswer: questionObj.correctAnswer,
      duration: triviaSettings?.answerTime || 30000,
      categoryId: questionObj.categoryId,
      difficulty: questionObj.difficulty,
      questionId: questionObj.id
    };
    
    console.log(`📩 Sending next trivia question: ID ${questionObj.id}`);
    res.json(responseObj);
  } catch (error) {
    console.error("❌ Error getting next question:", error);
    res.status(500).json({ error: "Server error getting next question" });
  }
});

// Get all available categories
app.get("/api/categories", async (req, res) => {
  try {
    // Get unique categories from the questions table
    const categories = await sequelize.query(
      "SELECT DISTINCT category_id FROM trivia_questions ORDER BY category_id",
      { type: sequelize.QueryTypes.SELECT }
    );
    
    // Count questions in each category
    const categoriesWithCounts = await Promise.all(categories.map(async (category) => {
      const count = await TriviaQuestion.count({
        where: { category_id: category.category_id }
      });
      
      return {
        id: category.category_id,
        name: category.category_id, // Use ID as name
        questionCount: count
      };
    }));
    
    res.json({ categories: categoriesWithCounts });
  } catch (error) {
    console.error("❌ Error getting categories:", error);
    res.status(500).json({ error: "Failed to get categories" });
  }
});

// Get all available difficulties
app.get("/api/difficulties", async (req, res) => {
  try {
    // Get unique difficulties from the questions table
    const difficulties = await sequelize.query(
      "SELECT DISTINCT difficulty, COUNT(*) as count FROM trivia_questions GROUP BY difficulty ORDER BY FIELD(difficulty, 'Easy', 'Medium', 'Hard')",
      { type: sequelize.QueryTypes.SELECT }
    );
    
    res.json({ difficulties });
  } catch (error) {
    console.error("❌ Error getting difficulties:", error);
    res.status(500).json({ error: "Failed to get difficulties" });
  }
});

// Get broadcaster's trivia settings
app.get("/api/settings/:broadcasterId", async (req, res) => {
  try {
    const { broadcasterId } = req.params;
    
    if (!broadcasterId) {
      return res.status(400).json({ error: "Broadcaster ID is required" });
    }
    
    // Get broadcaster settings or default
    const settings = await TriviaSettings.findByPk(broadcasterId);
    
    // If no settings exist, return defaults
    if (!settings) {
      return res.json({
        settings: {
          broadcaster_id: broadcasterId,
          active_categories: [],
          active_difficulties: ["Easy", "Medium", "Hard"]
        }
      });
    }
    
    res.json({ settings });
  } catch (error) {
    console.error("❌ Error getting broadcaster settings:", error);
    res.status(500).json({ error: "Failed to get broadcaster settings" });
  }
});

// Update broadcaster's trivia settings
app.post("/api/settings/:broadcasterId", async (req, res) => {
  try {
    const { broadcasterId } = req.params;
    const { activeCategories, activeDifficulties } = req.body;
    
    if (!broadcasterId) {
      return res.status(400).json({ error: "Broadcaster ID is required" });
    }
    
    // Validate arrays
    if (activeCategories && !Array.isArray(activeCategories)) {
      return res.status(400).json({ error: "activeCategories must be an array" });
    }
    
    if (activeDifficulties && !Array.isArray(activeDifficulties)) {
      return res.status(400).json({ error: "activeDifficulties must be an array" });
    }
    
    // Update or create settings
    const [settings, created] = await TriviaSettings.upsert({
      broadcaster_id: broadcasterId,
      active_categories: activeCategories || [],
      active_difficulties: activeDifficulties || ["Easy", "Medium", "Hard"]
    });
    
    // Get sample counts
    const count = await TriviaQuestion.count({
      where: {
        category_id: activeCategories?.length > 0 ? activeCategories : { [Sequelize.Op.ne]: null },
        difficulty: activeDifficulties?.length > 0 ? activeDifficulties : { [Sequelize.Op.ne]: null }
      }
    });
    
    res.json({
      settings,
      created,
      questionCount: count,
      message: `Settings ${created ? 'created' : 'updated'}. ${count} questions match your filters.`
    });
  } catch (error) {
    console.error("❌ Error updating broadcaster settings:", error);
    res.status(500).json({ error: "Failed to update broadcaster settings" });
  }
});

// Get sample questions matching filters
app.get("/api/sample-questions", async (req, res) => {
  try {
    const { categories, difficulties, limit = 5 } = req.query;
    
    // Parse filter parameters
    const categoryFilter = categories ? categories.split(',') : [];
    const difficultyFilter = difficulties ? difficulties.split(',') : [];
    
    // Get sample questions
    const questions = await loadQuestionsFromDB(
      categoryFilter.length > 0 ? categoryFilter : undefined,
      difficultyFilter.length > 0 ? difficultyFilter : undefined
    );
    
    // Limit the number of questions returned
    const limitedQuestions = questions.slice(0, parseInt(limit));
    
    // Map to simplified format for preview
    const formattedQuestions = limitedQuestions.map(q => ({
      id: q.id,
      question: q.question,
      category: q.categoryId,
      difficulty: q.difficulty
    }));
    
    res.json({
      questions: formattedQuestions,
      totalMatching: questions.length,
      filters: {
        categories: categoryFilter,
        difficulties: difficultyFilter
      }
    });
  } catch (error) {
    console.error("❌ Error getting sample questions:", error);
    res.status(500).json({ error: "Failed to get sample questions" });
  }
});

// ✅ Handle Twitch extension message handler
app.post("/twitch/message", express.json(), async (req, res) => {
  try {
    const { channelId, message } = req.body;
    
    if (!channelId || !message || !message.type) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }
    
    console.log(`📩 Received Twitch message: ${message.type} for channel ${channelId}`);
    
    switch (message.type) {
      case "GET_CATEGORIES":
        // Get categories and broadcast back to Twitch
        const categories = await sequelize.query(
          "SELECT DISTINCT category_id FROM trivia_questions ORDER BY category_id",
          { type: sequelize.QueryTypes.SELECT }
        );
        
        // Count questions in each category
        const categoriesWithCounts = await Promise.all(categories.map(async (category) => {
          const count = await TriviaQuestion.count({
            where: { category_id: category.category_id }
          });
          
          return {
            id: category.category_id,
            name: category.category_id, // Use ID as name
            questionCount: count
          };
        }));
        
        // Broadcast categories back to the extension
        await broadcastToTwitch(channelId, {
          type: "CATEGORIES_RESPONSE",
          categories: categoriesWithCounts
        });
        break;
        
      case "GET_DIFFICULTIES":
        // Get difficulties and broadcast back to Twitch
        const difficulties = await sequelize.query(
          "SELECT DISTINCT difficulty, COUNT(*) as count FROM trivia_questions GROUP BY difficulty ORDER BY FIELD(difficulty, 'Easy', 'Medium', 'Hard')",
          { type: sequelize.QueryTypes.SELECT }
        );
        
        // Broadcast difficulties back to the extension
        await broadcastToTwitch(channelId, {
          type: "DIFFICULTIES_RESPONSE",
          difficulties: difficulties
        });
        break;
        
      case "GET_BROADCASTER_SETTINGS":
        // Get broadcaster settings
        const settings = await TriviaSettings.findByPk(message.broadcasterId || channelId);
        
        // Broadcast settings back to the extension
        await broadcastToTwitch(channelId, {
          type: "BROADCASTER_SETTINGS_RESPONSE",
          settings: settings || {
            broadcaster_id: message.broadcasterId || channelId,
            active_categories: [],
            active_difficulties: ["Easy", "Medium", "Hard"]
          }
        });
        break;
        
      case "GET_QUESTION_STATS":
        // Get question stats based on selected filters
        const categoryFilter = message.categories || [];
        const difficultyFilter = message.difficulties || [];
        
        // Build where clause
        const whereClause = {};
        if (categoryFilter.length > 0) {
          whereClause.category_id = categoryFilter;
        }
        if (difficultyFilter.length > 0) {
          whereClause.difficulty = difficultyFilter;
        }
        
        // Count matching questions
        const count = await TriviaQuestion.count({
          where: whereClause
        });
        
        // Broadcast stats back to the extension
        await broadcastToTwitch(channelId, {
          type: "QUESTION_STATS_RESPONSE",
          totalMatching: count,
          filters: {
            categories: categoryFilter,
            difficulties: difficultyFilter
          }
        });
        break;
        
      case "SAVE_FILTERS":
        // Save broadcaster filters
        const [updatedSettings, created] = await TriviaSettings.upsert({
          broadcaster_id: message.broadcasterId,
          active_categories: message.activeCategories || [],
          active_difficulties: message.activeDifficulties || ["Easy", "Medium", "Hard"]
        });
        
        // Get sample counts for response
        const matchingCount = await TriviaQuestion.count({
          where: {
            category_id: message.activeCategories?.length > 0 ? message.activeCategories : { [Sequelize.Op.ne]: null },
            difficulty: message.activeDifficulties?.length > 0 ? message.activeDifficulties : { [Sequelize.Op.ne]: null }
          }
        });
        
        // Broadcast response back to the extension
        await broadcastToTwitch(channelId, {
          type: "FILTERS_SAVED",
          settings: updatedSettings,
          created: created,
          questionCount: matchingCount,
          message: `Settings ${created ? 'created' : 'updated'}. ${matchingCount} questions match your filters.`
        });
        break;
        
      case "UPDATE_SETTINGS":
        // Validate time values
        const answerTime = message.answerTime;
        const intervalTime = message.intervalTime;
        
        if (
          typeof answerTime !== "number" ||
          typeof intervalTime !== "number" ||
          answerTime < 5000 || answerTime > 60000 ||  
          intervalTime < 60000 || intervalTime > 1800000  
        ) {
          console.error("❌ Invalid time values:", { answerTime, intervalTime });
          return res.status(400).json({ error: "Invalid time values" });
        }
        
        // Save settings
        triviaSettings.answerTime = answerTime;
        triviaSettings.intervalTime = intervalTime;
        
        // Broadcast settings update
        await broadcastToTwitch(channelId, {
          type: "SETTINGS_UPDATE",
          answerTime: triviaSettings.answerTime,
          intervalTime: triviaSettings.intervalTime,
        });
        break;
        
      case "START_TRIVIA":
        // Only start if not already running
        if (triviaActive) {
          console.log("⚠️ Trivia is already running. Ignoring start request.");
          return res.json({ success: false, message: "Trivia is already running!" });
        }
        
        // Set trivia active
        triviaActive = true;
        
        // Reset used questions
        usedQuestions = [];
        console.log("🔄 Used questions list reset upon trivia start via Twitch message");
        
        // Broadcast start event
        await broadcastToTwitch(channelId, { 
          type: "TRIVIA_START",
          intervalTime: triviaSettings.intervalTime
        });
        
        // Set next question time
        const nextInterval = triviaSettings?.intervalTime || 600000;
        nextQuestionTime = Date.now() + nextInterval;
        break;
        
      case "END_TRIVIA":
        // Set trivia inactive
        triviaActive = false;
        triviaRoundEndTime = 0;
        nextQuestionTime = null;
        
        // Reset used questions
        usedQuestions = [];
        console.log("🔄 Used questions list cleared upon trivia end via Twitch message");
        
        // Reset session scores
        Object.keys(userSessionScores).forEach(key => {
          userSessionScores[key] = 0;
        });
        
        // Broadcast end event
        await broadcastToTwitch(channelId, { type: "TRIVIA_END" });
        break;
        
      default:
        console.warn(`⚠️ Unknown message type: ${message.type}`);
        return res.status(400).json({ error: `Unknown message type: ${message.type}` });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error handling Twitch message:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Set up a proxy endpoint for the extension to use
app.post('/ext-proxy', express.json(), (req, res) => {
  const { endpoint, method, data, jwt } = req.body;
  
  // Validate the request
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }
  
  // Validate JWT if provided
  if (jwt) {
    try {
      const decoded = jwt.verify(jwt, extSecretRaw, {
        algorithms: ['HS256']
      });
      
      // Set authorized user info
      req.twitchUser = decoded;
    } catch (error) {
      console.warn('⚠️ Invalid JWT in proxy request, proceeding without authentication');
    }
  }
  
  // Determine the full internal URL
  const url = `/api/${endpoint}`;
  
  console.log(`🔄 Proxying request to ${url}`);
  
  // Create a new request to our internal API
  const options = {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  // Add body for POST requests
  if (method === 'POST' && data) {
    options.body = JSON.stringify(data);
  }
  
  // Forward the request to our internal API
  fetch(url, options)
    .then(response => response.json())
    .then(data => res.json(data))
    .catch(error => {
      console.error('❌ Error in proxy request:', error);
      res.status(500).json({ error: 'Internal server error' });
    });
});

// ✅ Create a separate JWT-authenticated proxy endpoint for secure operations
app.post('/ext-secure-proxy', express.json(), verifyTwitchJWT, (req, res) => {
  const { endpoint, method, data } = req.body;
  
  // Validate the request
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }
  
  // Determine the full internal URL
  const url = `/api/${endpoint}`;
  
  console.log(`🔒 Secure proxying request to ${url}`);
  
  // Create a new request to our internal API
  const options = {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Twitch-User-ID': req.twitchUser.user_id,
      'X-Twitch-Role': req.twitchUser.role
    }
  };
  
  // Add body for POST requests
  if (method === 'POST' && data) {
    options.body = JSON.stringify(data);
  }
  
  // Forward the request to our internal API
  fetch(url, options)
    .then(response => response.json())
    .then(data => res.json(data))
    .catch(error => {
      console.error('❌ Error in secure proxy request:', error);
      res.status(500).json({ error: 'Internal server error' });
    });
});

// ✅ Start Server
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));