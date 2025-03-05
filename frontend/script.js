/**
 * Loremaster Trivia Extension - Frontend Script
 * Organized into logical chunks for maintainability
 */

// ======================================================
// 1. CONFIGURATION & INITIALIZATION
// ======================================================

/**
 * Global state management for the trivia application
 * With enhanced properties for better question and timer management
 */
const TriviaState = {
  userId: null,                     // User's Twitch ID
  username: null,                   // User's Twitch username
  triviaActive: false,              // Whether trivia is currently active
  questionStartTime: null,          // When the current question started
  nextQuestionTime: null,           // When the next question will appear
  questionRequested: false,         // Flag to prevent duplicate question requests
  lastAnswerData: null,             // Data from last answer for display
  countdownUpdatedByPubSub: false,  // Flag to track PubSub countdown updates
  currentQuestionDifficulty: null,  // Current question difficulty level
  currentQuestionDuration: null,    // Current question duration
  
  // New properties for timer and question management
  currentQuestionTimer: null,       // Timer ID for current question
  timerAnimation: null,             // Animation frame ID for timer 
  lastQuestionTimestamp: 0,         // Last question timestamp for duplicate detection
  lastQuestionId: null,             // Last question ID for duplicate detection
  lastQuestionText: null,           // Last question text for duplicate detection
  questionDebounceTimer: null,      // Timer for debouncing question requests
  lastQuestionRequestTime: 0,       // Timestamp of last question request
  lastPubSubUpdate: 0,              // Timestamp of last PubSub update
  currentQuestionData: null,        // Current question data for reference
  
  // Default settings
  settings: {
    answerTime: 30000,     // Default: 30 seconds
    intervalTime: 600000   // Default: 10 minutes
  },
  
  /**
   * Determines API base URL based on environment
   * @returns {string} Base URL for API calls
   */
  getApiBaseUrl() {
    return window.location.hostname.includes('ext-twitch.tv')
      ? 'https://loremaster-trivia.com'
      : '';
  }
};
  
  /**
   * Cache DOM elements to avoid repeated lookups
   */
  const UI = {
    waitingScreen: document.getElementById("waiting-screen"),
    quizContainer: document.getElementById("quiz-container"),
    endedScreen: document.getElementById("trivia-ended-screen"),
    questionText: document.getElementById("question-text"),
    choicesContainer: document.getElementById("choices-container"),
    timerBar: document.getElementById("timer-bar"),
    countdownTimer: document.getElementById("countdown-timer"),
    waitingText: document.getElementById("waiting-text"),
    userScore: document.getElementById("user-score")
  };
  
  // ======================================================
  // 2. TWITCH EXTENSION INTEGRATION
  // ======================================================
  
  /**
   * Initialize Twitch extension and set up event listeners
   */
  function initializeTwitchExtension() {
    // Set up authorization handler
    window.Twitch.ext.onAuthorized(handleAuthorization);
    
    // Set up broadcast listener
    window.Twitch.ext.listen("broadcast", handleBroadcastMessage);
    
    // Initialize UI
    UI.setUIState("waiting");
  }
  
  /**
   * Handle Twitch extension authorization
   * @param {Object} auth - Authorization data from Twitch
   */

// In frontend/script.js - Improve handleAuthorization function
/**
 * Handle Twitch extension authorization
 * @param {Object} auth - Authorization data from Twitch
 */
