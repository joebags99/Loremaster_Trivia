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
  questionEndTime: null,            // When the current question ended
  nextQuestionTime: null,           // When the next question will appear
  questionRequested: false,         // Flag to prevent duplicate question requests
  lastAnswerData: null,             // Data from last answer for display
  countdownUpdatedByPubSub: false,  // Flag to track PubSub countdown updates
  currentQuestionDifficulty: null,  // Current question difficulty level
  currentQuestionDuration: null,    // Current question duration
  countdownAlertShown: false,       // Flag to track if 60-second alert was shown
  
  // Visibility control settings
  visibilitySettings: {
    countdownShowSeconds: 60,       // Show overlay this many seconds before question
    resultDisplaySeconds: 5         // Keep overlay visible this many seconds after question
  },
  
  // Default settings
  settings: {
    answerTime: 30000,              // Default: 30 seconds
    intervalTime: 600000            // Default: 10 minutes
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

  /**
 * Fix timer bar animation with guaranteed reflow and multiple animation techniques
 * @param {number} duration - Duration in milliseconds
 */
function fixTimerBarAnimation(duration) {
  const timerBar = document.getElementById('timer-bar');
  if (!timerBar) {
    console.error("Timer bar element not found");
    return;
  }
  
  console.log('Fixing timer animation with duration:', duration);
  
  // Clear any existing transitions or animations
  timerBar.style.transition = 'none';
  timerBar.style.animation = 'none';
  timerBar.style.width = '100%';
  
  // Force multiple reflows to ensure style changes take effect
  void timerBar.offsetWidth;
  void timerBar.getBoundingClientRect();
  
  // For debugging - log the current computed width
  const computedStyle = window.getComputedStyle(timerBar);
  console.log('Timer bar width before animation:', computedStyle.width);
  
  // Try multiple animation techniques
  
  // 1. CSS Transition
  setTimeout(() => {
    timerBar.style.transition = `width ${duration/1000}s linear`;
    timerBar.style.width = '0%';
    console.log('Timer animation started via transition');
  }, 20);
  
  // 2. CSS Animation as fallback
  setTimeout(() => {
    // Check if width hasn't changed, suggesting transition failed
    const newWidth = parseFloat(window.getComputedStyle(timerBar).width);
    const originalWidth = parseFloat(computedStyle.width);
    
    if (Math.abs(newWidth - originalWidth) < 5) { // If barely changed
      console.log('Transition may have failed, applying animation fallback');
      
      // Create and apply keyframe animation
      const styleId = 'timer-animation-style';
      let styleEl = document.getElementById(styleId);
      
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      
      styleEl.textContent = `
        @keyframes timerShrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `;
      
      timerBar.style.transition = 'none';
      timerBar.style.animation = `timerShrink ${duration/1000}s linear forwards`;
    }
  }, 100);
}
  
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
  
  // Set next question time but don't show timer yet
  const intervalTime = data.intervalTime || TriviaState.settings.intervalTime;
  TriviaState.nextQuestionTime = Date.now() + intervalTime;
  
  // Update UI state but don't show timer immediately
  UI.setUIState("countdown");
  
  // Hide the timer initially
  if (UI.countdownTimer) {
    UI.countdownTimer.style.display = "none";
  }
  
  // Wait briefly for the correct time to arrive from server
  setTimeout(() => {
    // Calculate the current time remaining
    const currentTime = TriviaState.nextQuestionTime - Date.now();
    TimerManager.updateCountdown(currentTime);
    
    // Now show the timer with correct value
    if (UI.countdownTimer) {
      UI.countdownTimer.style.display = "inline";
    }
  }, 500); // Half-second delay
}

/**
 * Handle trivia question message from broadcast
 * This is now the exclusive source of questions for all clients
 * @param {Object} data - Question data
 */
