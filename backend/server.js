/********************************
 * LOREMASTER TRIVIA - SERVER
 ********************************/

/********************************
 * SECTION 1: CORE SETUP & CONFIGURATION
 ********************************/

require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");
const PORT = process.env.PORT || 5000;

/**
 * Environment Variables Configuration
 */
const EXT_CLIENT_ID = process.env.EXT_CLIENT_ID;
const EXT_OWNER_ID = process.env.EXT_OWNER_ID;
const EXT_SECRET = process.env.EXT_SECRET;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const extSecretBuffer = Buffer.from(EXT_SECRET, 'base64');

// Validate environment variables
function validateEnvironment() {
  const requiredVars = ['EXT_CLIENT_ID', 'EXT_OWNER_ID', 'EXT_SECRET', 'CLIENT_SECRET'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error("❌ ERROR: Missing required environment variables:", missing.join(', '));
    return false;
  }
  return true;
}

// Log environment for debugging
function logEnvironment() {
  console.log("========== ENVIRONMENT VARIABLES DEBUG ==========");
  console.log(`PORT: ${process.env.PORT || "(using default 5000)"}`);
  console.log(`DB_HOST: ${process.env.DB_HOST ? "DEFINED" : "UNDEFINED"}`);
  console.log(`DB_USER: ${process.env.DB_USER ? "DEFINED" : "UNDEFINED"}`);
  console.log(`DB_NAME: ${process.env.DB_NAME ? "DEFINED" : "UNDEFINED"}`);
  console.log(`DB_PASSWORD: ${process.env.DB_PASSWORD ? "DEFINED (length: " + process.env.DB_PASSWORD?.length + ")" : "UNDEFINED"}`);
  console.log(`EXT_CLIENT_ID: ${process.env.EXT_CLIENT_ID ? "DEFINED" : "UNDEFINED"}`);
  console.log(`EXT_SECRET: ${process.env.EXT_SECRET ? "DEFINED" : "UNDEFINED"}`);
  console.log(`CLIENT_SECRET: ${process.env.CLIENT_SECRET ? "DEFINED" : "UNDEFINED"}`);
  console.log(`EXT_OWNER_ID: ${process.env.EXT_OWNER_ID ? "DEFINED" : "UNDEFINED"}`);
  console.log("=================================================");
}

// Check environment validity
if (!validateEnvironment()) {
  process.exit(1);
}

// Log environment for debugging
logEnvironment();

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

/**
 * Database Configuration
 */
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

// Test the database connection immediately
async function testDatabaseConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to the database:');
    console.error(error.message);
    if (error.original) {
      console.error('Original error:', error.original.message);
    }
    console.error('Continuing without database persistence. Scores will be lost on server restart.');
    return false;
  }
}

/**
 * CORS Configuration
 */
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
  maxAge: 86400 // 24 hours cache for preflight requests
};

/**
 * Express App Initialization
 */
const app = express();

// Add proper body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add logging middleware for debugging
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

/**
 * Security Headers
 */
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

/**
 * Frontend Static Files Serving
 */
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

// Define routes for frontend pages
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "viewer.html"));
  console.log("✅ Serving viewer.html from:", frontendPath);
});

app.get("/config", (req, res) => {
  res.sendFile(path.join(frontendPath, "config.html"));
  console.log("✅ Serving config.html from:", frontendPath);
});

app.get("/mobile", (req, res) => {
  res.sendFile(path.join(frontendPath, "mobile.html"));
  console.log("✅ Serving mobile.html from:", frontendPath);
});

app.get("/overlay", (req, res) => {
  res.sendFile(path.join(frontendPath, "overlay.html"));
  console.log("✅ Serving overlay.html from:", frontendPath);
});

/**
 * Start server after Database Check
 */
async function startServer() {
  // Test database connection first
  await testDatabaseConnection();
  
  // Start listening on port
  app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
    console.log(`✅ Access at http://localhost:${PORT}`);
  });
}

// Start server
startServer().catch(err => {
  console.error("❌ Failed to start server:", err);
});

// Global username mappings and state variables (will be moved in later refactoring steps)
const userIdToUsername = {};
const usersScores = {};
const userSessionScores = {};
let triviaActive = false;
let triviaRoundEndTime = 0;
let nextQuestionTime = null;
let questionInProgress = false;
let usedQuestions = [];

/********************************
 * SECTION 2: DATA MODELS
 ********************************/