function handleAuthorization(auth) {
  console.log("✅ Extension authorized with token:", auth.token.substring(0, 10) + "...");
  TriviaState.userId = auth.userId;
  
  // Request identity sharing from the user
  window.Twitch.ext.actions.requestIdShare();
  
  // Check if the extension has viewer info access
  const hasViewerData = window.Twitch.ext.viewer && 
                        window.Twitch.ext.viewer.id && 
                        window.Twitch.ext.viewer.id === auth.userId;
                        
  console.log(`👤 Viewer data available: ${hasViewerData}`);
  
  // If we have direct access to the viewer's display name
  if (hasViewerData && window.Twitch.ext.viewer.displayName) {
    TriviaState.username = window.Twitch.ext.viewer.displayName;
    console.log(`👤 Got username directly from viewer object: ${TriviaState.username}`);
    
    // Store in localStorage as backup
    try {
      localStorage.setItem('twitchUsername', TriviaState.username);
      localStorage.setItem('twitchUserId', TriviaState.userId);
      console.log("💾 Stored username in localStorage");
    } catch (e) {
      console.warn("⚠️ Could not store username in localStorage");
    }
    
    // Send username to server
    UserManager.sendUsername();
  } 
  // Check if we have an identity link (opaqueId different from userId)
  else if (auth.userId !== auth.clientId && auth.channelId) {
    console.log("🔗 User appears to have identity link - sending data to server for resolution");
    
    // Send auth data to server for possible API resolution
    fetch(`${TriviaState.getApiBaseUrl()}/extension-identity`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${auth.token}` // Include the JWT token
      },
      body: JSON.stringify({
        userId: auth.userId,
        channelId: auth.channelId,
        clientId: auth.clientId,
        token: auth.token
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.username) {
        console.log(`👤 Server resolved username: ${data.username}`);
        TriviaState.username = data.username;
        
        // Store resolved username
        try {
          localStorage.setItem('twitchUsername', TriviaState.username);
          localStorage.setItem('twitchUserId', TriviaState.userId);
        } catch (e) {
          // Ignore localStorage errors
        }
      }
    })
    .catch(error => console.error("❌ Error with identity resolution:", error));
  }
  // Try to recover from localStorage as last resort
  else {
    try {
      const storedUsername = localStorage.getItem('twitchUsername');
      const storedUserId = localStorage.getItem('twitchUserId');
      
      if (storedUsername && storedUserId === TriviaState.userId) {
        TriviaState.username = storedUsername;
        console.log("👤 Restored username from localStorage:", TriviaState.username);
        
        // Send recovered username to server
        UserManager.sendUsername();
      } else {
        console.log("⚠️ No username available from any source");
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }
  
  // Always fetch score regardless of username status
  UserManager.fetchUserScore();
}
  
  /**
   * Process broadcast messages from Twitch PubSub
   * @param {string} target - Target of the broadcast
   * @param {string} contentType - Content type of the message
   * @param {string} message - JSON message string
   */
  function handleBroadcastMessage(target, contentType, message) {
    try {
      const data = JSON.parse(message);
      console.log("📢 Received broadcast:", data.type);
      
      switch (data.type) {
        case "SETTINGS_UPDATE":
          handleSettingsUpdate(data);
          break;
          
        case "TRIVIA_START":
          handleTriviaStart(data);
          break;
          
        case "TRIVIA_QUESTION":
          handleTriviaQuestion(data);
          break;
          
        case "COUNTDOWN_UPDATE":
          handleCountdownUpdate(data);
          break;
          
        case "TRIVIA_END":
          handleTriviaEnd();
          break;
          
        default:
          console.warn("⚠️ Unknown broadcast type:", data.type);
      }
    } catch (err) {
      console.error("❌ Error processing broadcast:", err);
    }
  }
  
  // ======================================================
  // 3. BROADCAST MESSAGE HANDLERS
  // ======================================================
  
/**
 * Handle trivia question message with enhanced duplicate detection
 * @param {Object} data - Question data
 */
function handleTriviaQuestion(data) {
  console.log("🎯 Received trivia question");
  
  // Basic validation - if missing critical data, ignore
  if (!data || !data.question || !data.choices || !data.correctAnswer) {
    console.error("❌ Received invalid question data:", data);
    return;
  }
  
  // Track the last question timestamp to detect duplicates
  if (!TriviaState.lastQuestionTimestamp) {
    TriviaState.lastQuestionTimestamp = 0;
  }
  
  // NEW: Check if we're already displaying a question (active question check)
  if (UI.quizContainer.style.display === "flex" && 
      TriviaState.questionStartTime && 
      Date.now() - TriviaState.questionStartTime < (data.duration || TriviaState.settings.answerTime)) {
    console.warn(`⚠️ Already displaying an active question! Ignoring incoming question.`);
    return;
  }
  
  // Check for duplicate question based on timestamp
  if (data.timestamp && data.timestamp <= TriviaState.lastQuestionTimestamp) {
    console.warn(`⚠️ Detected duplicate question (timestamp: ${data.timestamp}). Ignoring.`);
    return;
  }
  
  // NEW: Check for duplicate based on question text or ID
  if (data.questionId && data.questionId === TriviaState.lastQuestionId) {
    console.warn(`⚠️ Detected duplicate question ID: ${data.questionId}. Ignoring.`);
    return;
  }
  
  if (TriviaState.lastQuestionText === data.question) {
    console.warn(`⚠️ Detected duplicate question text. Ignoring.`);
    return;
  }
  
  // Update tracking data for duplicate detection
  if (data.timestamp) {
    TriviaState.lastQuestionTimestamp = data.timestamp;
  }
  
  if (data.questionId) {
    TriviaState.lastQuestionId = data.questionId;
  }
  
  TriviaState.lastQuestionText = data.question;
  
  // Reset request flag and display the question
  TriviaState.questionRequested = false;
  QuestionManager.displayQuestion(data);
}
  
  // ======================================================
  // 4. UI MANAGEMENT
  // ======================================================
  
  /**
   * UI management methods
   */
  UI.setUIState = function(state) {
    console.log(`🎭 Setting UI state to: ${state}`);
    
    // Hide all screens first
    this.waitingScreen.style.display = "none";
    this.quizContainer.style.display = "none";
    this.endedScreen.style.display = "none";
    
    // Show appropriate screen based on state
    switch (state) {
      case "waiting":
        this.waitingScreen.style.display = "flex";
        this.waitingText.textContent = "Trivia has not started yet.";
        this.countdownTimer.style.display = "none";
        break;
        
      case "countdown":
        this.waitingScreen.style.display = "flex";
        this.waitingText.textContent = "Next question in:";
        this.countdownTimer.style.display = "inline";
        break;
        
      case "question":
        this.quizContainer.style.display = "flex";
        break;
        
      case "ended":
        this.endedScreen.style.display = "block";
        break;
    }
  };
  
  // ======================================================
  // 5. USER MANAGEMENT
  // ======================================================
  
  /**
   * User data and score management
   */
  const UserManager = {
    /**
     * Send username to server for tracking
     */
    sendUsername() {
      if (!TriviaState.userId || !TriviaState.username) {
        console.warn("⚠️ Missing userId or username");
        return;
      }
      
      console.log(`👤 Sending username to server: ${TriviaState.username}`);
      
      // Store in localStorage as well for persistence
      try {
        localStorage.setItem('twitchUsername', TriviaState.username);
        localStorage.setItem('twitchUserId', TriviaState.userId);
      } catch (e) {
        // Ignore localStorage errors
      }
      
      fetch(`${TriviaState.getApiBaseUrl()}/api/set-username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: TriviaState.userId,
          username: TriviaState.username
        })
      })
      .then(response => response.json())
      .then(data => console.log("✅ Username sent successfully"))
      .catch(error => console.error("❌ Error sending username:", error));
    },

    /**
     * Fetch user's score from server
     */
    fetchUserScore() {
      if (!TriviaState.userId) {
        console.warn("⚠️ Cannot fetch score: User ID is missing");
        return;
      }
      
      console.log(`📊 Fetching score for user: ${TriviaState.userId}`);
      
      fetch(`${TriviaState.getApiBaseUrl()}/score/${TriviaState.userId}`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          console.log(`🏆 Retrieved user scores:`, data);
          this.displayScores(data.totalScore || 0, data.sessionScore || 0);
        })
        .catch(error => {
          console.error("❌ Error fetching user score:", error);
          this.displayScores(0, 0);
        });
    },
    
    /**
     * Display user scores in UI
     * @param {number} totalScore - User's total score
     * @param {number} sessionScore - User's session score
     */
    displayScores(totalScore, sessionScore) {
      if (!UI.userScore) {
        console.error("❌ Score container not found");
        return;
      }
      
      // Format scores for display
      const formattedTotal = Number(totalScore).toLocaleString();
      const formattedSession = Number(sessionScore).toLocaleString();
      
      // Update DOM
      UI.userScore.innerHTML = `
        <div class="total-score">Total Score: ${formattedTotal}</div>
        <div class="session-score">Session Score: ${formattedSession}</div>
      `;
      
      console.log(`🏆 Scores updated: Total=${formattedTotal}, Session=${formattedSession}`);
    },
    
    /**
     * Submit answer to server
     * @param {HTMLElement} button - Button element that was clicked
     * @param {string} selectedChoice - User's selected answer
     * @param {string} correctAnswer - Correct answer
     */
    submitAnswer(button, selectedChoice, correctAnswer) {
      if (!TriviaState.userId) {
        console.warn("⚠️ User ID missing. Cannot track score.");
        return;
      }
      
      // Calculate answer time
      const answerTime = Date.now() - TriviaState.questionStartTime;
      
      // Prepare answer data
      const answerData = {
        userId: TriviaState.userId,
        username: TriviaState.username || null,
        selectedAnswer: selectedChoice,
        correctAnswer: correctAnswer,
        answerTime: answerTime,
        difficulty: TriviaState.currentQuestionDifficulty,
        duration: TriviaState.currentQuestionDuration
      };
      
      console.log("📤 Submitting answer:", answerData);
      
      // Send answer to server
      fetch(`${TriviaState.getApiBaseUrl()}/submit-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answerData)
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log("🏆 Score updated:", data);
        
        // Update scores
        this.displayScores(data.totalScore || 0, data.sessionScore || 0);
        
        // Store answer data for display when timer ends
        if (data.pointsEarned > 0) {
          TriviaState.lastAnswerData = {
            button: button,
            pointsEarned: data.pointsEarned,
            timePercentage: data.timePercentage
          };
        }
      })
      .catch(error => {
        console.error("❌ Error submitting answer:", error);
      });
    }
  };
  
  // ======================================================
  // 6. QUESTION MANAGEMENT
  // ======================================================
  
/**
 * Question display and answer handling
 */
const QuestionManager = {
  /**
   * Display trivia question in UI with proper timer cleanup
   * @param {Object} data - Question data
   */
  displayQuestion(data) {
    if (!data.question || !data.choices || !data.correctAnswer) {
      console.error("❌ Missing required question data:", data);
      TriviaState.questionRequested = false;
      return;
    }
    
    // NEW: Cancel any existing question timers to prevent overlapping
    if (TriviaState.currentQuestionTimer) {
      console.log("🔄 Clearing existing question timer");
      clearTimeout(TriviaState.currentQuestionTimer);
      TriviaState.currentQuestionTimer = null;
    }
    
    // NEW: Clear any running animations
    if (TriviaState.timerAnimation) {
      cancelAnimationFrame(TriviaState.timerAnimation);
      TriviaState.timerAnimation = null;
    }
    
    // Calculate duration with fallback
    const duration = data.duration || TriviaState.settings.answerTime || 30000;
    
    // Update global state
    TriviaState.questionStartTime = Date.now();
    TriviaState.currentQuestionDifficulty = data.difficulty || 'Medium';
    TriviaState.currentQuestionDuration = duration;
    TriviaState.triviaActive = true;
    TriviaState.questionRequested = false;
    TriviaState.currentQuestionData = data; // NEW: Store question data for reference
    
    // Update question text
    UI.questionText.textContent = data.question;
    UI.choicesContainer.innerHTML = "";
    
    // Reset timer bar fully before animation
    UI.timerBar.style.transition = "none";
    UI.timerBar.style.width = "100%";
    
    // Force a reflow to ensure the reset takes effect
    void UI.timerBar.offsetWidth; 
    
    // Remove existing difficulty indicators
    document.querySelectorAll('.difficulty-indicator').forEach(el => el.remove());
    
    // Add difficulty indicator if available
    if (data.difficulty) {
      const difficultyIndicator = document.createElement("div");
      difficultyIndicator.className = "difficulty-indicator " + data.difficulty.toLowerCase();
      difficultyIndicator.textContent = data.difficulty;
      UI.questionText.parentNode.insertBefore(difficultyIndicator, UI.questionText);
    }
    
    // Create buttons for each choice
    data.choices.forEach(choice => {
      const button = document.createElement("button");
      button.classList.add("choice-button");
      button.textContent = choice;
      button.onclick = () => this.handleAnswerSelection(button, choice, data.correctAnswer);
      UI.choicesContainer.appendChild(button);
    });
    
    // Show question UI first
    UI.setUIState("question");
    
    // Start timer animation after a short delay (using requestAnimationFrame for smoother animation)
    setTimeout(() => {
      UI.timerBar.style.transition = `width ${duration / 1000}s linear`;
      UI.timerBar.style.width = "0%";
    }, 100);
    
    // Start timer for question
    TimerManager.startQuestionTimer(duration, data.correctAnswer);
    
    console.log(`✅ Displayed question: "${data.question.substring(0, 30)}..." with duration ${duration}ms`);
  },
  
  /**
   * Handle user answer selection
   * @param {HTMLElement} button - Button that was clicked
   * @param {string} selectedChoice - Selected answer text
   * @param {string} correctAnswer - Correct answer text
   */
  handleAnswerSelection(button, selectedChoice, correctAnswer) {
    // Disable all buttons to prevent multiple selections
    document.querySelectorAll(".choice-button").forEach(btn => btn.disabled = true);
    
    // Mark selected button
    button.classList.add("selected");
    button.dataset.selected = "true";
    
    // Submit answer to server
    UserManager.submitAnswer(button, selectedChoice, correctAnswer);
  },
  
  /**
   * Reveal correct answer
   * @param {string} correctAnswer - Correct answer text
   */
  revealCorrectAnswer(correctAnswer) {
    const buttons = document.querySelectorAll(".choice-button");
    
    // Mark each button as correct or wrong
    buttons.forEach(btn => {
      if (btn.textContent === correctAnswer) {
        btn.classList.add("correct");
      } else if (btn.dataset.selected === "true") {
        btn.classList.remove("selected");
        btn.classList.add("wrong");
      } else {
        btn.classList.add("wrong");
      }
      btn.disabled = true;
    });
    
    // Show points info if we have it
    if (TriviaState.lastAnswerData && TriviaState.lastAnswerData.pointsEarned > 0) {
      const pointsInfo = document.createElement("div");
      pointsInfo.className = "points-info";
      pointsInfo.innerHTML = `
        <span class="points">+${TriviaState.lastAnswerData.pointsEarned} points!</span>
        <span class="time-bonus">${TriviaState.lastAnswerData.timePercentage}% time bonus</span>
      `;
      TriviaState.lastAnswerData.button.parentNode.appendChild(pointsInfo);
      
      // Clear the data
      TriviaState.lastAnswerData = null;
    }
  }
};
  
// ======================================================
// 7. TIMER MANAGEMENT
// ======================================================

/**
 * Countdown and timer management
 */
const TimerManager = {
  /**
   * Update countdown display
   * @param {number} timeRemaining - Time remaining in milliseconds
   */
  updateCountdown(timeRemaining) {
    if (!UI.countdownTimer || isNaN(timeRemaining) || timeRemaining <= 0) {
      if (UI.countdownTimer) {
        UI.countdownTimer.textContent = "0:00";
      }
      return;
    }
    
    // Format time as MM:SS
    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    
    UI.countdownTimer.style.display = "inline";
    UI.countdownTimer.textContent = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  },
  
  /**
   * Start timer for current question with improved cancel handling
   * @param {number} duration - Duration in milliseconds
   * @param {string} correctAnswer - Correct answer text
   */
  startQuestionTimer(duration, correctAnswer) {
    // Store current question timestamp to verify timer validity later
    const currentQuestionTime = TriviaState.questionStartTime;
    
    // Clear any existing timer first
    if (TriviaState.currentQuestionTimer) {
      clearTimeout(TriviaState.currentQuestionTimer);
    }
    
    // Store the new timer ID for potential cancellation
    TriviaState.currentQuestionTimer = setTimeout(() => {
      // Check if we're still showing the same question
      if (TriviaState.questionStartTime !== currentQuestionTime) {
        console.log("⚠️ Question changed, not revealing answers");
        return;
      }
      
      console.log("⌛ Time's up! Revealing correct answer");
      
      // Reveal answer
      QuestionManager.revealCorrectAnswer(correctAnswer);
      
      // Clear timer reference
      TriviaState.currentQuestionTimer = null;
      
      // Schedule transition back to countdown
      setTimeout(() => {
        const nextInterval = TriviaState.settings.intervalTime || 600000;
        this.transitionToCountdown(nextInterval);
      }, 5000);
    }, duration);
    
    console.log(`⏱️ Started question timer for ${duration}ms with ID: ${TriviaState.currentQuestionTimer}`);
  },
  
  /**
   * Transition to countdown screen
   * @param {number} intervalTime - Interval time in milliseconds
   */
  transitionToCountdown(intervalTime) {
    // Validate interval time with fallbacks
    if (!intervalTime || isNaN(intervalTime)) {
      intervalTime = TriviaState.settings.intervalTime || 600000;
    }
    
    // Update state
    TriviaState.triviaActive = true;
    TriviaState.nextQuestionTime = Date.now() + intervalTime;
    
    // Clear question-related state
    TriviaState.questionStartTime = null;
    TriviaState.currentQuestionData = null;
    
    // Update UI
    UI.setUIState("countdown");
    this.updateCountdown(intervalTime);
    
    console.log(`🔄 Transitioned to countdown with interval: ${intervalTime}ms`);
  },
  
  /**
   * Check if it's time to request the next question with improved debounce protection
   */
  checkForNextQuestion() {
    // Skip if trivia isn't active or if PubSub updated countdown
    if (!TriviaState.triviaActive || !TriviaState.nextQuestionTime) {
      return;
    }
    
    // Skip if a question is already requested or in progress
    if (TriviaState.questionRequested || TriviaState.currentQuestionTimer) {
      return;
    }
    
    // Skip if countdown was recently updated by PubSub (avoids race conditions)
    if (TriviaState.countdownUpdatedByPubSub) {
      const timeSinceUpdate = Date.now() - (TriviaState.lastPubSubUpdate || 0);
      if (timeSinceUpdate < 2000) { // 2-second protection window
        return;
      }
      // Clear the flag after protection window
      TriviaState.countdownUpdatedByPubSub = false;
    }
    
    const timeRemaining = TriviaState.nextQuestionTime - Date.now();
    
    // Update local countdown
    this.updateCountdown(timeRemaining);
    
    // Request next question when time is up
    if (timeRemaining <= 0 && !TriviaState.questionRequested) {
      console.log("⏳ Countdown reached 0! Requesting next question");
      
      // Immediately set flag to prevent multiple requests
      TriviaState.questionRequested = true;
      
      // Cancel any existing debounce timer
      if (TriviaState.questionDebounceTimer) {
        clearTimeout(TriviaState.questionDebounceTimer);
      }
      
      // Use debounce to prevent multiple closely-timed requests
      TriviaState.questionDebounceTimer = setTimeout(() => {
        this.requestQuestion();
        TriviaState.questionDebounceTimer = null;
      }, 100); // Small delay to prevent duplicate requests
    }
  },
  
  /**
   * Handle question requests with smart retries
   * @param {number} retryCount - Current retry attempt count
   */
  requestQuestion(retryCount = 0) {
    if (retryCount > 3) {
      console.error("❌ Maximum retry attempts reached for question request");
      
      // Reset request flag after a longer timeout if all retries fail
      setTimeout(() => {
        TriviaState.questionRequested = false;
      }, 10000); // 10-second cooldown before allowing new requests
      
      return;
    }
    
    // Track when we made this request
    const requestTime = Date.now();
    TriviaState.lastQuestionRequestTime = requestTime;
    
    fetch(`${TriviaState.getApiBaseUrl()}/get-next-question`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        // Ignore responses to outdated requests
        if (requestTime !== TriviaState.lastQuestionRequestTime) {
          console.warn("⚠️ Ignoring response to outdated question request");
          return;
        }
        
        if (data.error) {
          console.warn(`⚠️ ${data.error}`);
          
          // Special handling for retry requests
          if (data.retry) {
            console.log("🔄 Server asked us to retry. Waiting briefly...");
            setTimeout(() => {
              this.requestQuestion(retryCount + 1);
            }, 1000); // Wait 1 second before retry
            return;
          }
          
          // Reset request flag after delay to prevent spam
          setTimeout(() => {
            TriviaState.questionRequested = false;
          }, 5000);
          return;
        }
        
        // Display question if valid
        QuestionManager.displayQuestion(data);
      })
      .catch(error => {
        console.error("❌ Error fetching next question:", error);
        
        // Retry on network errors
        if (retryCount < 3) {
          console.log(`🔄 Retrying question request (attempt ${retryCount + 1})...`);
          setTimeout(() => {
            this.requestQuestion(retryCount + 1);
          }, 1000 * (retryCount + 1)); // Exponential backoff
          return;
        }
        
        // Reset request flag after delay
        setTimeout(() => {
          TriviaState.questionRequested = false;
        }, 5000);
      });
  }
};

/**
 * Handle countdown update message with improved timestamp tracking
 * @param {Object} data - Countdown data with timeRemaining
 */
function handleCountdownUpdate(data) {
  console.log("⏱️ Received countdown update");
  
  if (!data.timeRemaining && data.timeRemaining !== 0) {
    console.warn("⚠️ Missing timeRemaining in countdown update");
    return;
  }
  
  // Update countdown flag to prevent duplicate updates
  TriviaState.countdownUpdatedByPubSub = true;
  TriviaState.lastPubSubUpdate = Date.now();
  
  // Update nextQuestionTime based on the timeRemaining from server
  TriviaState.nextQuestionTime = Date.now() + data.timeRemaining;
  
  // Update the UI with the new time
  UI.setUIState("countdown");
  TimerManager.updateCountdown(data.timeRemaining);
}
  
  // ======================================================
  // 8. INITIALIZATION & EVENT LISTENERS
  // ======================================================
  
  // Set up timer check interval
  setInterval(() => {
    TimerManager.checkForNextQuestion();
  }, 1000);
  
  // Initialize UI
  document.addEventListener("DOMContentLoaded", () => {
    console.log("🚀 Initializing Loremaster Trivia Extension");
    initializeTwitchExtension();
  });