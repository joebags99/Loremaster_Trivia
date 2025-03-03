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
const qs = require('querystring');
const path = require("path");
const { Console } = require("console");
const { Sequelize, DataTypes } = require("sequelize");
const PORT = process.env.PORT || 5000; // default port

// ✅ Load Environment Variables
const EXT_CLIENT_ID = process.env.EXT_CLIENT_ID;
const EXT_OWNER_ID = process.env.EXT_OWNER_ID;
const EXT_SECRET = process.env.EXT_SECRET;
const extSecretBuffer = Buffer.from(EXT_SECRET, 'base64');

// Debug environment variables
console.log("========== ENVIRONMENT VARIABLES DEBUG ==========");
console.log(`PORT: ${process.env.PORT || "(using default 5000)"}`);
console.log(`DB_HOST: ${process.env.DB_HOST ? "DEFINED" : "UNDEFINED"}`);
console.log(`DB_USER: ${process.env.DB_USER ? "DEFINED" : "UNDEFINED"}`);
console.log(`DB_NAME: ${process.env.DB_NAME ? "DEFINED" : "UNDEFINED"}`);
console.log(`DB_PASSWORD: ${process.env.DB_PASSWORD ? "DEFINED (length: " + process.env.DB_PASSWORD.length + ")" : "UNDEFINED"}`);
console.log(`EXT_CLIENT_ID: ${process.env.EXT_CLIENT_ID ? "DEFINED" : "UNDEFINED"}`);
console.log(`EXT_SECRET: ${process.env.EXT_SECRET ? "DEFINED" : "UNDEFINED"}`);
console.log(`EXT_OWNER_ID: ${process.env.EXT_OWNER_ID ? "DEFINED" : "UNDEFINED"}`);
console.log("=================================================");

// Check for missing database config and warn
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME || !process.env.DB_PASSWORD) {
  console.error("❌ WARNING: Missing required database environment variables!");
  console.error("Please check your .env file and make sure it's in the correct location:");
  console.error(`Current .env path: ${__dirname + "/.env"}`);
  console.error("Your .env file should contain: DB_HOST, DB_USER, DB_NAME, DB_PASSWORD");
  
  // List all .env files in the directory to help troubleshoot
  try {
    const files = fs.readdirSync(__dirname);
    const envFiles = files.filter(file => file.includes('.env'));
    console.error("Found these environment files:", envFiles);
  } catch (err) {
    console.error("Could not read directory to find .env files");
  }
}

// Initialize Sequelize with better error handling
const sequelize = new Sequelize({
  dialect: 'mysql',
  host: process.env.DB_HOST,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD, 
  database: process.env.DB_NAME,
  logging: false,
  dialectOptions: {
    connectTimeout: 20000 // Longer timeout for connection
  }
});

// Global username mappings
const userIdToUsername = {};
// Global state variables
const usersScores = {}; // Stores scores { "twitchUserID": score }
const userSessionScores = {}; // Stores session scores { "twitchUserID": score }
let triviaActive = false; // ✅ Trivia is inactive until manually started
let triviaRoundEndTime = 0; // Prevents countdown updates during an active trivia round
let nextQuestionTime = null; // ✅ Prevents unnecessary calls to /get-next-question on startup
let questionInProgress = false; // ✅ Prevents multiple questions at once
let usedQuestions = []; // Avoiding Repeat Questions

// Test the database connection immediately
(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:');
    console.error(error.message);
    if (error.original) {
      console.error('Original error:', error.original.message);
    }
    console.error('Continuing without database persistence. Scores will be lost on server restart.');
  }
})();

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
      'https://4jbcl7pxl1a654ueogvwz6z8xsnyed.ext-twitch.tv/',
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

function cleanUserId(userId) {
  if (!userId) return userId;
  // Convert to string if not already
  userId = String(userId);
  
  // Twitch channel IDs are numeric - remove any non-numeric prefix
  if (userId.startsWith('U') && /^U\d+$/.test(userId)) {
    return userId.substring(1); // Remove the 'U'
  }
  
  return userId;
}

// Initialize Express app
const app = express();

// Add proper body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log incoming requests for debugging
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/submit-answer') {
    console.log(`📩 Received answer submission with content-type: ${req.headers['content-type']}`);
    
    // Check if body exists
    if (!req.body || Object.keys(req.body).length === 0) {
      console.warn('⚠️ Empty request body received on submit-answer');
    }
  }
  next();
});

// Apply CORS to all routes
app.use(cors(corsOptions));

// Handle OPTIONS requests for CORS preflight
app.options('*', cors(corsOptions));

// Add specific options handler for the Twitch message endpoint
app.options('/twitch/message', cors(corsOptions), (req, res) => {
  res.status(204).send();
});

// Define Score model
const Score = sequelize.define("Score", {
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
    comment: "Twitch User ID"
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: "Twitch Display Name"
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
  timestamps: true,
  updatedAt: "lastUpdated",
  indexes: [
    {
      unique: true,
      fields: ["userId"]
    }
  ]
});