function handleTriviaQuestion(data) {
  
  // Validate essential question data
  if (!data.question || !data.choices || !data.correctAnswer) {
    console.error("❌ Received incomplete question data:", data);
    return;
  }
  
  // Track the last question timestamp to detect duplicates
  if (!TriviaState.lastQuestionTimestamp) {
    TriviaState.lastQuestionTimestamp = 0;
  }
  
  // Check for duplicate question based on timestamp
  if (data.timestamp && data.timestamp <= TriviaState.lastQuestionTimestamp) {
    console.warn(`⚠️ Detected duplicate question (timestamp: ${data.timestamp}). Ignoring.`);
    return;
  }
  
  // Update the last question timestamp
  if (data.timestamp) {
    TriviaState.lastQuestionTimestamp = data.timestamp;
  }
  
  // Clear any pending question requested flags
  TriviaState.questionRequested = false;
  
  // Log difficulty and question ID if available
  if (data.difficulty || data.questionId) {
  }
  
  // Display the question to the user
  QuestionManager.displayQuestion(data);
}

/**
 * Handle trivia end message
 */
function handleTriviaEnd() {
  TriviaState.triviaActive = false;
  TriviaState.nextQuestionTime = null;
  
  // Check if countdown alert is visible and animate it out
  const countdownAlert = document.getElementById('countdown-alert');
  if (countdownAlert && countdownAlert.classList.contains('visible')) {
    // Apply exit animation
    countdownAlert.classList.remove('visible');
    countdownAlert.classList.add('exit');
    
    // Remove the element after animation completes
    setTimeout(() => {
      countdownAlert.classList.remove('exit');
      countdownAlert.style.display = 'none';
    }, 700); // Match animation duration
  }
  
  // Reset the flag to allow future alerts
  TriviaState.countdownAlertShown = false;
  
  // Change UI state to ended
  UI.setUIState("ended");
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

  /**
 * 🧙‍♂️ Loremaster Trivia - Magical UI Effects
 * Add these functions to your script.js file to enhance the UI with magical interactions
 */

// Initialize all magical effects
function initMagicalEffects() {
  
  // Only initialize if we're not on a mobile device
  if (window.innerWidth > 768) {
    addButtonSparkles();
    addHoverEffects();
    addMagicCursor();
  }
  
  // These effects work well on all devices
  addEntranceAnimations();
  improveTimerAnimation();
}

// Add magical sparkle effects to buttons
function addButtonSparkles() {
  const buttons = document.querySelectorAll('.choice-button, button');
  
  buttons.forEach(button => {
    button.addEventListener('mousemove', (e) => {
      // Only create sparkles occasionally for performance
      if (Math.random() > 0.8) {
        createSparkle(e, button);
      }
    });
    
    // Add extra sparkles on click
    button.addEventListener('click', (e) => {
      // Create multiple sparkles on click
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          createSparkle(e, button, true);
        }, i * 50);
      }
    });
  });
}

// Create a single sparkle element
function createSparkle(e, parent, isClick = false) {
  const sparkle = document.createElement('span');
  sparkle.className = 'magical-sparkle';
  
  // Position at mouse coordinates relative to parent
  const rect = parent.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  sparkle.style.left = x + 'px';
  sparkle.style.top = y + 'px';
  
  // Randomize size slightly
  const size = Math.random() * 4 + 2;
  sparkle.style.width = size + 'px';
  sparkle.style.height = size + 'px';
  
  // Add randomized movement
  const angle = Math.random() * Math.PI * 2;
  const distance = isClick ? Math.random() * 80 + 20 : Math.random() * 40 + 10;
  sparkle.style.setProperty('--tx', Math.cos(angle) * distance + 'px');
  sparkle.style.setProperty('--ty', Math.sin(angle) * distance + 'px');
  
  // Add randomized color for click sparkles
  if (isClick) {
    const hue = Math.random() * 60 + 40; // Gold-ish range
    sparkle.style.background = `hsl(${hue}, 100%, 75%)`;
    sparkle.style.boxShadow = `0 0 4px hsl(${hue}, 100%, 75%)`;
  }
  
  // Add to parent and remove after animation completes
  parent.appendChild(sparkle);
  setTimeout(() => {
    sparkle.remove();
  }, 1500);
}

