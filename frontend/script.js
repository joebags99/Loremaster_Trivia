/**
 * Loremaster Trivia Extension - Frontend Script
 * Organized into logical chunks for maintainability
 */

// ======================================================
// 1. CONFIGURATION & INITIALIZATION
// ======================================================

/**
 * Global state management for the trivia application
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
  TriviaState.userId = auth.userId;
  
  // Request identity sharing from the user
  window.Twitch.ext.actions.requestIdShare();
  
  // Check if the extension has viewer info access
  const hasViewerData = window.Twitch.ext.viewer && 
                        window.Twitch.ext.viewer.id && 
                        window.Twitch.ext.viewer.id === auth.userId;
                          
  // If we have direct access to the viewer's display name
  if (hasViewerData && window.Twitch.ext.viewer.displayName) {
    TriviaState.username = window.Twitch.ext.viewer.displayName;
    console.log(`👤 Got username directly from viewer object: ${TriviaState.username}`);
    
    // Store in localStorage as backup
    try {
      localStorage.setItem('twitchUsername', TriviaState.username);
      localStorage.setItem('twitchUserId', TriviaState.userId);
    } catch (e) {
      console.warn("⚠️ Could not store username in localStorage");
    }
    
    // Send username to server
    UserManager.sendUsername();
  } 
  // Check if we have an identity link (opaqueId different from userId)
  else if (auth.userId !== auth.clientId && auth.channelId) {
    
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
        
        // Send recovered username to server
        UserManager.sendUsername();
      } else {
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
   * Handle settings update message
   * @param {Object} data - Settings data
   */
  function handleSettingsUpdate(data) {
    TriviaState.settings.answerTime = data.answerTime || TriviaState.settings.answerTime;
    TriviaState.settings.intervalTime = data.intervalTime || TriviaState.settings.intervalTime;
  }
  
  /**
   * Handle trivia start message
   * @param {Object} data - Trivia start data
   */
  function handleTriviaStart(data) {
    TriviaState.triviaActive = true;
    
    // Set next question time
    const intervalTime = data.intervalTime || TriviaState.settings.intervalTime;
    TriviaState.nextQuestionTime = Date.now() + intervalTime;
    
    // Update UI
    UI.setUIState("countdown");
    TimerManager.updateCountdown(intervalTime);
  }
  
 /**
 * Handle trivia question message with duplicate detection
 * @param {Object} data - Question data
 */
function handleTriviaQuestion(data) {
  
  // Track the last question timestamp to detect duplicates
  if (!TriviaState.lastQuestionTimestamp) {
    TriviaState.lastQuestionTimestamp = 0;
  }
  
  // Check for duplicate question based on timestamp
  if (data.timestamp && data.timestamp <= TriviaState.lastQuestionTimestamp) {
    return;
  }
  
  // Update the last question timestamp
  if (data.timestamp) {
    TriviaState.lastQuestionTimestamp = data.timestamp;
  }
  
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
            
      fetch(`${TriviaState.getApiBaseUrl()}/score/${TriviaState.userId}`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
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
     * Display trivia question in UI
     * @param {Object} data - Question data
     */
    displayQuestion(data) {
      if (!data.question || !data.choices || !data.correctAnswer) {
        console.error("❌ Missing required question data:", data);
        TriviaState.questionRequested = false;
        return;
      }
      
      // Calculate duration with fallback
      const duration = data.duration || TriviaState.settings.answerTime || 30000;
      
      // Update global state
      TriviaState.questionStartTime = Date.now();
      TriviaState.currentQuestionDifficulty = data.difficulty || 'Medium';
      TriviaState.currentQuestionDuration = duration;
      TriviaState.triviaActive = true;
      TriviaState.questionRequested = false;
      
      // Update question text
      UI.questionText.textContent = data.question;
      UI.choicesContainer.innerHTML = "";
      
      // Reset timer bar
      UI.timerBar.style.transition = "none";
      UI.timerBar.style.width = "100%";
      
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
      
      // Start timer animation after a short delay
      setTimeout(() => {
        UI.timerBar.style.transition = `width ${duration / 1000}s linear`;
        UI.timerBar.style.width = "0%";
      }, 100);
      
      // Show question UI
      UI.setUIState("question");
      
      // Start timer for question
      TimerManager.startQuestionTimer(duration, data.correctAnswer);
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
     * Start timer for current question
     * @param {number} duration - Duration in milliseconds
     * @param {string} correctAnswer - Correct answer text
     */
    startQuestionTimer(duration, correctAnswer) {
      // Store current question timestamp to verify timer validity later
      const currentQuestionTime = TriviaState.questionStartTime;
      
      setTimeout(() => {
        // Check if we're still showing the same question
        if (TriviaState.questionStartTime !== currentQuestionTime) {
          return;
        }
                
        // Reveal answer
        QuestionManager.revealCorrectAnswer(correctAnswer);
        
        // Schedule transition back to countdown
        setTimeout(() => {
          const nextInterval = TriviaState.settings.intervalTime || 600000;
          this.transitionToCountdown(nextInterval);
        }, 5000);
      }, duration);
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
      
      // Update UI
      UI.setUIState("countdown");
      this.updateCountdown(intervalTime);
    },
    
    /**
     * Check if it's time to request the next question
     */
    checkForNextQuestion() {
      // Skip if trivia isn't active or if PubSub updated countdown
      if (!TriviaState.triviaActive || !TriviaState.nextQuestionTime || TriviaState.countdownUpdatedByPubSub) {
        return;
      }
      
      const timeRemaining = TriviaState.nextQuestionTime - Date.now();
      
      // Update local countdown
      this.updateCountdown(timeRemaining);
      
      // Request next question when time is up
      if (timeRemaining <= 0 && !TriviaState.questionRequested) {
        TriviaState.questionRequested = true;
        
        fetch(`${TriviaState.getApiBaseUrl()}/get-next-question`)
          .then(response => response.json())
          .then(data => {
            if (data.error) {
              console.warn(`⚠️ ${data.error}`);
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
            // Reset request flag after delay
            setTimeout(() => {
              TriviaState.questionRequested = false;
            }, 5000);
          });
      }
    }
  };

  /**
   * Handle countdown update message
   * @param {Object} data - Countdown data with timeRemaining
   */
  function handleCountdownUpdate(data) {
    
    if (!data.timeRemaining && data.timeRemaining !== 0) {
      console.warn("⚠️ Missing timeRemaining in countdown update");
      return;
    }
    
    // Update countdown flag to prevent duplicate updates
    TriviaState.countdownUpdatedByPubSub = true;
    
    // Update nextQuestionTime based on the timeRemaining from server
    TriviaState.nextQuestionTime = Date.now() + data.timeRemaining;
    
    // Update the UI with the new time
    UI.setUIState("countdown");
    TimerManager.updateCountdown(data.timeRemaining);
    
    // Reset flag after a short delay to allow local updates again
    setTimeout(() => {
      TriviaState.countdownUpdatedByPubSub = false;
    }, 2000);
  }

  /**
   * Handle trivia end message
   */
  function handleTriviaEnd() {
    TriviaState.triviaActive = false;
    TriviaState.nextQuestionTime = null;
    UI.setUIState("ended");
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
    initializeTwitchExtension();
  });