// Define TriviaQuestion model
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

// Define QuestionCategory model
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

// Define TriviaSettings model
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

// Improved function to get Twitch OAuth token
async function getTwitchOAuthToken() {
  try {
    console.log("🔑 Requesting Twitch OAuth token...");
    
    // Check if we have required environment variables
    if (!process.env.EXT_CLIENT_ID || !process.env.EXT_SECRET) {
      console.error("❌ Missing required environment variables for Twitch OAuth");
      console.error(`Client ID exists: ${!!process.env.EXT_CLIENT_ID}, Secret exists: ${!!process.env.EXT_SECRET}`);
      return null;
    }
    
    // Create proper form data
    const formData = new URLSearchParams();
    formData.append('client_id', process.env.EXT_CLIENT_ID);
    formData.append('client_secret', process.env.EXT_SECRET);
    formData.append('grant_type', 'client_credentials');
    
    console.log(`🔍 Using Client ID: ${process.env.EXT_CLIENT_ID.substring(0, 5)}...`);
    
    const response = await axios.post(
      'https://id.twitch.tv/oauth2/token',
      formData.toString(),
      { 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    console.log("✅ Twitch OAuth Token received successfully");
    return response.data.access_token;
  } catch (error) {
    console.error("❌ Error getting Twitch OAuth token:", error.response?.data || error.message);
    
    // Add more detailed error logging
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data));
    }
    
    return null;
  }
}

// Improved function to fetch usernames from Twitch API
async function fetchUsernames(userIds) {
  if (!userIds || userIds.length === 0) return;
  
  try {
    // Get OAuth token
    const token = await getTwitchOAuthToken();
    if (!token) {
      console.error('❌ Failed to get Twitch OAuth token');
      return;
    }
    
    // Filter and clean user IDs
    const validUserIds = userIds
      .filter(id => id && typeof id === 'string') // Ensure IDs are strings
      .map(id => {
        id = id.trim();
        // Remove 'U' prefix if it exists
        if (id.startsWith('U') && /^U\d+$/.test(id)) {
          return id.substring(1);
        }
        return id;
      })
      .filter(id => /^\d+$/.test(id)); // Only keep numeric IDs (Twitch IDs are numeric)
    
    if (validUserIds.length === 0) {
      console.warn('⚠️ No valid user IDs to fetch');
      return;
    }
    
    console.log(`🔍 Attempting to fetch usernames for ${validUserIds.length} IDs:`, 
      validUserIds.slice(0, 5).join(', '), validUserIds.length > 5 ? '...' : '');
    
    // Process in batches of 100 (Twitch API limit)
    const batchSize = 100;
    
    for (let i = 0; i < validUserIds.length; i += batchSize) {
      const batch = validUserIds.slice(i, i + batchSize);
      
      // Build query string correctly for Helix API
      const queryParams = new URLSearchParams();
      batch.forEach(id => {
        queryParams.append('id', id);
      });
      
      console.log(`🔍 Fetching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(validUserIds.length/batchSize)}`);
      console.log(`🔍 First few IDs in this batch: ${batch.slice(0, 3).join(', ')}${batch.length > 3 ? '...' : ''}`);
      
      try {
        // Make sure headers are correctly formatted
        const response = await axios.get(
          `https://api.twitch.tv/helix/users?${queryParams.toString()}`,
          {
            headers: {
              'Client-ID': process.env.EXT_CLIENT_ID,
              'Authorization': `Bearer ${token}`
            }
          }
        );
        
        if (response.data && response.data.data && response.data.data.length > 0) {
          console.log(`✅ Successfully retrieved ${response.data.data.length} usernames`);
          
          // Update cache with response data
          response.data.data.forEach(user => {
            userIdToUsername[user.id] = user.display_name;
            
            // Also store with 'U' prefix to handle both formats
            userIdToUsername['U' + user.id] = user.display_name;
          });
          
          // Log a few examples of what we got
          if (response.data.data.length > 0) {
            console.log('Sample usernames retrieved:', 
              response.data.data.slice(0, 3).map(u => `${u.id} -> ${u.display_name}`).join(', '));
          }
        } else {
          console.log(`⚠️ No users found in batch ${Math.floor(i/batchSize) + 1}`);
        }
      } catch (batchError) {
        console.error(`❌ Error fetching batch ${Math.floor(i/batchSize) + 1}:`, 
          batchError.response?.data || batchError.message);
          
        // Log more detailed error information to debug
        if (batchError.response) {
          console.error('Status:', batchError.response.status);
          console.error('Headers:', JSON.stringify(batchError.response.headers));
          console.error('Data:', JSON.stringify(batchError.response.data));
          
          // If there's an issue with the IDs, log them for inspection
          if (batchError.response.status === 400) {
            console.error('Problem IDs in this batch:', batch.join(', '));
          }
        }
      }
    }
    
    console.log(`📊 We now have ${Object.keys(userIdToUsername).length} username mappings`);
    
  } catch (error) {
    console.error('❌ Error in fetchUsernames:', error.message || error);
  }
}

