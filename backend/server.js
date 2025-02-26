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
const PORT = process.env.PORT || 5000; // default port

const usersScores = {}; // Stores scores { "twitchUserID": score }

let countdownInterval = null; // ✅ Declare countdown interval at the top
let triviaInterval = null; // ✅ Declare this at the top


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

// Trivia Start Functionality
let triviaActive = false; // ✅ Trivia is inactive until manually started.
let nextQuestionTime = null; // ✅ Prevents unnecessary calls to /get-next-question on startup

app.post("/start-trivia", async (req, res) => {
  if (triviaActive) {
      console.log("⚠️ Trivia is already running. Ignoring start request.");
      return res.json({ success: false, message: "Trivia is already running!" });
  }

  triviaActive = true;

  const token = generateToken();
  const startPayload = {
      target: ["broadcast"],
      broadcaster_id: CHANNEL_ID.toString(),
      is_global_broadcast: false,
      message: JSON.stringify({ type: "TRIVIA_START" }),
  };

  try {
      // ✅ Broadcast TRIVIA_START before setting next question time
      await axios.post("https://api.twitch.tv/helix/extensions/pubsub", startPayload, {
          headers: {
              Authorization: `Bearer ${token}`,
              "Client-Id": EXT_CLIENT_ID,
              "Content-Type": "application/json",
          },
      });

      console.log("🚀 TRIVIA_START event broadcasted!");

      // ✅ Ensure trivia settings exist before setting the countdown
      if (!triviaSettings || typeof triviaSettings.intervalTime !== "number") {
          console.error("❌ Invalid trivia settings! Using default interval time.");
          nextQuestionTime = Date.now() + 60000; // ✅ Default to 60 seconds if no valid setting
      } else {
          nextQuestionTime = Date.now() + triviaSettings.intervalTime;
      }

      console.log(`⏳ First trivia question will be in ${Math.round((nextQuestionTime - Date.now()) / 1000)} seconds.`);

      // ✅ Send response to the client only once
      res.json({ success: true, message: "Trivia started!" });

  } catch (error) {
      console.error("❌ Error broadcasting TRIVIA_START:", error);

      // ✅ Reset trivia state if it fails to start
      triviaActive = false;
      return res.status(500).json({ success: false, error: "Failed to start trivia." });
  }
});


// ✅ Timing Constants
const QUESTION_DURATION = 30000; // 30 seconds (legacy fallback)
const NEXT_QUESTION_INTERVAL = 600000; // 10 minutes
let triviaQuestions = [];

// NEW: Flag to suppress countdown updates during an active trivia round.
let triviaRoundEndTime = 0;

// ✅ Helper: Shuffle Array
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

let questionInProgress = false; // ✅ Prevents multiple questions at once
let usedQuestions = []; // Avoding Repeat Questions


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
      console.log("🧠 Selecting a trivia question...");
      const questionObj = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
      const shuffledChoices = shuffleArray([...questionObj.choices]);

      const answerTime = triviaSettings?.answerTime || 30000; // Default 30s
      const intervalTime = triviaSettings?.intervalTime || 600000; // Default 10 min

      console.log(`⏳ Current trivia settings → Answer Time: ${answerTime}ms, Interval: ${intervalTime}ms`);

      questionInProgress = true;

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

      // ✅ Only start the interval countdown **AFTER** the answer time + buffer
      triviaRoundEndTime = Date.now() + answerTime + 5000; // Extra 5s buffer

      setTimeout(() => {
          questionInProgress = false;
          nextQuestionTime = Date.now() + intervalTime; // ✅ Now start the interval countdown
          console.log(`⏳ Next trivia question in: ${intervalTime / 1000} seconds`);
      }, answerTime + 5000); // Wait until the question ends before setting `nextQuestionTime`
      
  } catch (error) {
      console.error("❌ Error sending PubSub message:", error.response?.data || error.message);
      questionInProgress = false;
  }
}

// ✅ Trivia Settings
let triviaSettings = {
  answerTime: 30000,     // Default 30 seconds
  intervalTime: 600000,  // Default 10 minutes
};

// ✅ CSV Upload Route
const upload = multer({ dest: "uploads/" });
app.post("/upload-csv", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const file = req.file.path;
    const lines = fs.readFileSync(file, "utf-8").split("\n");

    triviaQuestions = lines.reduce((questions, rawLine) => {
      const line = rawLine.trim();
      if (!line) return questions; // skip empty lines

      const q = line.replace(/\r/g, "").split(",");
      // Ensure at least 5 columns: question + 4 choices
      if (q.length < 5) return questions;

      questions.push({
        question: q[0],
        choices: [q[1], q[2], q[3], q[4]], // no shuffling here
        correctAnswer: q[1],
      });
      return questions;
    }, []);

    console.log("✅ Trivia questions updated:", triviaQuestions);
    res.json({ message: "✅ Trivia questions uploaded successfully!" });
  } catch (error) {
    console.error("❌ Error processing CSV:", error);
    res.status(500).json({ error: "Failed to upload trivia questions." });
  }
});