// Add subtle hover effects to UI elements
function addHoverEffects() {
  // Add hover glow to difficulty indicators
  const difficultyIndicators = document.querySelectorAll('.difficulty-indicator');
  difficultyIndicators.forEach(indicator => {
    indicator.addEventListener('mouseenter', () => {
      indicator.style.transform = 'scale(1.05)';
      indicator.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.3)';
    });
    
    indicator.addEventListener('mouseleave', () => {
      indicator.style.transform = 'scale(1)';
      indicator.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.2)';
    });
  });
  
  // Make the question box pulse subtly when hovered
  const questionBox = document.getElementById('question-box');
  if (questionBox) {
    questionBox.addEventListener('mouseenter', () => {
      questionBox.style.boxShadow = '0 0 30px rgba(106, 61, 232, 0.4)';
      questionBox.style.borderColor = '#9b7aff';
    });
    
    questionBox.addEventListener('mouseleave', () => {
      questionBox.style.boxShadow = '0 0 20px rgba(106, 61, 232, 0.3)';
      questionBox.style.borderColor = '';
    });
  }
}

// Add magical following cursor effect
function addMagicCursor() {
  // Create cursor elements
  const cursorOuter = document.createElement('div');
  cursorOuter.className = 'cursor-outer';
  cursorOuter.style.cssText = `
    position: fixed;
    width: 30px;
    height: 30px;
    border: 2px solid rgba(155, 122, 255, 0.5);
    border-radius: 50%;
    pointer-events: none;
    transform: translate(-50%, -50%);
    z-index: 9999;
    transition: width 0.2s, height 0.2s, border-color 0.2s;
    mix-blend-mode: difference;
  `;
  
  const cursorInner = document.createElement('div');
  cursorInner.className = 'cursor-inner';
  cursorInner.style.cssText = `
    position: fixed;
    width: 8px;
    height: 8px;
    background-color: rgba(255, 204, 0, 0.8);
    border-radius: 50%;
    pointer-events: none;
    transform: translate(-50%, -50%);
    z-index: 9999;
    transition: width 0.1s, height 0.1s, background-color 0.1s;
  `;
  
  document.body.appendChild(cursorOuter);
  document.body.appendChild(cursorInner);
  
  // Update cursor position with smoothing
  document.addEventListener('mousemove', (e) => {
    // Update inner cursor immediately
    cursorInner.style.left = e.clientX + 'px';
    cursorInner.style.top = e.clientY + 'px';
    
    // Update outer cursor with a slight delay for trailing effect
    setTimeout(() => {
      cursorOuter.style.left = e.clientX + 'px';
      cursorOuter.style.top = e.clientY + 'px';
    }, 50);
  });
  
  // Add interactive effects
  document.addEventListener('mousedown', () => {
    cursorOuter.style.width = '25px';
    cursorOuter.style.height = '25px';
    cursorOuter.style.borderColor = 'rgba(255, 204, 0, 0.8)';
    
    cursorInner.style.width = '6px';
    cursorInner.style.height = '6px';
    cursorInner.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
  });
  
  document.addEventListener('mouseup', () => {
    cursorOuter.style.width = '30px';
    cursorOuter.style.height = '30px';
    cursorOuter.style.borderColor = 'rgba(155, 122, 255, 0.5)';
    
    cursorInner.style.width = '8px';
    cursorInner.style.height = '8px';
    cursorInner.style.backgroundColor = 'rgba(255, 204, 0, 0.8)';
  });
  
  // Enhance cursor over interactive elements
  document.querySelectorAll('button, .choice-button, input').forEach(element => {
    element.addEventListener('mouseenter', () => {
      cursorOuter.style.width = '40px';
      cursorOuter.style.height = '40px';
      cursorOuter.style.borderColor = 'rgba(255, 204, 0, 0.8)';
      cursorOuter.style.mixBlendMode = 'normal';
    });
    
    element.addEventListener('mouseleave', () => {
      cursorOuter.style.width = '30px';
      cursorOuter.style.height = '30px';
      cursorOuter.style.borderColor = 'rgba(155, 122, 255, 0.5)';
      cursorOuter.style.mixBlendMode = 'difference';
    });
  });
  
  // Hide default cursor
  document.body.style.cursor = 'none';
  
  // Also hide default cursor on all interactive elements
  document.querySelectorAll('button, .choice-button, input, a').forEach(element => {
    element.style.cursor = 'none';
  });
}