// Debug function to check database structure 
async function debugDatabaseStructure() {
  try {
    console.log("🔍 Checking database structure...");
    
    // Check if the username column exists
    const [results] = await sequelize.query(
      "SHOW COLUMNS FROM user_scores LIKE 'username'"
    );
    
    if (results.length === 0) {
      console.log("⚠️ Username column doesn't exist in database. Adding it now...");
      
      // Add the username column if it doesn't exist
      await sequelize.query(
        "ALTER TABLE user_scores ADD COLUMN username VARCHAR(255)"
      );
      console.log("✅ Username column added to database");
    } else {
      console.log("✅ Username column exists in database");
    }
    
    // Check for sample user data
    const users = await Score.findAll({ limit: 5 });
    console.log("📊 Sample user data:", users.map(u => ({
      userId: u.userId,
      username: u.username,
      score: u.score
    })));
    
    // Check memory username mapping
    console.log("📊 Memory username mapping sample:", 
      Object.keys(userIdToUsername).slice(0, 5).map(key => ({
        userId: key, 
        username: userIdToUsername[key]
      }))
    );
    
  } catch (error) {
    console.error("❌ Error checking database structure:", error);
  }
}

// Initialize database connection
async function initDatabase() {
  try {
    // Test the connection
    await sequelize.authenticate();
    console.log("✅ Database connection established successfully.");
    
    // Sync models with database (create tables if they don't exist)
    await sequelize.sync();
    console.log("✅ Database tables synchronized.");
    
    // Run database structure debug
    await debugDatabaseStructure();
    
    // Load existing usernames from the database
    console.log("🔄 Loading existing usernames from database...");
    try {
      const existingScores = await Score.findAll({
        attributes: ['userId', 'username'],
        where: {
          username: {
            [Sequelize.Op.ne]: null
          }
        }
      });
      
      // Store usernames in the global mapping
      existingScores.forEach(score => {
        if (score.username) {
          userIdToUsername[score.userId] = score.username;
        }
      });
      
      console.log(`✅ Loaded ${existingScores.length} usernames from database`);
      
      // Log a few examples
      if (existingScores.length > 0) {
        console.log("Sample loaded usernames:", 
          existingScores.slice(0, 5).map(s => `${s.userId} -> ${s.username}`).join(', '));
      }
    } catch (usernameError) {
      console.error("❌ Error loading existing usernames:", usernameError);
    }
    
  } catch (error) {
    console.error("❌ Unable to connect to the database:", error);
    // Don't exit the process - the app can still work without DB
    console.warn("⚠️ Continuing without database persistence. Scores will be lost on server restart.");
  }
}

// Function to fix user IDs issue with Twitch API
async function repairUserIds() {
  try {
    console.log("🔧 Checking user IDs for potential issues...");
    
    // Get all unique user IDs from various sources
    const scoreIds = Object.keys(usersScores);
    const sessionIds = Object.keys(userSessionScores);
    const allIds = [...new Set([...scoreIds, ...sessionIds])];
    
    // Check for problematic IDs (non-numeric)
    const problematicIds = allIds.filter(id => !/^\d+$/.test(id));
    
    if (problematicIds.length > 0) {
      console.warn(`⚠️ Found ${problematicIds.length} problematic (non-numeric) user IDs`);
      console.warn(`Examples: ${problematicIds.slice(0, 5).join(', ')}${problematicIds.length > 5 ? '...' : ''}`);
      
      // For extension IDs that start with "U", try to repair by removing that prefix
      let repairedCount = 0;
      
      problematicIds.forEach(id => {
        // Common pattern in Twitch extensions: IDs that start with "U" followed by numbers
        if (id.startsWith('U') && /^U\d+$/.test(id)) {
          const numericId = id.substring(1); // Remove the 'U'
          
          // Transfer any scores or usernames to the numeric ID
          if (usersScores[id] !== undefined) {
            if (!usersScores[numericId]) usersScores[numericId] = 0;
            usersScores[numericId] += usersScores[id];
            delete usersScores[id];
          }
          
          if (userSessionScores[id] !== undefined) {
            if (!userSessionScores[numericId]) userSessionScores[numericId] = 0;
            userSessionScores[numericId] += userSessionScores[id];
            delete userSessionScores[id];
          }
          
          if (userIdToUsername[id]) {
            userIdToUsername[numericId] = userIdToUsername[id];
            delete userIdToUsername[id];
          }
          
          repairedCount++;
        }
      });
      
      console.log(`🔧 Repaired ${repairedCount} problematic IDs by removing 'U' prefix`);
    } else {
      console.log("✅ No problematic user IDs found");
    }
    
  } catch (error) {
    console.error("❌ Error in repairUserIds:", error);
  }
}