// ✅ Handle User Answer Submission
app.post("/submit-answer", (req, res) => {
  try {
    const { userId, selectedAnswer, correctAnswer, answerTime } = req.body;

    if (!userId || !selectedAnswer || !correctAnswer || answerTime === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ✅ Calculate Score Based on Answer Time
    let points = 0;
    if (selectedAnswer === correctAnswer) {
      if (answerTime <= 3000) {
        points = 1500;
      } else if (answerTime >= 25000) {
        points = 500;
      } else {
        // Gradual decrease from 1500 down to 500
        points = Math.max(500, Math.round(1500 - ((answerTime - 3000) / 22)));
      }
    }

    // ✅ Track Player Score
    if (!usersScores[userId]) usersScores[userId] = 0;
    usersScores[userId] += points;

    console.log(`🏆 User ${userId} earned ${points} points! Total: ${usersScores[userId]}`);
    res.json({ success: true, pointsEarned: points, totalScore: usersScores[userId] });
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

// ✅ Broadcast Countdown Update to Twitch PubSub
async function sendCountdownUpdate() {
  // ✅ Stop countdown updates during an active trivia round
  if (!triviaActive || Date.now() < triviaRoundEndTime) {
      console.log("⚠️ Countdown suppressed during active trivia round.");
      return;
  }

  // ✅ If the answer time just finished, set `nextQuestionTime` to start now
  if (!nextQuestionTime || nextQuestionTime < Date.now()) {
      console.log("⏳ Answer time just ended, starting interval countdown now.");
      nextQuestionTime = Date.now() + triviaSettings.intervalTime;
  }

  const timeRemaining = nextQuestionTime - Date.now();
  if (timeRemaining <= 0) {
      console.log("⏳ Countdown reached 0! Sending trivia question...");
      sendTriviaQuestion(CHANNEL_ID);
      return;
  }

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

// ✅ End Trivia Immediately (Single route)
app.post("/end-trivia", (req, res) => {
  console.log("🛑 Trivia manually ended!");

  triviaActive = false;
  triviaRoundEndTime = 0;
  nextQuestionTime = 0;

  // ✅ Ensure timers are cleared safely
  if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
  }

  if (triviaInterval) {
      clearInterval(triviaInterval);
      triviaInterval = null; // ✅ Prevent errors
  }

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

setInterval(() => {
  if (!triviaActive || !nextQuestionTime) {
      return;
  }

  const now = Date.now();
  let timeRemaining = nextQuestionTime - now;

  console.log(`⏳ Time remaining: ${Math.round(timeRemaining / 1000)} seconds`);

  // ✅ Update countdown UI
  sendCountdownUpdate();

  // ✅ When time runs out, request the next question
  if (timeRemaining <= 0) {
      console.log("⏳ Countdown reached 0! Sending trivia question...");
      requestNextQuestion();
  }
}, 1000); // ✅ Runs once per second, handles both countdown & question timing

// ✅ Automatically transition to the next trivia question
function requestNextQuestion() {
  console.log("🚀 Requesting the next trivia question...");

  fetch(`http://localhost:${PORT}/get-next-question`)
      .then(response => response.json())
      .then(data => {
          if (data.error) {
              console.warn("⏳ Next question is not ready yet, waiting...");
              return; // ✅ Prevents unnecessary API calls
          }

          console.log("📩 Received next question:", data);

          // ✅ Send the next question via PubSub so the frontend can handle it
          const token = generateToken();
          const pubsubPayload = {
              target: ["broadcast"],
              broadcaster_id: CHANNEL_ID.toString(),
              is_global_broadcast: false,
              message: JSON.stringify({
                  type: "TRIVIA_QUESTION",
                  question: data.question,
                  choices: data.choices,
                  correctAnswer: data.correctAnswer,
                  duration: triviaSettings.answerTime,
              }),
          };

          return axios.post(
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
      })
      .then(() => {
          console.log("✅ Trivia question sent to channel", CHANNEL_ID);
          // ✅ Update next question time to prevent duplicate questions
          nextQuestionTime = Date.now() + triviaSettings.intervalTime;
      })
      .catch(error => {
          console.error("❌ Error broadcasting trivia question:", error);
      });
}

// ✅ Get-Next-Question Endpoint (Prevent Early Questions)
app.get("/get-next-question", (req, res) => {
  console.log("📢 /get-next-question endpoint called!");

  if (!triviaActive) {
      console.log("⏳ Trivia is inactive. Skipping next question request.");
      return res.json({ error: "Trivia is not active." });
  }

  const timeRemaining = nextQuestionTime - Date.now();

  if (timeRemaining > 0) {
      console.log(`⏳ Next question not ready yet! Time remaining: ${Math.round(timeRemaining / 1000)} seconds`);
      return res.json({ message: "Next question not ready yet.", timeRemaining });
  }

  if (!triviaQuestions || triviaQuestions.length === 0) {
      console.error("❌ No trivia questions available!");
      return res.status(400).json({ error: "No trivia questions available." });
  }

  // ✅ Ensure a question is properly selected
  let questionObj = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];

  if (!questionObj || !questionObj.question || !questionObj.choices || !questionObj.correctAnswer) {
      console.error("❌ Invalid question object:", questionObj);
      return res.status(500).json({ error: "Invalid question data." });
  }

  console.log("📩 Sending next trivia question:", questionObj);
  res.json(questionObj); // ✅ Send trivia question as JSON
});

// ✅ Start Server
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));