/**
 * Score Model
 * Tracks user scores and usernames
 */
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
  
  /**
   * TriviaQuestion Model
   * Stores trivia questions and answers
   */
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
  
  /**
   * QuestionCategory Model
   * Stores category information for trivia questions
   */
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
  
  /**
   * TriviaSettings Model
   * Stores broadcaster-specific trivia settings
   */
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
  
  /**
   * Sync models with database
   * Creates tables if they don't exist
   */
  async function syncModels() {
    try {
      await sequelize.sync();
      console.log("✅ Database models synchronized successfully");
      return true;
    } catch (error) {
      console.error("❌ Error synchronizing models:", error.message);
      return false;
    }
  }
  
  // Add model synchronization to server startup
  async function startServer() {
    // Test database connection first
    const dbConnected = await testDatabaseConnection();
    
    // Sync models if database is connected
    if (dbConnected) {
      await syncModels();
    }
    
    // Initialize database structure and repair user IDs
    await initDatabase();
    
    // Start listening on port
    app.listen(PORT, () => {
      console.log(`✅ Server listening on port ${PORT}`);
      console.log(`✅ Access at http://localhost:${PORT}`);
    });
  }
  
  /**
   * Initialize database with structure check and data loading
   */
  async function initDatabase() {
    try {
      // Check database structure
      await debugDatabaseStructure();
      
      // Load initial questions
      await loadInitialQuestions();
      
      // Fix user IDs issue with Twitch API
      await repairUserIds();
    } catch (error) {
      console.error("❌ Initialization error:", error);
    }
  }
  
  /**
   * Debug database structure and add missing columns if needed
   */
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
  
  /********************************
   * SECTION 3: TWITCH API & AUTHENTICATION
   ********************************/
  
  /**
   * Single consistent function for cleaning user IDs
   * Removes 'U' prefix if present
   */
  function cleanUserId(userId) {
    if (!userId) return userId;
    
    // Convert to string if not already
    userId = String(userId);
    
    // Twitch IDs should be numeric - remove any non-numeric prefix
    if (userId.startsWith('U') && /^U\d+$/.test(userId)) {
      return userId.substring(1);
    }
    
    return userId;
  }
  
  /**
   * Get OAuth token from Twitch API
   * @returns {Promise<string|null>} Access token or null if error
   */
  async function getTwitchOAuthToken() {
    try {
      console.log("🔑 Requesting Twitch OAuth token...");
      
      // Check if we have required environment variables
      if (!EXT_CLIENT_ID || !CLIENT_SECRET) {
        console.error("❌ Missing required environment variables for Twitch OAuth");
        console.error(`Client ID exists: ${!!EXT_CLIENT_ID}, Client Secret exists: ${!!CLIENT_SECRET}`);
        return null;
      }
      
      // Create proper form data
      const formData = new URLSearchParams();
      formData.append('client_id', EXT_CLIENT_ID);
      formData.append('client_secret', CLIENT_SECRET);
      formData.append('grant_type', 'client_credentials');
      
      console.log(`🔍 Using Client ID: ${EXT_CLIENT_ID.substring(0, 5)}...`);
      
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
  
  /**
   * Generate JWT token for Twitch PubSub authentication
   * @param {string} specificChannelId - Optional channel ID, defaults to owner ID
   * @returns {string|null} JWT token or null if error
   */
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
  
  /**
   * Broadcast message to Twitch PubSub
   * @param {string} channelId - Channel ID to broadcast to
   * @param {object} message - Message to broadcast
   * @returns {Promise<boolean>} Success status
   */
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
  
  /**
   * Verify Twitch JWT tokens for secured routes
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   */
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
  
  /**
   * Fetch usernames from Twitch API
   * @param {string[]} userIds - Array of user IDs to fetch usernames for
   * @returns {Promise<void>}
   */
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
                'Client-ID': EXT_CLIENT_ID,
                'Authorization': `Bearer ${token}`
              }
            }
          );
          
          if (response.data && response.data.data && response.data.data.length > 0) {
            console.log(`✅ Successfully retrieved ${response.data.data.length} usernames`);
            
            // Update cache with response data
            response.data.data.forEach(user => {
              userIdToUsername[user.id] = user.display_name;
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
  
  /**
   * Fix user IDs issue with Twitch API
   * Repairs problematic IDs by removing 'U' prefix
   */
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
  
  /**
   * Log username statistics
   * Useful for debugging username mappings
   */
  function logUsernameStats() {
    const userCount = Object.keys(userIdToUsername).length;
    console.log(`📊 Current username mappings: ${userCount} users`);
    if (userCount > 0) {
      const sampleEntries = Object.entries(userIdToUsername).slice(0, 3);
      console.log("📊 Sample username mappings:", sampleEntries);
    }
  }
  
  /**
   * Load initial questions to memory (for backward compatibility)
   */
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
  
  /**
   * Load questions from database with optional filters
   */
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
  
  // Global trivia variables (will be refactored later)
  let triviaQuestions = [];
  let triviaSettings = {
    answerTime: 30000,     // Default 30 seconds
    intervalTime: 600000,  // Default 10 minutes
  };
  
/********************************
 * SECTION 4: USER MANAGEMENT
 ********************************/

/**
 * Set username for a user ID
 * Stores in both memory and database
 * @param {string} userId - The user ID to update
 * @param {string} username - The username to set
 * @returns {Promise<boolean>} Success status
 */
async function setUsername(userId, username) {
    if (!userId || !username) {
      console.warn("⚠️ Missing userId or username in setUsername");
      return false;
    }
    
    try {
      // Clean the user ID and store original
      const originalId = userId;
      const cleanId = cleanUserId(userId);
      
      // Store username in memory for both original and cleaned IDs
      userIdToUsername[originalId] = username;
      if (originalId !== cleanId) {
        userIdToUsername[cleanId] = username;
        console.log(`👤 Storing username mapping for both formats: ${originalId} and ${cleanId}`);
      }
      
      console.log(`👤 Setting username for ${userId}: ${username}`);
      
      // Try to update in database (check both ID formats)
      try {
        // Check if record exists with original ID
        const userScoreOriginal = await Score.findByPk(originalId);
        if (userScoreOriginal) {
          userScoreOriginal.username = username;
          await userScoreOriginal.save();
          console.log(`✅ Updated username in database for ${originalId}`);
        }
        
        // Check if record exists with cleaned ID (if different)
        if (originalId !== cleanId) {
          const userScoreClean = await Score.findByPk(cleanId);
          if (userScoreClean) {
            userScoreClean.username = username;
            await userScoreClean.save();
            console.log(`✅ Updated username in database for ${cleanId}`);
          }
        }
      } catch (dbError) {
        console.error("❌ Error updating username in database:", dbError);
        // Continue execution - memory storage successful even if DB fails
      }
      
      return true;
    } catch (error) {
      console.error("❌ Error in setUsername:", error);
      return false;
    }
  }
  
  /**
   * Resolve Twitch username using Helix API
   * Only works when Identity links are enabled
   * @param {string} userId - Twitch user ID
   * @param {string} clientId - Extension client ID
   * @param {string} helixToken - Helix API token
   * @returns {Promise<string|null>} Username or null if not found
   */
  async function resolveTwitchUsername(userId, clientId, helixToken) {
    try {
      if (!userId || !clientId || !helixToken) {
        console.warn("⚠️ Missing required params for Twitch username resolution");
        return null;
      }
      
      // Clean the user ID (remove U prefix if present)
      const cleanId = cleanUserId(userId);
      
      console.log(`🔍 Resolving Twitch username for ID: ${cleanId} using Helix API`);
      
      // Call Twitch Helix API
      const response = await axios.get(`https://api.twitch.tv/helix/users?id=${cleanId}`, {
        headers: {
          "Client-Id": clientId,
          "Authorization": `Extension ${helixToken}`
        }
      });
      
      if (response.data && response.data.data && response.data.data.length > 0) {
        const displayName = response.data.data[0].display_name;
        console.log(`✅ Resolved Twitch username: ${displayName} for ID ${cleanId}`);
        
        // Save to memory and database using existing function
        await setUsername(userId, displayName);
        
        return displayName;
      } else {
        console.warn(`⚠️ No Twitch user found for ID ${cleanId} with Helix API`);
        return null;
      }
    } catch (error) {
      console.error(`❌ Error resolving Twitch username:`, error.response?.data || error.message);
      return null;
    }
  }
  
  /**
   * Get username for a user ID
   * @param {string} userId - The user ID to lookup
   * @returns {string} Username or placeholder
   */
  function getUsername(userId) {
    if (!userId) return "Unknown User";
    
    // First check original format
    if (userIdToUsername[userId]) {
      return userIdToUsername[userId];
    }
    
    // Then try cleaned format
    const cleanId = cleanUserId(userId);
    if (cleanId !== userId && userIdToUsername[cleanId]) {
      return userIdToUsername[cleanId];
    }
    
    // Return placeholder if not found
    return `User-${userId.substring(0, 5)}...`;
  }
  
  /**
   * Update or create user score
   * @param {string} userId - The user's Twitch ID
   * @param {number} points - Points to add
   * @param {string} username - Optional username to update
   * @returns {Promise<{totalScore: number, sessionScore: number}>} Updated scores
   */
  async function updateUserScore(userId, points, username = null) {
    if (!userId) {
      console.warn("⚠️ Missing userId in updateUserScore");
      return { totalScore: 0, sessionScore: 0 };
    }
    
    try {
      // Clean ID for consistency
      const cleanId = cleanUserId(userId);
      const originalId = userId;
      
      console.log(`🔍 Processing score update for user ${cleanId} with username: ${username || 'NOT PROVIDED'}`);
      
      // First check if we already have a username for this user in memory
      let effectiveUsername = username;
      
      // If no username provided in this request, try to find existing one
      if (!effectiveUsername) {
        // Check memory cache first (for both ID formats)
        if (userIdToUsername[originalId]) {
          effectiveUsername = userIdToUsername[originalId];
          console.log(`📋 Using existing username from memory for ${originalId}: ${effectiveUsername}`);
        } else if (userIdToUsername[cleanId]) {
          effectiveUsername = userIdToUsername[cleanId];
          console.log(`📋 Using existing username from memory for ${cleanId}: ${effectiveUsername}`);
        } else {
          // Try database as a last resort
          try {
            const existingUser = await Score.findOne({
              where: {
                userId: {
                  [Sequelize.Op.or]: [cleanId, originalId]
                }
              }
            });
            
            if (existingUser && existingUser.username) {
              effectiveUsername = existingUser.username;
              console.log(`📋 Retrieved username from database: ${effectiveUsername}`);
              
              // Store in memory for future use
              userIdToUsername[cleanId] = effectiveUsername;
              if (originalId !== cleanId) {
                userIdToUsername[originalId] = effectiveUsername;
              }
            }
          } catch (dbLookupError) {
            console.error("❌ Error looking up username in database:", dbLookupError);
          }
        }
      }
      
      // Update username if we have one (either from request or from lookup)
      if (effectiveUsername) {
        await setUsername(cleanId, effectiveUsername);
        
        // If it's a generated username like "User-U7036", don't actually use it
        if (effectiveUsername.startsWith("User-") && /User-U\d+/.test(effectiveUsername)) {
          console.warn(`⚠️ Not storing auto-generated username format: ${effectiveUsername}`);
          effectiveUsername = null; // Don't use auto-generated usernames
        }
      }
      
      // Rest of the function remains the same...
      
      // Track total score in memory (for backup)
      if (!usersScores[cleanId]) usersScores[cleanId] = 0;
      usersScores[cleanId] += points;
      
      // Track session score separately
      if (!userSessionScores[cleanId]) userSessionScores[cleanId] = 0;
      userSessionScores[cleanId] += points;
      
      // Get current scores for return
      const memoryTotalScore = usersScores[cleanId];
      const sessionScore = userSessionScores[cleanId];
      let databaseTotalScore = memoryTotalScore;
      
      // Update database if possible
      try {
        // Find or create score record
        const [userScore, created] = await Score.findOrCreate({
          where: { userId: cleanId },
          defaults: {
            userId: cleanId,
            username: effectiveUsername || null, // Use our carefully determined username
            score: points,
            lastUpdated: new Date()
          }
        });
        
        // If record exists, update it
        if (!created) {
          userScore.score += points;
          userScore.lastUpdated = new Date();
          
          // Update username if provided and record doesn't already have one
          if (effectiveUsername && (!userScore.username || userScore.username.startsWith("User-"))) {
            console.log(`✏️ Updating database username to: ${effectiveUsername}`);
            userScore.username = effectiveUsername;
          }
          
          await userScore.save();
          databaseTotalScore = userScore.score;
        }
        
        console.log(`🏆 ${created ? "Created" : "Updated"} score in database for ${cleanId}: ${databaseTotalScore}`);
      } catch (dbError) {
        console.error("❌ Database error in updateUserScore:", dbError);
        // Continue with memory scores on database error
      }
      
      console.log(`🏆 User ${cleanId} earned ${points} points! Total: ${databaseTotalScore}, Session: ${sessionScore}`);
      return { totalScore: databaseTotalScore, sessionScore };
    } catch (error) {
      console.error("❌ Error in updateUserScore:", error);
      return { totalScore: 0, sessionScore: 0 };
    }
}
  
  /**
   * Process identity-linked username from Twitch
   * Call this when receiving Twitch JWT with identity link
   * @param {string} userId - The user ID from JWT
   * @param {string} identityId - The user's actual Twitch ID (if linked)
   * @param {string} clientId - Client ID of extension
   * @param {string} helixToken - Twitch Helix token 
   * @returns {Promise<boolean>} Success status
   */
  async function processIdentityLinkedUser(userId, identityId, clientId, helixToken) {
    if (!userId || !identityId) {
      console.warn("⚠️ Missing identity information");
      return false;
    }
    
    try {
      console.log(`👤 Processing identity-linked user: ${userId} (Twitch ID: ${identityId})`);
      
      // Try to get username using Helix API
      const displayName = await resolveTwitchUsername(identityId, clientId, helixToken);
      
      if (displayName) {
        // Also set username for the opaque user ID (JWT userId) if different
        if (userId !== identityId) {
          await setUsername(userId, displayName);
        }
        
        return true;
      } else {
        console.warn(`⚠️ Could not get display name for identity-linked user ${identityId}`);
        return false;
      }
    } catch (error) {
      console.error("❌ Error processing identity-linked user:", error);
      return false;
    }
  }
  
  /**
   * Get user score
   * @param {string} userId - The user's Twitch ID
   * @returns {Promise<{totalScore: number, sessionScore: number}>} User scores
   */
  async function getUserScore(userId) {
    if (!userId) {
      return { totalScore: 0, sessionScore: 0 };
    }
    
    try {
      const cleanId = cleanUserId(userId);
      
      // Get session score from memory
      const sessionScore = userSessionScores[cleanId] || 0;
      
      // Try to get total score from database
      try {
        const userScore = await Score.findByPk(cleanId);
        
        if (userScore) {
          console.log(`📊 Retrieved score from DB for ${cleanId}: Total=${userScore.score}, Session=${sessionScore}`);
          return { 
            totalScore: userScore.score,
            sessionScore,
            lastUpdated: userScore.lastUpdated
          };
        }
      } catch (dbError) {
        console.error(`❌ Error retrieving score from database for ${cleanId}:`, dbError);
        // Fall back to memory score
      }
      
      // Use memory score if database retrieval fails
      const totalScore = usersScores[cleanId] || 0;
      console.log(`📊 Using memory score for ${cleanId}: Total=${totalScore}, Session=${sessionScore}`);
      
      return { totalScore, sessionScore };
    } catch (error) {
      console.error(`❌ Error in getUserScore for ${userId}:`, error);
      return { totalScore: 0, sessionScore: 0 };
    }
  }
  
  /**
   * Reset all session scores
   * Useful when ending trivia session
   */
  function resetSessionScores() {
    console.log("🔄 Resetting all session scores");
    
    // Clear all session scores
    Object.keys(userSessionScores).forEach(key => {
      userSessionScores[key] = 0;
    });
  }
  
  /**
   * Calculate score based on answer, difficulty and timing
   * @param {boolean} isCorrect - Whether the answer is correct
   * @param {string} difficulty - Question difficulty (Easy, Medium, Hard)
   * @param {number} answerTime - Time taken to answer in ms
   * @param {number} totalTime - Total time allowed for question in ms
   * @returns {{points: number, timePercentage: number, basePoints: number}} Score calculation results
   */
  function calculateScore(isCorrect, difficulty, answerTime, totalTime) {
    // Base points by difficulty
    const basePoints = 
      difficulty === 'Easy' ? 500 :
      difficulty === 'Hard' ? 1500 :
      1000; // Medium or default
    
    // No points for incorrect answers
    if (!isCorrect) {
      return { points: 0, timePercentage: 0, basePoints };
    }
    
    // Calculate time bonus (0.1 to 1.0)
    const timePercentage = Math.min(1, answerTime / totalTime);
    const timeBonus = Math.max(0.1, 1 - timePercentage); // At least 10%
    
    // Calculate final points
    const points = Math.round(basePoints * timeBonus);
    
    console.log(`🎯 Score calculation: Difficulty=${difficulty}, Base=${basePoints}, Time=${answerTime}/${totalTime}, Bonus=${Math.round(timeBonus * 100)}%, Final=${points}`);
    
    return { 
      points, 
      timePercentage: Math.round(timeBonus * 100),
      basePoints
    };
  }
  
  /********************************
   * SECTION 5: TRIVIA GAME LOGIC
   ********************************/
  
  /**
   * Helper: Shuffle Array
   * @param {Array} array - The array to shuffle
   * @returns {Array} Shuffled array
   */
  function shuffleArray(array) {
    const arrayCopy = [...array]; // Create a copy to avoid modifying original
    for (let i = arrayCopy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arrayCopy[i], arrayCopy[j]] = [arrayCopy[j], arrayCopy[i]];
    }
    return arrayCopy;
  }
  
  /**
   * Get broadcaster's question filters
   * @param {string} broadcasterId - The broadcaster's Twitch ID
   * @returns {Promise<{categories: string[], difficulties: string[]}>} Filter settings
   */
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
  
  /**
   * Get a random trivia question from database
   * @param {string[]} categories - Optional category filter
   * @param {string[]} difficulties - Optional difficulty filter
   * @returns {Promise<Object|null>} Question object or null if none found
   */
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
      
      // Add exclusion for already used questions if any exist
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
      
      // Add this question ID to used questions array
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
  
  /**
   * Start trivia game
   * @param {string} channelId - Broadcaster's channel ID
   * @returns {Promise<boolean>} Success status
   */
  async function startTrivia(channelId) {
    if (triviaActive) {
      console.log("⚠️ Trivia is already running. Ignoring start request.");
      return false;
    }
  
    try {
      // Set triviaActive first to prevent race conditions
      triviaActive = true;
  
      // Reset questions tracking
      usedQuestions = [];
      console.log("🔄 Used questions list reset upon trivia start");
  
      // Broadcast trivia start event
      const startMessage = { 
        type: "TRIVIA_START",
        intervalTime: triviaSettings.intervalTime
      };
      
      const broadcastSuccess = await broadcastToTwitch(channelId, startMessage);
      
      if (!broadcastSuccess) {
        console.error("❌ Failed to broadcast TRIVIA_START");
        triviaActive = false;
        return false;
      }
  
      console.log("🚀 TRIVIA_START event broadcasted!");
  
      // Set next question time
      const intervalTime = triviaSettings?.intervalTime || 600000;
      nextQuestionTime = Date.now() + intervalTime;
  
      console.log(`⏳ First trivia question will be in ${Math.round((nextQuestionTime - Date.now()) / 1000)} seconds.`);
      return true;
    } catch (error) {
      console.error("❌ Error starting trivia:", error);
      // Reset trivia state if it fails to start
      triviaActive = false;
      return false;
    }
  }
  
  /**
   * End trivia game
   * @param {string} channelId - Broadcaster's channel ID
   * @returns {Promise<boolean>} Success status
   */
  async function endTrivia(channelId) {
    console.log("🛑 Ending trivia session");
  
    triviaActive = false;
    triviaRoundEndTime = 0;
    nextQuestionTime = null;
    
    // Clear used questions when trivia ends
    usedQuestions = [];
    console.log("🔄 Used questions list cleared upon trivia end");
  
    // Reset session scores
    resetSessionScores();
  
    // Broadcast end event
    try {
      const endMessage = { type: "TRIVIA_END" };
      const broadcastSuccess = await broadcastToTwitch(channelId, endMessage);
      
      if (!broadcastSuccess) {
        console.error("❌ Failed to broadcast TRIVIA_END");
        return false;
      }
      
      console.log("⛔ Trivia end command broadcasted!");
      console.log("🔴 Trivia is now INACTIVE. Waiting for Start command.");
      return true;
    } catch (error) {
      console.error("❌ Error ending trivia:", error);
      return false;
    }
  }
  
  /**
   * Send trivia question to channel
   * @param {string} channelId - Channel ID to send question to
   * @returns {Promise<boolean>} Success status
   */
  async function sendTriviaQuestion(channelId) {
    if (!triviaActive) {
      console.log("⏳ Trivia is inactive. Waiting for Start command.");
      return false;
    }
  
    if (questionInProgress) {
      console.warn("⚠️ A question is already in progress! Skipping duplicate question.");
      return false;
    }
  
    try {
      // Mark that a question is in progress
      questionInProgress = true;
      
      console.log("🧠 Selecting a trivia question from the database...");
      
      // Get broadcaster's filter preferences
      const filters = await getBroadcasterFilters(channelId);
      
      // Get a random question using filters
      let questionObj = await getRandomQuestionFromDB(filters.categories, filters.difficulties);
      
      // If no question matches filters, try without filters
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
          return false;
        }
      }
      
      // Shuffle the choices
      const shuffledChoices = shuffleArray([...questionObj.choices]);
  
      // Get timing settings with fallbacks
      const answerTime = triviaSettings?.answerTime || 30000; // Default 30s
      const intervalTime = triviaSettings?.intervalTime || 600000; // Default 10 min
  
      console.log(`⏳ Current trivia settings → Answer Time: ${answerTime}ms, Interval: ${intervalTime}ms`);
      console.log(`📝 Selected question: "${questionObj.question.substring(0, 50)}..." (ID: ${questionObj.id}, Category: ${questionObj.categoryId}, Difficulty: ${questionObj.difficulty})`);
  
      // Prepare question message
      const questionMessage = {
        type: "TRIVIA_QUESTION",
        question: questionObj.question,
        choices: shuffledChoices,
        correctAnswer: questionObj.correctAnswer,
        duration: answerTime,
        categoryId: questionObj.categoryId,
        difficulty: questionObj.difficulty,
        questionId: questionObj.id
      };
      
      console.log("📡 Broadcasting trivia question...");
  
      // Broadcast the question
      const broadcastSuccess = await broadcastToTwitch(channelId, questionMessage);
      
      if (!broadcastSuccess) {
        console.error("❌ Failed to broadcast question");
        questionInProgress = false;
        return false;
      }
  
      console.log(`✅ Trivia question sent to channel ${channelId}`);
  
      // Set round end time and schedule the next question
      triviaRoundEndTime = Date.now() + answerTime + 5000; // Extra 5s buffer
  
      // Schedule reset of question status and next question timing
      setTimeout(() => {
        questionInProgress = false;
        nextQuestionTime = Date.now() + intervalTime; 
        console.log(`⏳ Next trivia question in: ${intervalTime / 1000} seconds`);
      }, answerTime + 5000);
      
      return true;
    } catch (error) {
      console.error("❌ Error sending trivia question:", error.response?.data || error.message);
      questionInProgress = false; // Always reset the flag on error
      return false;
    }
  }
  
  /**
   * Update trivia settings
   * @param {Object} settings - New settings values
   * @param {number} settings.answerTime - Time in ms for answering questions
   * @param {number} settings.intervalTime - Time in ms between questions
   * @returns {Promise<boolean>} Success status
   */
  async function updateTriviaSettings(settings) {
    try {
      const { answerTime, intervalTime } = settings;
      
      // Validate input values
      if (
        typeof answerTime !== "number" ||
        typeof intervalTime !== "number" ||
        answerTime < 5000 || answerTime > 60000 ||  
        intervalTime < 60000 || intervalTime > 1800000  
      ) {
        console.error("❌ Invalid time values:", { answerTime, intervalTime });
        return false;
      }
      
      // Update settings
      triviaSettings.answerTime = answerTime;
      triviaSettings.intervalTime = intervalTime;
      console.log("🔧 Trivia settings updated:", triviaSettings);
      
      // Broadcast settings to viewers
      await sendSettingsUpdate();
      
      return true;
    } catch (error) {
      console.error("❌ Error updating trivia settings:", error);
      return false;
    }
  }
  
  /**
   * Broadcast settings update to viewers
   * @returns {Promise<boolean>} Success status
   */
  async function sendSettingsUpdate() {
    try {
      const settingsMessage = {
        type: "SETTINGS_UPDATE",
        answerTime: triviaSettings.answerTime,
        intervalTime: triviaSettings.intervalTime,
      };
      
      const broadcastSuccess = await broadcastToTwitch(EXT_OWNER_ID, settingsMessage);
      
      if (broadcastSuccess) {
        console.log("✅ Trivia settings broadcasted to viewers");
        return true;
      } else {
        console.error("❌ Failed to broadcast settings update");
        return false;
      }
    } catch (error) {
      console.error("❌ Error broadcasting trivia settings:", error);
      return false;
    }
  }
  
  /**
   * Send countdown update to viewers
   * Informs viewers of time remaining until next question
   * @returns {Promise<boolean>} Success status
   */
  async function sendCountdownUpdate() {
    // Don't send updates if trivia is inactive or during an active question
    if (!triviaActive || Date.now() < triviaRoundEndTime) {
      return false;
    }
  
    // If nextQuestionTime isn't set or has passed, don't send updates
    if (!nextQuestionTime || nextQuestionTime < Date.now()) {
      return false;
    }
  
    const timeRemaining = nextQuestionTime - Date.now();
    
    try {
      const countdownMessage = {
        type: "COUNTDOWN_UPDATE",
        timeRemaining: Math.max(0, timeRemaining),
      };
  
      const broadcastSuccess = await broadcastToTwitch(EXT_OWNER_ID, countdownMessage);
      return broadcastSuccess;
    } catch (error) {
      console.error("❌ Error sending countdown update:", error.message || error);
      return false;
    }
  }
  
  /**
   * Main countdown and question timing interval
   * Handles timing of questions and countdowns
   */
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
  
    // Update countdown UI
    sendCountdownUpdate();
  
    // When time runs out, request the next question
    if (timeRemaining <= 0 && !questionInProgress) {
      console.log("⏳ Countdown reached 0! Sending trivia question...");
      sendTriviaQuestion(EXT_OWNER_ID);
    }
  }, 1000); // Runs once per second
  
 /********************************
 * SECTION 6: API ROUTES
 ********************************/