// Call this after database initialization
initDatabase()
  .then(() => loadInitialQuestions())
  .then(() => repairUserIds())
  .catch(error => {
    console.error("❌ Initialization error:", error);
  });



// Helper function to log username stats
function logUsernameStats() {
  const userCount = Object.keys(userIdToUsername).length;
  console.log(`📊 Current username mappings: ${userCount} users`);
  if (userCount > 0) {
    const sampleEntries = Object.entries(userIdToUsername).slice(0, 3);
    console.log("📊 Sample username mappings:", sampleEntries);
  }
}

// Initialize database
initDatabase().catch(error => {
  console.error("❌ Database initialization failed:", error);
});

// Add username capture endpoint
// Merged username capture endpoint with ID cleaning
app.post("/api/set-username", express.json(), (req, res) => {
  try {
    const { userId, username } = req.body;
    
    if (!userId || !username) {
      return res.status(400).json({ 
        success: false,
        error: "Missing userId or username" 
      });
    }
    
    // Clean the user ID and store original
    const originalId = userId;
    const cleanId = cleanUserId(userId);
    
    // Store username in memory for both original and cleaned IDs
    userIdToUsername[originalId] = username;
    if (originalId !== cleanId) {
      userIdToUsername[cleanId] = username;
      console.log(`👤 Storing username mapping for both formats: ${originalId} and ${cleanId}`);
    }
    
    console.log(`👤 Manually set username for ${userId}: ${username}`);
    
    // Try to update in database (check both ID formats)
    Promise.all([
      // Check if record exists with original ID
      Score.findByPk(originalId).then(userScore => {
        if (userScore) {
          userScore.username = username;
          return userScore.save();
        }
      }),
      
      // Check if record exists with cleaned ID (if different)
      originalId !== cleanId ? 
        Score.findByPk(cleanId).then(userScore => {
          if (userScore) {
            userScore.username = username;
            return userScore.save();
          }
        }) : Promise.resolve()
    ])
    .catch(err => {
      console.error("❌ Error updating username in database:", err);
    });
    
    // Return success
    res.json({ 
      success: true, 
      message: "Username set successfully",
      currentMappings: Object.keys(userIdToUsername).length,
      originalId,
      cleanId
    });
    
  } catch (error) {
    console.error("❌ Error setting username:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error" 
    });
  }
});