// Add magical entrance animations to UI elements
function addEntranceAnimations() {
  // Animate question appearance
  if (QuestionManager && QuestionManager.displayQuestion) {
    // Store the original function
    const originalDisplayQuestion = QuestionManager.displayQuestion;
    
    // Override with animated version
    QuestionManager.displayQuestion = function(data) {
      originalDisplayQuestion.call(this, data);
      
      // Add animations after original function renders elements
      animateQuestionAppearance();
    };
  }
  
  // Add special animations when correct answer is revealed
  if (QuestionManager && QuestionManager.revealCorrectAnswer) {
    // Store the original function
    const originalRevealCorrectAnswer = QuestionManager.revealCorrectAnswer;
    
    // Override with animated version
    QuestionManager.revealCorrectAnswer = function(correctAnswer) {
      originalRevealCorrectAnswer.call(this, correctAnswer);
      
      // Add special animations after correct answer is revealed
      animateCorrectAnswerReveal(correctAnswer);
    };
  }
}

// Animate question appearance
function animateQuestionAppearance() {
  // Animate question text
  const questionText = document.getElementById('question-text');
  if (questionText) {
    questionText.style.opacity = '0';
    questionText.style.transform = 'translateY(-10px)';
    
    setTimeout(() => {
      questionText.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
      questionText.style.opacity = '1';
      questionText.style.transform = 'translateY(0)';
    }, 100);
  }
  
  // Animate choice buttons one by one
  const choiceButtons = document.querySelectorAll('.choice-button');
  choiceButtons.forEach((button, index) => {
    button.style.opacity = '0';
    button.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
      button.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
      button.style.opacity = '1';
      button.style.transform = 'translateY(0)';
    }, 200 + index * 100);
  });
}

// Animate correct answer reveal with magical effects
function animateCorrectAnswerReveal(correctAnswer) {
  // Find the correct button
  const buttons = document.querySelectorAll('.choice-button');
  buttons.forEach(btn => {
    if (btn.textContent === correctAnswer && btn.classList.contains('correct')) {
      // Add starburst effect around correct answer
      createStarburst(btn);
    }
  });
}

// Create starburst effect for correct answer
function createStarburst(element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // Create starburst container
  const starburst = document.createElement('div');
  starburst.style.cssText = `
    position: fixed;
    top: ${centerY}px;
    left: ${centerX}px;
    transform: translate(-50%, -50%);
    width: 0;
    height: 0;
    z-index: 9998;
    pointer-events: none;
  `;
  
  document.body.appendChild(starburst);
  
  // Create rays
  const rayCount = 12;
  for (let i = 0; i < rayCount; i++) {
    const ray = document.createElement('div');
    const angle = (i / rayCount) * Math.PI * 2;
    const length = 30 + Math.random() * 20;
    
    ray.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      background: linear-gradient(90deg, #ffcc00, transparent);
      height: 2px;
      width: ${length}px;
      transform: rotate(${angle}rad);
      transform-origin: left center;
      opacity: 0;
      animation: rayGrow 0.5s ease-out forwards;
    `;
    
    starburst.appendChild(ray);
  }
  
  // Add CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes rayGrow {
      0% { opacity: 0; width: 0; }
      50% { opacity: 1; }
      100% { opacity: 0; width: 80px; }
    }
  `;
  
  document.head.appendChild(style);
  
  // Remove starburst after animation
  setTimeout(() => {
    starburst.remove();
    style.remove();
  }, 1000);
}

// Improve timer animation with pulsating effect
function improveTimerAnimation() {
  const timerBar = document.getElementById('timer-bar');
  if (!timerBar) return;
  
  // Add pulsating glow when time is running low
  const originalWidth = getComputedStyle(timerBar).width;
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'style') {
        const width = parseFloat(timerBar.style.width);
        
        // When timer is below 30%, add urgency effects
        if (width <= 30 && width > 0) {
          timerBar.style.boxShadow = '0 0 15px rgba(255, 0, 0, 0.7)';
          timerBar.style.background = 'linear-gradient(90deg, #ff4757, #ff6b6b)';
          
          // Add pulsating animation
          if (!timerBar.classList.contains('pulsating')) {
            timerBar.classList.add('pulsating');
            
            // Add keyframes for pulsating effect if not already added
            if (!document.getElementById('timer-pulse-keyframes')) {
              const keyframes = document.createElement('style');
              keyframes.id = 'timer-pulse-keyframes';
              keyframes.textContent = `
                @keyframes timerPulse {
                  0% { opacity: 1; }
                  50% { opacity: 0.7; }
                  100% { opacity: 1; }
                }
                
                .pulsating {
                  animation: timerPulse 0.5s infinite !important;
                }
              `;
              document.head.appendChild(keyframes);
            }
          }
        } else {
          // Reset to normal style
          timerBar.style.boxShadow = '';
          timerBar.style.background = '';
          timerBar.classList.remove('pulsating');
        }
      }
    });
  });
  
  // Start observing the timer
  observer.observe(timerBar, { attributes: true });
}
  
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
  // Store question end time for visibility control
  TriviaState.questionEndTime = Date.now();
  
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

