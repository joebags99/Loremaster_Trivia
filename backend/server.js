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
const { Sequelize, DataTypes } = require('sequelize');
const PORT = process.env.PORT || 5000; // default port

// Global state variables
const usersScores = {}; // Stores scores { "twitchUserID": score }
let triviaActive = false; // ✅ Trivia is inactive until manually started
let triviaRoundEndTime = 0; // Prevents countdown updates during an active trivia round
let nextQuestionTime = null; // ✅ Prevents unnecessary calls to /get-next-question on startup
let questionInProgress = false; // ✅ Prevents multiple questions at once
let usedQuestions = []; // Avoiding Repeat Questions

// Database connection setup
const sequelize = new Sequelize(
  process.env.DB_NAME || 'trivia',
  process.env.DB_USER || 'root', 
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    dialect: 'mysql'
  }
);

// Initialize database
async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to MySQL');
    await sequelize.sync();
    console.log('✅ Tables synchronized');
  } catch (error) {
    console.error('❌ Database connection error:', error);
  }
}

// Define Score model
const Score = sequelize.define('Score', {
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  score: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastUpdated: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

// Initialize Express app
const app = express();
app.use(express.static(path.join(__dirname, "frontend"))); // Serve frontend via Express
app.use(cors());
app.use(express.json());

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

// ✅ IMPROVED: Send Trivia Question
async function sendTriviaQuestion(channelId) {
  if (!triviaActive) {
      console.log("⏳ Trivia is inactive. Waiting for Start command.");
      return;
  }

  if (triviaQuestions.length === 0) {
      console.error("❌ No trivia questions available!");
      return;
  }

  if (questionInProgress) {
      console.warn("⚠️ A question is already in progress! Skipping duplicate question.");
      return;
  }

  try {
      // Mark that a question is in progress
      questionInProgress = true;
      
      console.log("🧠 Selecting a trivia question...");
      const questionObj = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
      
      // Ensure we have valid question data
      if (!questionObj || !questionObj.question || !questionObj.choices || !questionObj.correctAnswer) {
          console.error("❌ Invalid question object:", questionObj);
          questionInProgress = false; // Reset flag on error
          return;
      }
      
      const shuffledChoices = shuffleArray([...questionObj.choices]);

      // Get timing settings with fallbacks
      const answerTime = triviaSettings?.answerTime || 30000; // Default 30s
      const intervalTime = triviaSettings?.intervalTime || 600000; // Default 10 min

      console.log(`⏳ Current trivia settings → Answer Time: ${answerTime}ms, Interval: ${intervalTime}ms`);

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
          }),
      };

      console.log("📡 Broadcasting trivia:", pubsubPayload.message);

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

// ✅ Handle User Answer Submission
app.post("/submit-answer", async (req, res) => {
  try {
    const { userId, selectedAnswer, correctAnswer, answerTime } = req.body;

    if (!userId || !selectedAnswer || !correctAnswer || answerTime === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Calculate score based on answer time
    let points = 0;
    if (selectedAnswer === correctAnswer) {
      if (answerTime <= 3000) {
        points = 1500;
      } else if (answerTime >= 25000) {
        points = 500;
      } else {
        points = Math.max(500, Math.round(1500 - ((answerTime - 3000) / 22)));
      }
    }

    // Find or create user score record
    let [userScore, created] = await Score.findOrCreate({
      where: { userId },
      defaults: { score: 0 }
    });
    
    // Update score
    userScore.score += points;
    userScore.lastUpdated = new Date();
    await userScore.save();
    
    // Update in-memory cache
    usersScores[userId] = userScore.score;

    console.log(`🏆 User ${userId} earned ${points} points! Total: ${userScore.score}`);
    res.json({ success: true, pointsEarned: points, totalScore: userScore.score });
  } catch (error) {
    console.error("❌ Error submitting answer:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Retrieve Player Score
app.get("/score/:userId", (req, res) => {
  const { userId } = req.params;
  const score = usersScores[userId] || 0;
  res.json({ userId, score });
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

// ✅ Export Scores as CSV
app.get("/export-scores", (req, res) => {
  let csvContent = "User ID,Score\n";
  Object.entries(usersScores).forEach(([userId, score]) => {
    csvContent += `${userId},${score}\n`;
  });

  res.setHeader("Content-Disposition", "attachment; filename=scores.csv");
  res.setHeader("Content-Type", "text/csv");
  res.send(csvContent);
});

// ✅ IMPROVED: End Trivia Immediately
app.post("/end-trivia", (req, res) => {
  console.log("🛑 Trivia manually ended!");

  triviaActive = false;
  triviaRoundEndTime = 0;
  nextQuestionTime = null;

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

// ✅ IMPROVED: Get-Next-Question Endpoint
app.get("/get-next-question", (req, res) => {
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

  // Check if questions are available
  if (!triviaQuestions || triviaQuestions.length === 0) {
      console.error("❌ No trivia questions available!");
      return res.status(400).json({ error: "No trivia questions available." });
  }

  // Prevent overlap with ongoing questions
  if (questionInProgress) {
      console.warn("⚠️ A question is already in progress!");
      return res.json({ error: "A question is already in progress." });
  }

  // Get a random question
  let questionObj = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
  
  // Verify the question has all required fields
  if (!questionObj || !questionObj.question || !questionObj.choices || !questionObj.correctAnswer) {
      console.error("❌ Invalid question object:", questionObj);
      return res.status(500).json({ error: "Invalid question data." });
  }
  
  let shuffledChoices = shuffleArray([...questionObj.choices]);

  // Return the question with shuffled choices
  const responseObj = {
      question: questionObj.question,
      choices: shuffledChoices,
      correctAnswer: questionObj.correctAnswer,
      duration: triviaSettings?.answerTime || 30000
  };

  console.log("📩 Sending next trivia question");
  res.json(responseObj);
});

// Initialize database connection
initDatabase();

// ✅ Start Server
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));