// Add extension identity endpoint
app.post("/extension-identity", express.json(), (req, res) => {
  try {
    const { userId, username } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    
    // Store username if provided
    if (username) {
      console.log(`👤 Received extension identity: User ${userId} is "${username}"`);
      userIdToUsername[userId] = username;
      
      // Also update in database if possible
      Score.findByPk(userId).then(userScore => {
        if (userScore) {
          userScore.username = username;
          return userScore.save();
        }
      }).catch(err => {
        console.error("❌ Error updating username in database:", err);
      });
    }
    
    // Log stats after update
    logUsernameStats();
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error in extension-identity endpoint:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// New endpoint to get leaderboard data with improved username handling
app.get("/api/leaderboard", async (req, res) => {
  try {
    // Get top scores from database
    const dbScores = await Score.findAll({
      order: [['score', 'DESC']],
      limit: 20
    });
    
    // Extract all user IDs
    const allUserIds = Array.from(new Set([
      ...dbScores.map(entry => entry.userId),
      ...Object.keys(userSessionScores)
    ]));
    
    // MODIFY: Clean all user IDs before processing
    const cleanedUserIds = allUserIds.map(id => cleanUserId(id));
    
    // If we have missing usernames, try to fetch them from Twitch API
    const missingIds = cleanedUserIds.filter(id => !userIdToUsername[id]);
    
    if (missingIds.length > 0) {
      console.log(`🔍 Fetching missing usernames for ${missingIds.length} users`);
      try {
        // Try to get usernames from Twitch API
        await fetchUsernames(missingIds);
      } catch (error) {
        console.error("⚠️ Error fetching usernames from API:", error);
        // Continue with what we have
      }
    }
    
    // Convert to a more usable format with usernames
    const totalLeaderboard = dbScores.map(entry => {
      // MODIFY: Clean the user ID before looking up username
      const cleanId = cleanUserId(entry.userId);
      return {
        userId: entry.userId,
        username: entry.username || userIdToUsername[cleanId] || `User-${cleanId.substring(0, 5)}...`,
        score: entry.score
      };
    });
    
    // Sort session scores and get top 20
    const sessionScores = Object.entries(userSessionScores)
      .map(([userId, score]) => {
        // MODIFY: Clean the user ID before looking up username
        const cleanId = cleanUserId(userId);
        return {
          userId,
          username: userIdToUsername[cleanId] || `User-${cleanId.substring(0, 5)}...`,
          score
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    
    // Log the first few entries to debug
    if (totalLeaderboard.length > 0) {
      console.log("🏆 Total leaderboard sample:", totalLeaderboard.slice(0, 3));
    }
    
    if (sessionScores.length > 0) {
      console.log("🏆 Session leaderboard sample:", sessionScores.slice(0, 3));
    }
    
    res.json({
      total: totalLeaderboard,
      session: sessionScores
    });
  } catch (error) {
    console.error("❌ Error fetching leaderboard:", error);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
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
    
    // Run database structure debug
    await debugDatabaseStructure();
    
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

// Add security headers
app.use((req, res, next) => {
  // Log all API requests for debugging
  if (req.path.startsWith('/api/')) {
    // Add request ID for tracing through logs
    req.requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    console.log(`📝 API Request: ${req.method} ${req.path} (${req.requestId})`);
  }

  // Check if this might be a categories request with wrong path
  if (req.path === '/categories' || req.path === '/difficulties') {
    console.log(`🔄 Redirecting ${req.path} to /api${req.path}`);
    return res.redirect(`/api${req.path}`);
  }
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
    style-src 'self' 'unsafe-inline' https://*.twitch.tv https://*.ext-twitch.tv https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com;
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

// ✅ Define routes for the configuration view
app.get("/config", (req, res) => {
  res.sendFile(path.join(frontendPath, "config.html"));
  console.log("✅ Serving config.html from:", frontendPath);
});

// ✅ Define routes for the mobile view (fix the typo in filename)
app.get("/mobile", (req, res) => {
  res.sendFile(path.join(frontendPath, "mobile.html"));  // Not "moblile.html"
  console.log("✅ Serving mobile.html from:", frontendPath);
});

// ✅ Define routes for the overlay view
app.get("/overlay", (req, res) => {
  res.sendFile(path.join(frontendPath, "overlay.html"));
  console.log("✅ Serving overlay.html from:", frontendPath);
});

if (!EXT_CLIENT_ID || !EXT_OWNER_ID || !EXT_SECRET) {
  console.error("❌ ERROR: Missing required environment variables!");
  process.exit(1);
}

console.log("✅ Using Extension Client ID:", EXT_CLIENT_ID);
console.log("✅ Using Extension Owner ID:", EXT_OWNER_ID);

// Improved JWT token generation for Twitch PubSub authentication
function generateToken(specificChannelId = null) {
  try {
    // Clean and validate the secret
    if (!EXT_SECRET || EXT_SECRET.length < 10) {
      console.error("❌ EXT_SECRET is missing or too short");
      return null;
    }
    
    const channelId = specificChannelId || EXT_OWNER_ID;
    
    if (!channelId) {
      console.error("❌ No valid channel ID available for JWT generation");
      return null;
    }
    
    // Ensure IDs are properly formatted
    console.log("EXT_OWNER_ID:", EXT_OWNER_ID);
    const cleanOwnerId = String(EXT_OWNER_ID).trim();
    const cleanChannelId = String(channelId).trim();
    
    // Log IDs being used (without logging full client ID for security)
    console.log(`🔍 Using clean IDs for JWT: Owner=${cleanOwnerId}, Channel=${cleanChannelId}`);
    
    const now = Math.floor(Date.now() / 1000);
    
    // Create payload with proper order and formatting
    // Note: client_id removed from payload as per Twitch requirements
    const payload = {
      exp: now + 300,
      iat: now,
      user_id: cleanOwnerId,
      role: "external",
      channel_id: cleanChannelId,
      pubsub_perms: {
        send: ["broadcast"]
      }
    };
    
    console.log("🔑 Generating JWT with payload:", JSON.stringify(payload));
    const token = jwt.sign(payload, extSecretBuffer, { algorithm: "HS256" });
    console.log(`✅ JWT generated: ${token.substring(0, 20)}...`);
    
    // Verify the token to make sure it's valid
    try {
      jwt.verify(token, extSecretBuffer, { algorithms: ['HS256'] });
      console.log("✅ JWT self-verification passed");
    } catch (verifyError) {
      console.error("❌ JWT self-verification failed:", verifyError);
      return null;
    }
    
    return token;
  } catch (error) {
    console.error("❌ Error generating JWT:", error);
    return null;
  }
}

// ✅ Helper: Broadcast to Twitch PubSub
async function broadcastToTwitch(channelId, message) {
  try {
    // Add defensive check for channelId
    if (!channelId) {
      console.error("❌ Missing channelId in broadcastToTwitch - using default");
      // Fall back to your default EXT_OWNER_ID
      channelId = EXT_OWNER_ID;
      
      // If still undefined, fail early
      if (!channelId) {
        console.error("❌ No valid channel ID available");
        return false;
      }
    }
    
    // Generate token specifically for this channel
    const token = generateToken(channelId);
    
    if (!token) {
      console.error("❌ Failed to generate valid JWT token");
      return false;
    }
    
    const payload = {
      target: ["broadcast"],
      broadcaster_id: channelId.toString(),
      is_global_broadcast: false,
      message: JSON.stringify(message),
    };

    console.log(`📡 Broadcasting to Twitch: ${message.type} for channel ${channelId}`);
    
    const response = await axios.post(
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
    
    console.log(`✅ Successfully broadcast message type "${message.type}" to channel ${channelId}`);
    return true;
  } catch (error) {
    console.error("❌ Error broadcasting to Twitch:", error.response?.data || error.message);
    
    // Log more details about the error
    if (error.response && error.response.data) {
      console.error("📄 Error details:", error.response.data);
    }
    
    return false;
  }
}

app.post("/extension-identity", express.json(), (req, res) => {
  try {
    const { userId, username } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    
    // Store username if provided
    if (username) {
      console.log(`👤 Received extension identity: User ${userId} is "${username}"`);
      userIdToUsername[userId] = username;
      
      // Also update in database if possible
      Score.findByPk(userId).then(userScore => {
        if (userScore) {
          userScore.username = username;
          return userScore.save();
        }
      }).catch(err => {
        console.error("❌ Error updating username in database:", err);
      });
    }
    
    // Log stats after update
    logUsernameStats();
    
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error in extension-identity endpoint:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Middleware: Verify Twitch JWT tokens for secured routes
function verifyTwitchJWT(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  
  const token = auth.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, extSecretBuffer, {
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
          broadcaster_id: EXT_OWNER_ID.toString(),
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

// ✅ Handle User Answer Submission with Improved Scoring System and Error Handling
app.post("/submit-answer", async (req, res) => {
  console.log("📤 Received answer submission:", req.body);
  
  try {
    // Handle empty or undefined body
    if (!req.body || Object.keys(req.body).length === 0) {
      console.error("❌ Empty request body on submit-answer endpoint");
      return res.status(400).json({ error: "Empty request body" });
    }
    
    // Safely extract values with defaults
    const userId = req.body.userId ? String(req.body.userId).trim() : null; // Ensure it's a string
    const selectedAnswer = req.body.selectedAnswer;
    const correctAnswer = req.body.correctAnswer;
    const answerTime = req.body.answerTime;
    const difficulty = req.body.difficulty || 'Medium';
    const duration = req.body.duration || triviaSettings.answerTime || 30000;

    // Validate required fields
    if (!userId || !selectedAnswer || !correctAnswer || answerTime === undefined) {
      console.error("❌ Missing required fields:", { 
        userId: !!userId, 
        selectedAnswer: !!selectedAnswer, 
        correctAnswer: !!correctAnswer, 
        answerTime: answerTime !== undefined 
      });
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Store username when available 
    if (req.body.username) {
      const username = String(req.body.username).trim();
      userIdToUsername[userId] = username;
      console.log(`👤 Stored username for ${userId}: ${username}`);
    }

    // Calculate Score Based on Difficulty and Timing
    let basePoints = 0;
    
    // Set base points based on difficulty
    switch(difficulty) {
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
      const timePercentage = Math.min(1, answerTime / duration);
      
      // Calculate points reduction (1% per 1% of time)
      const pointsPercentage = Math.max(0.1, 1 - timePercentage); // Minimum 10%
      
      // Final points - round to nearest integer
      points = Math.round(basePoints * pointsPercentage);

      console.log(`🎯 Scoring: Difficulty=${difficulty}, Base=${basePoints}, Time=${answerTime}/${duration}, Percentage=${Math.round(pointsPercentage * 100)}%, Final=${points}`);
    } else {
      console.log(`❌ Incorrect answer: ${selectedAnswer} (correct: ${correctAnswer})`);
    }

    // Track total score in memory (for backup)
    if (!usersScores[userId]) usersScores[userId] = 0;
    usersScores[userId] += points;
    
    // Track session score separately
    if (!userSessionScores[userId]) userSessionScores[userId] = 0;
    userSessionScores[userId] += points;

    // Get current total score from database or memory
    let totalScore = usersScores[userId];
    
    try {
      // Attempt to get existing score from database
      const userScore = await Score.findByPk(userId);
      
      if (userScore) {
        // Update existing score
        userScore.score = userScore.score + points;
        userScore.lastUpdated = new Date();
        
        // Also update username if we have it
        if (req.body.username) {
          userScore.username = req.body.username;
        }
        
        await userScore.save();
        totalScore = userScore.score;
        console.log(`🏆 Updated DB score for ${userId}: ${totalScore}`);
      } else {
        // Create new score record
        await Score.create({
          userId: userId,
          username: req.body.username || null,
          score: points,
          lastUpdated: new Date()
        });
        totalScore = points;
        console.log(`🏆 Created new DB score for ${userId}: ${totalScore}`);
      }
    } catch (dbError) {
      console.error('❌ Database error in submit-answer:', dbError);
      // Continue with memory scores
    }

    const sessionScore = userSessionScores[userId];
    console.log(`🏆 User ${userId} earned ${points} points! Total: ${totalScore}, Session: ${sessionScore}`);
    
    res.json({ 
      success: true, 
      pointsEarned: points, 
      totalScore: totalScore,
      sessionScore: sessionScore,
      basePoints,
      difficulty: difficulty,
      timePercentage: Math.round((1 - Math.min(1, answerTime / duration)) * 100)
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
    await sendTriviaQuestion(EXT_OWNER_ID);
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
    await sendTriviaQuestion(EXT_OWNER_ID);
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
          broadcaster_id: EXT_OWNER_ID.toString(),
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
    broadcaster_id: EXT_OWNER_ID.toString(),
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
        jwt.verify(jwtToken, extSecretBuffer, {
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
      broadcaster_id: EXT_OWNER_ID.toString(),
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
      sendTriviaQuestion(EXT_OWNER_ID);
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
    const filters = await getBroadcasterFilters(EXT_OWNER_ID);
    
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
  // Set explicit CORS headers to make sure they're properly applied
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  try {
    console.log(`🔍 Getting categories from database...`);
    
    // Get unique categories from the questions table
    const categories = await sequelize.query(
      "SELECT DISTINCT category_id FROM trivia_questions ORDER BY category_id",
      { type: sequelize.QueryTypes.SELECT }
    );
    
    if (!categories || categories.length === 0) {
      console.log("⚠️ No categories found in database");
      return res.json({ categories: [] });
    }
    
    console.log(`✅ Found ${categories.length} categories`);
    
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
    
    console.log(`✅ Returning ${categoriesWithCounts.length} categories with counts`);
    res.json({ categories: categoriesWithCounts });
  } catch (error) {
    console.error("❌ Error getting categories:", error);
    res.status(500).json({ error: "Failed to get categories", message: error.message });
  }
});

// Simple test endpoint for debugging
app.get("/api/test-twitch-api", async (req, res) => {
  try {
    // Get a sample user ID from our database
    const sampleUser = await Score.findOne();
    const testUserId = sampleUser ? sampleUser.userId : null;
    
    if (!testUserId) {
      return res.json({ 
        success: false, 
        message: "No user IDs available to test with" 
      });
    }
    
    console.log(`🧪 Testing Twitch API with user ID: ${testUserId}`);
    
    // Try to fetch username
    const token = await getTwitchOAuthToken();
    if (!token) {
      return res.json({ 
        success: false, 
        message: "Could not obtain OAuth token" 
      });
    }
    
    // Use proper URL encoding for the ID
    const queryParams = new URLSearchParams();
    queryParams.append('id', testUserId);
    
    const response = await axios.get(
      `https://api.twitch.tv/helix/users?${queryParams.toString()}`,
      {
        headers: {
          'Client-ID': process.env.EXT_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    // Return detailed test results
    res.json({
      success: true,
      message: "Twitch API test completed",
      testUserId: testUserId,
      response: response.data,
      usernameMappings: Object.keys(userIdToUsername).length
    });
    
  } catch (error) {
    console.error("❌ Error testing Twitch API:", error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: error.response?.data || {}
    });
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

// Debug function to check database structure 
async function debugDatabaseStructure() {
  try {
    console.log("🔍 Checking database structure...");
    
    // Check if the username column exists
    const [results] = await sequelize.query(
      "SHOW COLUMNS FROM user_scores LIKE 'username'"
    );
    
    if (results.length === 0) {
      console.log("⚠️ Username column doesn't exist in database. Adding it now...");
      
      // Add the username column if it doesn't exist
      await sequelize.query(
        "ALTER TABLE user_scores ADD COLUMN username VARCHAR(255)"
      );
      console.log("✅ Username column added to database");
    } else {
      console.log("✅ Username column exists in database");
    }
    
    // Check for sample user data
    const users = await Score.findAll({ limit: 5 });
    console.log("📊 Sample user data:", users.map(u => ({
      userId: u.userId,
      username: u.username,
      score: u.score
    })));
    
    // Check memory username mapping
    console.log("📊 Memory username mapping sample:", 
      Object.keys(userIdToUsername).slice(0, 5).map(key => ({
        userId: key, 
        username: userIdToUsername[key]
      }))
    );
    
  } catch (error) {
    console.error("❌ Error checking database structure:", error);
  }
}

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

// Endpoint to manually add usernames (for testing)
app.post("/api/add-username", express.json(), (req, res) => {
  const { userId, username } = req.body;
  
  if (!userId || !username) {
    return res.status(400).json({ error: "Missing userId or username" });
  }
  
  twitchUsernames[userId] = username;
  res.json({ success: true, message: `Username ${username} added for ${userId}` });
});

// ✅ Handle Twitch extension message handler
app.post("/twitch/message", express.json(), async (req, res) => {
  console.log("🔍 DEBUG - Full request body:", JSON.stringify(req.body));
  try {
    const { channelId, message } = req.body;
    
    if (!channelId || !message || !message.type) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }
    
    console.log(`📩 Received Twitch message: ${message.type} for channel ${channelId}`);
    
    switch (message.type) {
      // Modify the GET_CATEGORIES handler to ensure proper formatting
      case "GET_CATEGORIES":
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
                name: category.category_id, // Use ID as name if no separate name exists
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
          
          console.log(`📊 GET_QUESTION_STATS received with filters:`, {
            categories: categoryFilter,
            difficulties: difficultyFilter
          });
          
          // Build where clause
          const whereClause = {};
          if (categoryFilter.length > 0) {
            whereClause.category_id = categoryFilter;
          }
          if (difficultyFilter.length > 0) {
            whereClause.difficulty = difficultyFilter;
          }
          
          // Count matching questions
          let count = 0;
          try {
            count = await TriviaQuestion.count({
              where: whereClause
            });
            console.log(`📊 Found ${count} questions matching filters`);
          } catch (countError) {
            console.error("❌ Error counting questions:", countError);
            count = 0;
          }
          
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
        
        console.log(`⚙️ UPDATE_SETTINGS received:`, {
          answerTime,
          intervalTime
        });
        
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
        
        // Broadcast settings update - use both terms for compatibility
        await broadcastToTwitch(channelId, {
          type: "SETTINGS_UPDATE", // Old term
          answerTime: triviaSettings.answerTime,
          intervalTime: triviaSettings.intervalTime,
        });
        
        // Also broadcast with the new term
        await broadcastToTwitch(channelId, {
          type: "UPDATE_SETTINGS", // New term
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

// Debug endpoint to check what IDs are stored
app.get("/debug/user-ids", (req, res) => {
  try {
    // Get all user IDs from the various stores
    const scoreIds = Object.keys(usersScores);
    const sessionIds = Object.keys(userSessionScores);
    const usernameIds = Object.keys(userIdToUsername);
    
    // Find sample IDs
    const allIds = [...new Set([...scoreIds, ...sessionIds, ...usernameIds])];
    const sampleIds = allIds.slice(0, 10); // First 10 IDs
    
    // For each sample ID, show the format and any username
    const samples = sampleIds.map(id => ({
      id,
      format: {
        raw: id,
        length: id.length,
        isNumeric: /^\d+$/.test(id),
        containsNonAlphaNum: /[^a-zA-Z0-9]/.test(id)
      },
      username: userIdToUsername[id] || null,
      hasScore: id in usersScores,
      sessionScore: userSessionScores[id] || 0
    }));
    
    res.json({
      counts: {
        totalUniqueIds: allIds.length,
        scoresCount: scoreIds.length,
        sessionScoresCount: sessionIds.length,
        usernamesCount: usernameIds.length
      },
      samples,
      usernameSamples: Object.entries(userIdToUsername).slice(0, 10).map(([id, name]) => ({ id, name }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to test Twitch API with specific IDs
app.get("/debug/test-twitch-api/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    
    console.log(`🧪 Testing Twitch API with user ID: ${userId}`);
    
    // First try to get OAuth token
    const token = await getTwitchOAuthToken();
    if (!token) {
      return res.status(500).json({ 
        error: "Failed to get OAuth token",
        tip: "Check your EXT_CLIENT_ID and EXT_SECRET environment variables"
      });
    }
    
    // Build query
    const queryParams = new URLSearchParams();
    queryParams.append('id', userId);
    
    try {
      // Make the API call
      const response = await axios.get(
        `https://api.twitch.tv/helix/users?${queryParams.toString()}`,
        {
          headers: {
            'Client-ID': process.env.EXT_CLIENT_ID,
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      res.json({
        success: true,
        message: "API call successful",
        userId,
        result: response.data,
        tokenInfo: {
          obtained: true,
          truncated: token ? `${token.substring(0, 5)}...` : null
        }
      });
    } catch (apiError) {
      res.status(500).json({
        error: "API call failed",
        userId,
        details: {
          message: apiError.message,
          response: apiError.response?.data || null,
          status: apiError.response?.status || null,
        },
        tokenInfo: {
          obtained: true,
          truncated: token ? `${token.substring(0, 5)}...` : null
        },
        suggestions: [
          "Ensure the ID is a valid Twitch user ID (numeric)",
          "Check that your EXT_CLIENT_ID has proper permissions",
          "Verify your EXT_SECRET is correct"
        ]
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to manually set a username
app.post("/debug/set-username", express.json(), (req, res) => {
  try {
    const { userId, username } = req.body;
    
    if (!userId || !username) {
      return res.status(400).json({ error: "Both userId and username are required" });
    }
    
    // Store in memory
    userIdToUsername[userId] = username;
    
    // Also try to update in database
    Score.findByPk(userId)
      .then(score => {
        if (score) {
          score.username = username;
          return score.save();
        }
      })
      .catch(err => console.error("Database error updating username:", err));
    
    res.json({
      success: true,
      message: `Username for ${userId} set to "${username}"`,
      currentMappings: Object.keys(userIdToUsername).length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      const decoded = jwt.verify(jwt, extSecretBuffer, {
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