// Initialize question progress state variable
let questionInProgress = false;

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
  
  // Clear any previous question end time
  TriviaState.questionEndTime = null;
  
  // Set question in progress flag
  questionInProgress = true;
  
  setTimeout(() => {
    // Check if we're still showing the same question
    if (TriviaState.questionStartTime !== currentQuestionTime) {
      return;
    }
    
    // Reveal answer
    QuestionManager.revealCorrectAnswer(correctAnswer);
    
    // Reset question in progress flag
    questionInProgress = false;
    
    // Schedule transition back to countdown
    setTimeout(() => {
      const nextInterval = TriviaState.settings.intervalTime || 600000;
      this.transitionToCountdown(nextInterval);
    }, TriviaState.visibilitySettings.resultDisplaySeconds * 1000);
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
    
    // Reset countdown alert flag when transitioning to a new countdown
    TriviaState.countdownAlertShown = false;
    
    // Update UI
    UI.setUIState("countdown");
    this.updateCountdown(intervalTime);
  },
  
  /**
   * Check and update countdown display
   * NOTE: This function has been modified to remove client-side question polling.
   * Questions are now received exclusively through Twitch PubSub broadcasts.
   */
  checkForNextQuestion() {
    // Skip if trivia isn't active or if countdown time isn't set
    if (!TriviaState.triviaActive || !TriviaState.nextQuestionTime) {
      return;
    }
    
    const timeRemaining = TriviaState.nextQuestionTime - Date.now();
    
    // Update local countdown display
    this.updateCountdown(timeRemaining);
    
    // When time is up, just log that we're waiting for server broadcast
    if (timeRemaining <= 0 && !TriviaState.questionRequested) {
      // Set this flag to prevent multiple log messages
      TriviaState.questionRequested = true;
      
      // Reset the flag after some time in case the broadcast is delayed
      setTimeout(() => {
        TriviaState.questionRequested = false;
      }, 5000);
    }
  },

  showCountdownAlert() {
    // Create overlay element if it doesn't exist
    let alertOverlay = document.getElementById('countdown-alert');
    if (!alertOverlay) {
      alertOverlay = document.createElement('div');
      alertOverlay.id = 'countdown-alert';
      alertOverlay.className = 'countdown-alert';
      alertOverlay.innerHTML = `
        <div class="alert-content">
          <div class="alert-icon">⏰</div>
          <div class="alert-text">Question Starting Soon!</div>
          <div class="alert-subtext">Get ready - 30 seconds remaining</div>
        </div>
      `;
      document.body.appendChild(alertOverlay);
    } else {
      // Reset any existing classes
      alertOverlay.classList.remove('exit');
      alertOverlay.style.display = '';
    }
    
    // Show the overlay
    setTimeout(() => {
      alertOverlay.classList.add('visible');
    }, 10);
    
    // Hide overlay after 4 seconds
    setTimeout(() => {
      if (alertOverlay.classList.contains('visible')) {
        alertOverlay.classList.remove('visible');
        alertOverlay.classList.add('exit');
        
        // Clean up after animation completes
        setTimeout(() => {
          alertOverlay.classList.remove('exit');
        }, 500);
      }
    }, 4000);
  }
};

// Store original updateCountdown function
const originalUpdateCountdown = TimerManager.updateCountdown;

// Override with enhanced version that updates visibility
TimerManager.updateCountdown = function(timeRemaining) {
  // Call the original function first
  originalUpdateCountdown.call(this, timeRemaining);
  
  // Update app visibility based on time remaining
  updateAppVisibility(timeRemaining);
};

/**
 * Show or hide app container based on countdown time
 * @param {number} timeRemaining - Time remaining in milliseconds
 */