/**
 * API Routes for Trivia Application
 * All HTTP endpoints are defined here
 */

/**
 * User Score Endpoints
 */

// Submit answer and update score
app.post("/submit-answer", async (req, res) => {
    try {
      // Input validation with early returns for invalid data
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Empty request body" });
      }
      
      const { userId: rawUserId, selectedAnswer, correctAnswer, answerTime, 
              difficulty = 'Medium', duration = triviaSettings.answerTime || 30000, 
              username } = req.body;
      
      // Ensure userId is a clean string
      const userId = rawUserId ? String(rawUserId).trim() : null;
      
      // Validate required fields
      if (!userId || !selectedAnswer || !correctAnswer || answerTime === undefined) {
        return res.status(400).json({ 
          error: "Missing required fields",
          missing: {
            userId: !userId,
            selectedAnswer: !selectedAnswer,
            correctAnswer: !correctAnswer,
            answerTime: answerTime === undefined
          }
        });
      }
  
      // Determine if answer is correct and calculate score
      const isCorrect = selectedAnswer === correctAnswer;
      const { points, timePercentage, basePoints } = calculateScore(
        isCorrect, 
        difficulty, 
        answerTime, 
        duration
      );
  
      // Update user score in memory and database
      const { totalScore, sessionScore } = await updateUserScore(userId, points, username);
  
      // Log the result
      if (isCorrect) {
        console.log(`✅ User ${userId} answered correctly and earned ${points} points!`);
      } else {
        console.log(`❌ User ${userId} answered incorrectly: ${selectedAnswer} (correct: ${correctAnswer})`);
      }
  
      // Return success response with score information
      res.json({ 
        success: true, 
        pointsEarned: points, 
        totalScore,
        sessionScore,
        basePoints,
        difficulty,
        timePercentage
      });
    } catch (error) {
      console.error("❌ Error in submit-answer endpoint:", error);
      res.status(500).json({ error: "Server error" });
    }
  });
  
  // Get user score
  app.get("/score/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      
      if (!userId) {
        return res.status(400).json({ error: "Missing userId parameter" });
      }
      
      // Get user score from memory and database
      const scoreData = await getUserScore(userId);
      
      // Return score information
      res.json({ 
        userId, 
        ...scoreData
      });
    } catch (error) {
      console.error(`❌ Error retrieving score for ${req.params.userId}:`, error);
      
      // Send a response even on error
      res.json({ 
        userId: req.params.userId, 
        totalScore: 0, 
        sessionScore: 0,
        error: "Failed to retrieve score"
      });
    }
  });
  
  // Reset session scores
  app.post("/reset-session-scores", (req, res) => {
    try {
      resetSessionScores();
      res.json({ success: true, message: "Session scores reset" });
    } catch (error) {
      console.error("❌ Error resetting session scores:", error);
      res.status(500).json({ error: "Failed to reset session scores" });
    }
  });
  
  /**
   * Leaderboard Endpoints
   */
  
  // Get leaderboard data
  app.get("/api/leaderboard", async (req, res) => {
    try {
      // Get top scores from database
      const dbScores = await Score.findAll({
        order: [['score', 'DESC']],
        limit: 20
      });
      
      // Extract all unique user IDs we need usernames for
      const allUserIds = Array.from(new Set([
        ...dbScores.map(entry => entry.userId),
        ...Object.keys(userSessionScores)
      ]));
      
      // Try to fetch any missing usernames from Twitch API
      const missingIds = allUserIds.filter(id => !userIdToUsername[id] && !userIdToUsername[cleanUserId(id)]);
      
      if (missingIds.length > 0) {
        await fetchUsernames(missingIds);
      }
      
      // Create total leaderboard with usernames
      const totalLeaderboard = dbScores.map(entry => ({
        userId: entry.userId,
        username: getUsername(entry.userId),
        score: entry.score
      }));
      
      // Create session leaderboard with usernames
      const sessionScores = Object.entries(userSessionScores)
        .map(([userId, score]) => ({
          userId,
          username: getUsername(userId),
          score
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      
      // Log samples of what we're returning
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
  
  /**
   * Username Management Endpoints
   */
  
  // Set username for a user
  app.post("/api/set-username", async (req, res) => {
    try {
      const { userId, username } = req.body;
      
      if (!userId || !username) {
        return res.status(400).json({ 
          success: false,
          error: "Missing userId or username" 
        });
      }
      
      // Set username in memory and database
      const success = await setUsername(userId, username);
      
      // Log username stats
      const userCount = Object.keys(userIdToUsername).length;
      
      // Return success
      res.json({ 
        success, 
        message: success ? "Username set successfully" : "Failed to set username",
        currentMappings: userCount
      });
    } catch (error) {
      console.error("❌ Error setting username:", error);
      res.status(500).json({ 
        success: false, 
        error: "Server error" 
      });
    }
  });
  
  // Extension identity endpoint
  app.post("/extension-identity", async (req, res) => {
    try {
      const { userId, username, identityId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }
      
      // Store username if provided directly
      if (username) {
        console.log(`👤 Received extension identity: User ${userId} is "${username}"`);
        await setUsername(userId, username);
      }
      // If identity ID is provided but no username, try to resolve it
      else if (identityId) {
        console.log(`👤 Attempting to resolve username for identity: ${identityId}`);
        // Try to get Twitch OAuth token
        const token = await getTwitchOAuthToken();
        if (token) {
          await processIdentityLinkedUser(userId, identityId, EXT_CLIENT_ID, token);
        }
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("❌ Error in extension-identity endpoint:", error);
      res.status(500).json({ error: "Server error" });
    }
  });
  
  /**
   * Trivia Control Endpoints
   */
  
  // Start trivia
  app.post("/start-trivia", async (req, res) => {
    try {
      if (triviaActive) {
        console.log("⚠️ Trivia is already running. Ignoring start request.");
        return res.json({ success: false, message: "Trivia is already running!" });
      }
  
      const broadcasterId = req.body.broadcasterId || EXT_OWNER_ID;
      const success = await startTrivia(broadcasterId);
      
      if (success) {
        res.json({ success: true, message: "Trivia started!" });
      } else {
        res.status(500).json({ success: false, error: "Failed to start trivia." });
      }
    } catch (error) {
      console.error("❌ Error starting trivia:", error);
      triviaActive = false; // Reset state on error
      res.status(500).json({ success: false, error: "Failed to start trivia." });
    }
  });
  
  // End trivia
  app.post("/end-trivia", async (req, res) => {
    try {
      const broadcasterId = req.body.broadcasterId || EXT_OWNER_ID;
      const success = await endTrivia(broadcasterId);
      
      if (success) {
        res.json({ success: true, message: "Trivia ended!" });
      } else {
        res.status(500).json({ error: "Failed to end trivia." });
      }
    } catch (error) {
      console.error("❌ Error ending trivia:", error);
      res.status(500).json({ error: "Failed to end trivia." });
    }
  });
  
  // Get next question
  app.get("/get-next-question", async (req, res) => {
    try {
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
  
  // Manual route to send a trivia question
  app.post("/send-test", async (req, res) => {
    try {
      const broadcasterId = req.body.broadcasterId || EXT_OWNER_ID;
      const success = await sendTriviaQuestion(broadcasterId);
      
      if (success) {
        res.json({ success: true, message: "Trivia question sent!" });
      } else {
        res.status(500).json({ success: false, error: "Failed to send question" });
      }
    } catch (error) {
      console.error("❌ Error in /send-test:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // GET endpoint for testing trivia
  app.get("/trivia", async (req, res) => {
    try {
      const success = await sendTriviaQuestion(EXT_OWNER_ID);
      
      if (success) {
        res.json({ success: true, message: "Trivia question sent via GET /trivia" });
      } else {
        res.status(500).json({ success: false, error: "Failed to send question" });
      }
    } catch (error) {
      console.error("❌ Error in GET /trivia:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  /**
   * Settings Management Endpoints
   */
  
  // Update trivia settings
  app.post("/update-settings", async (req, res) => {
    try {
      // Log the raw request body
      console.log("📩 Received settings update request.");
      console.log("📦 Raw request body:", req.body);
  
      let { answerTime, intervalTime } = req.body;
  
      // If body is empty, return error
      if (!req.body || Object.keys(req.body).length === 0) {
        console.error("❌ Invalid settings update request: Empty body received!");
        return res.status(400).json({ error: "Empty request body!" });
      }
  
      // Fallback check in case Twitch sends incorrect keys
      if (!answerTime && req.body.answerDuration) {
        answerTime = req.body.answerDuration * 1000;
      }
      if (!intervalTime && req.body.questionInterval) {
        intervalTime = req.body.questionInterval * 60000;
      }
  
      console.log("🔍 Parsed values:", { answerTime, intervalTime });
  
      // Update settings
      const success = await updateTriviaSettings({ answerTime, intervalTime });
      
      if (success) {
        res.json({ success: true, settings: triviaSettings });
      } else {
        res.status(400).json({ error: "Invalid time values" });
      }
    } catch (error) {
      console.error("❌ Error updating settings:", error);
      res.status(500).json({ error: "Server error" });
    }
  });
  
  // Get broadcaster settings
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
  
  // Update broadcaster settings
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
      
      // Get count of questions matching these filters
      const whereClause = {};
      if (activeCategories?.length > 0) {
        whereClause.category_id = activeCategories;
      }
      if (activeDifficulties?.length > 0) {
        whereClause.difficulty = activeDifficulties;
      }
      
      const count = await TriviaQuestion.count({ where: whereClause });
      
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
  
  /**
   * Categories and Difficulties Endpoints
   */
  
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
  
  /**
   * CSV Upload Route
   */
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
  
  /**
   * Export Scores Endpoint
   */
  app.get("/export-scores", async (req, res) => {
    try {
      const jwtToken = req.query.jwt;
      
      // Validate JWT if provided
      if (jwtToken) {
        try {
          jwt.verify(jwtToken, extSecretBuffer, { algorithms: ['HS256'] });
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
      let csvContent = "User ID,Username,Score,Last Updated\n";
      
      // Add database scores
      allScores.forEach(record => {
        const username = record.username || `User-${record.userId.substring(0, 5)}...`;
        csvContent += `${record.userId},${username},${record.score},${record.lastUpdated}\n`;
      });
  
      // Add any scores that might only exist in memory
      for (const [userId, score] of Object.entries(usersScores)) {
        // Skip if already in database results
        if (allScores.some(record => record.userId === userId)) continue;
        
        const username = getUsername(userId);
        csvContent += `${userId},${username},${score},memory-only\n`;
      }
  
      res.setHeader("Content-Disposition", "attachment; filename=loremaster_scores.csv");
      res.setHeader("Content-Type", "text/csv");
      res.send(csvContent);
    } catch (error) {
      console.error("❌ Error exporting scores from database:", error);
      
      // Fallback to memory-only export
      let csvContent = "User ID,Username,Score,Source\n";
      Object.entries(usersScores).forEach(([userId, score]) => {
        const username = getUsername(userId);
        csvContent += `${userId},${username},${score},memory-fallback\n`;
      });
      
      res.setHeader("Content-Disposition", "attachment; filename=loremaster_scores_fallback.csv");
      res.setHeader("Content-Type", "text/csv");
      res.send(csvContent);
    }
  });
  
  /**
   * Twitch Message Handler Endpoint
   */
  app.post("/twitch/message", express.json(), async (req, res) => {
    try {
      const { channelId, message } = req.body;
      
      if (!channelId || !message || !message.type) {
        return res.status(400).json({ error: "Invalid request parameters" });
      }
      
      console.log(`📩 Received Twitch message: ${message.type} for channel ${channelId}`);
      
      switch (message.type) {
        // Categories handling
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
                
        // Difficulties handling
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
          
        // Broadcaster settings handling
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
          
        // Question stats handling
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
          
        // Save filters handling
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
          
        // Settings update handling
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
          
          // Update settings
          const settingsUpdateSuccess = await updateTriviaSettings({
            answerTime, 
            intervalTime
          });
          
          if (!settingsUpdateSuccess) {
            return res.status(400).json({ error: "Failed to update settings" });
          }
          break;
          
        // Start trivia handling
        case "START_TRIVIA":
          // Only start if not already running
          if (triviaActive) {
            console.log("⚠️ Trivia is already running. Ignoring start request.");
            return res.json({ success: false, message: "Trivia is already running!" });
          }
          
          // Start trivia
          await startTrivia(channelId);
          break;
          
        // End trivia handling
        case "END_TRIVIA":
          // End trivia
          await endTrivia(channelId);
          break;
          
        // Unknown message type
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
  
  /**
   * Debug Endpoints
   */
  
  // Debug: Check user IDs
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
  
  // Debug: Test Twitch API
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
            'Client-ID': EXT_CLIENT_ID,
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
  
  // Debug: Set username manually
  app.post("/debug/set-username", express.json(), async (req, res) => {
    try {
      const { userId, username } = req.body;
      
      if (!userId || !username) {
        return res.status(400).json({ error: "Both userId and username are required" });
      }
      
      // Set username
      const success = await setUsername(userId, username);
      
      res.json({
        success,
        message: success ? `Username for ${userId} set to "${username}"` : "Failed to set username",
        currentMappings: Object.keys(userIdToUsername).length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  /**
   * Proxy Endpoints for Extension
   */
  
  // Regular proxy endpoint
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
  
  // Secure proxy endpoint (JWT authenticated)
  app.post('/ext-secure-proxy', verifyTwitchJWT, (req, res) => {
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
  
  // Final catch-all route for 404s
  app.use((req, res) => {
    res.status(404).json({ error: "Not Found", path: req.path });
  });
  
  console.log("✅ All routes registered successfully");