function updateAppVisibility(timeRemaining) {
  const appContainer = document.getElementById('app');
  
  if (!appContainer) return;
  
  // Show countdown when less than 15 seconds remain (changed from 60)
  const showCountdownThreshold = 15000; // 15 seconds
  
  // Only show the app during active questions or during countdown threshold
  const showDuringQuestion = questionInProgress;
  const showDuringCountdown = timeRemaining <= showCountdownThreshold && timeRemaining > 0;
  
  // After a question finishes, keep it visible for result display period
  const resultDisplayPeriod = 5000; // 5 seconds
  const currentTime = Date.now();
  const questionJustEnded = TriviaState.questionEndTime && 
                          (currentTime - TriviaState.questionEndTime < resultDisplayPeriod);
  
  // Debug visibility state
  console.log(`Visibility check: Question in progress: ${showDuringQuestion}, Countdown: ${showDuringCountdown}, Just ended: ${questionJustEnded}, Time remaining: ${Math.round(timeRemaining/1000)}s`);
  
  if (showDuringQuestion || showDuringCountdown || questionJustEnded) {
    // Show the app with slide-in animation
    if (!appContainer.classList.contains('visible')) {
      console.log("Sliding in trivia container");
      appContainer.classList.add('visible');
      
      // If this is the countdown warning and we haven't shown the alert yet
      // UPDATED: Changed 15000 to 30000 to show alert at 30 seconds
      if (showDuringCountdown && !TriviaState.countdownAlertShown && 
          timeRemaining <= 30000 && timeRemaining > 25000) {
        // Show countdown alert
        if (TimerManager.showCountdownAlert) {
          // Customize alert for 30 seconds
          const alertOverlay = document.getElementById('countdown-alert');
          if (alertOverlay) {
            const alertSubtext = alertOverlay.querySelector('.alert-subtext');
            if (alertSubtext) {
              alertSubtext.textContent = 'Get ready - 30 seconds remaining';
            }
          }
          TimerManager.showCountdownAlert();
        }
        TriviaState.countdownAlertShown = true;
      }
    }
  } else {
    // Hide when no countdown is active and no question is in progress
    if (appContainer.classList.contains('visible')) {
      console.log("Sliding out trivia container");
      appContainer.classList.remove('visible');
    }
  }
}


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
  
  // Single consolidated DOMContentLoaded handler
document.addEventListener("DOMContentLoaded", () => {
  // Initialize Twitch extension
  initializeTwitchExtension();
  
  // Initialize app visibility
  const appContainer = document.getElementById('app');
  if (appContainer) {
    // Force initial state to be hidden
    appContainer.classList.remove('visible');
    appContainer.style.right = '-360px'; // Ensure it's off-screen
    
    // Listen for CSS transition end to ensure it's fully hidden
    appContainer.addEventListener('transitionend', function(e) {
      if (!appContainer.classList.contains('visible')) {
        // Extra assurance it's fully off-screen when hidden
        appContainer.style.right = '-360px';
      }
    });
  }
  
  // Store original displayQuestion function
  const originalDisplayQuestion = QuestionManager.displayQuestion;
  
  // Override with enhanced version that ensures app visibility
  QuestionManager.displayQuestion = function(data) {
    // Set question in progress flag
    questionInProgress = true;
    
    // Show the app container for questions
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.classList.add('visible');
    }
    
    // Call the original function
    originalDisplayQuestion.call(this, data);
    
    // Fix timer bar animation after original function call
    const duration = data.duration || TriviaState.settings.answerTime || 30000;
    fixTimerBarAnimation(duration);
  };
  
  // Also modify the transition to countdown to reset the question flag
  const originalTransitionToCountdown = TimerManager.transitionToCountdown;
  TimerManager.transitionToCountdown = function(intervalTime) {
    // Reset question in progress flag
    questionInProgress = false;
    
    // Update visibility based on new interval time
    updateAppVisibility(intervalTime);
    
    // Call original function
    originalTransitionToCountdown.call(this, intervalTime);
  };
  
  // Initialize magical effects after a short delay to ensure UI is ready
  setTimeout(initMagicalEffects, 500);
  
  // Check initial visibility state after everything is initialized
  setTimeout(() => {
    if (TriviaState && TriviaState.nextQuestionTime) {
      const timeRemaining = TriviaState.nextQuestionTime - Date.now();
      updateAppVisibility(timeRemaining);
    }
  }, 1000);
});