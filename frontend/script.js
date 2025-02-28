// --- Global Variables & Initialization ---
let userId = null;             // Twitch user ID
let questionStartTime = null;  // Timestamp when the current trivia question is shown
let triviaActive = false;      // Flag indicating an active trivia round
let nextQuestionTime = null;   // Track next trivia question time
let lastAnswerData = null;     // Removes the last answer difficulty tab
let questionRequested = false; // Prevents multiple requests
let triviaSettings = {
    answerTime: 30000,     // Default 30 seconds
    intervalTime: 600000   // Default 10 minutes
};
let currentQuestionDifficulty = null; // Stores current question difficulty
let currentQuestionDuration = null;   // Stores current question duration

// Retrieve Twitch User ID on authorization and fetch user score
window.Twitch.ext.onAuthorized((auth) => {
    console.log("✅ Extension authorized");
    userId = auth.userId;
    console.log("✅ User Authorized:", userId);
    
    // Fetch the user's score from the database
    fetchUserScore(userId);
});

// --- DOM Elements ---
const waitingScreen = document.getElementById("waiting-screen");
const quizContainer = document.getElementById("quiz-container");
const questionText = document.getElementById("question-text");
const choicesContainer = document.getElementById("choices-container");
const timerBar = document.getElementById("timer-bar");
const countdownTimer = document.getElementById("countdown-timer");

// ✅ Track whether PubSub is updating the countdown
let countdownUpdatedByPubSub = false;

// ✅ UI State Management Function
function setUIState(state) {
    console.log(`🎭 Setting UI state to: ${state}`);
    
    // Hide all screens first
    document.getElementById("waiting-screen").style.display = "none";
    document.getElementById("quiz-container").style.display = "none";
    document.getElementById("trivia-ended-screen").style.display = "none";
    
    // Show the appropriate screen
    switch (state) {
        case "waiting":
            document.getElementById("waiting-screen").style.display = "flex";
            document.getElementById("waiting-text").textContent = "Trivia has not started yet.";
            countdownTimer.style.display = "none";
            break;
        case "countdown":
            document.getElementById("waiting-screen").style.display = "flex";
            document.getElementById("waiting-text").textContent = "Next question in:";
            countdownTimer.style.display = "inline";
            break;
        case "question":
            document.getElementById("quiz-container").style.display = "flex";
            break;
        case "ended":
            document.getElementById("trivia-ended-screen").style.display = "block";
            break;
    }
}

// ✅ Listen for Twitch PubSub Messages
window.Twitch.ext.listen("broadcast", (target, contentType, message) => {
    console.log("📩 Received broadcast:", message);
    try {
        const data = JSON.parse(message);
        console.log("📢 Parsed broadcast data:", data);

        switch (data.type) {
            case "SETTINGS_UPDATE":
                console.log("⚙️ Updating Settings:", data);
                triviaSettings.answerTime = data.answerTime || triviaSettings.answerTime;
                triviaSettings.intervalTime = data.intervalTime || triviaSettings.intervalTime;
                break;

            case "TRIVIA_START":
                console.log("🚀 Trivia has started!");
                triviaActive = true;
                // Use the intervalTime from settings or data
                const intervalTime = data.intervalTime || triviaSettings.intervalTime || 600000;
                nextQuestionTime = Date.now() + intervalTime;
                setUIState("countdown");
                updateCountdown(intervalTime);
                break;

            case "TRIVIA_QUESTION":
                console.log("🎯 TRIVIA_QUESTION received!");
                questionRequested = false; // Reset request flag
                displayQuestion(data);
                break;

            case "COUNTDOWN_UPDATE":
                console.log(`⏳ COUNTDOWN_UPDATE: ${Math.round(data.timeRemaining / 1000)}s remaining`);
                // Set flag to prevent local updates conflicting with server updates
                countdownUpdatedByPubSub = true;
                nextQuestionTime = Date.now() + data.timeRemaining;
                updateCountdown(data.timeRemaining);
                
                // Reset the flag after a delay
                setTimeout(() => {
                    countdownUpdatedByPubSub = false;
                }, 2000);
                break;

            case "TRIVIA_END":
                console.log("⛔ Trivia has been ended by the broadcaster.");
                triviaActive = false;
                nextQuestionTime = null;
                setUIState("ended");
                break;

            default:
                console.warn("⚠️ Unknown broadcast type:", data.type);
                break;
        }
    } catch (err) {
        console.error("❌ Error parsing broadcast message:", err);
    }
});

// Update fetchUserScore function to handle both scores
function fetchUserScore(userId) {
    if (!userId) {
        console.warn("⚠ Cannot fetch score: User ID is missing");
        return;
    }
    
    console.log(`📊 Fetching score for user: ${userId}`);
    
    fetch(`/score/${userId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log(`🏆 Retrieved user scores from server:`, data);
            // Update both scores in the UI
            displayScores(data.totalScore || 0, data.sessionScore || 0);
        })
        .catch(error => {
            console.error("❌ Error fetching user score:", error);
            // Still display zeros on error
            displayScores(0, 0);
        });
}

// ✅ Improved countdown update function
function updateCountdown(timeRemaining) {
    if (!countdownTimer || isNaN(timeRemaining) || timeRemaining <= 0) {
        if (countdownTimer) {
            countdownTimer.textContent = "0:00";
        }
        return;
    }
    
    // Format time as MM:SS
    let minutes = Math.floor(timeRemaining / 60000);
    let seconds = Math.floor((timeRemaining % 60000) / 1000);
    
    countdownTimer.style.display = "inline";
    countdownTimer.textContent = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

// ✅ Improved interval timer for checking question timing
setInterval(() => {
    // Skip if trivia isn't active or if PubSub recently updated the countdown
    if (!triviaActive || !nextQuestionTime || countdownUpdatedByPubSub) {
        return;
    }

    const now = Date.now();
    const timeRemaining = nextQuestionTime - now;

    // Update the local countdown
    updateCountdown(timeRemaining);

    // Check if it's time to request the next question
    if (timeRemaining <= 0 && !questionRequested) {
        console.log("⏳ Countdown reached 0! Requesting next question...");
        questionRequested = true;
        
        fetch("/get-next-question")
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    console.warn(`⚠️ ${data.error}`);
                    // Reset the request flag after a short delay to prevent spam
                    setTimeout(() => {
                        questionRequested = false;
                    }, 5000);
                    return;
                }
                
                // If we got a valid question, display it
                displayQuestion(data);
            })
            .catch(error => {
                console.error("❌ Error fetching next question:", error);
                // Reset the request flag to allow retry
                setTimeout(() => {
                    questionRequested = false;
                }, 5000);
            });
    }
}, 1000);

// ✅ Improved displayQuestion function
function displayQuestion(data) {
    console.log("📢 displayQuestion() called with data:", data);
    
    if (!data.question || !data.choices || !data.correctAnswer) {
        console.error("❌ Missing required trivia data fields:", data);
        return;
    }

    // Calculate duration with fallback
    const duration = data.duration || triviaSettings.answerTime || 30000;
    
    // Store current question information globally
    currentQuestionDifficulty = data.difficulty || 'Medium';
    currentQuestionDuration = duration;
    
    triviaActive = true;
    questionStartTime = Date.now();
    questionRequested = false; // Reset flag
    
    // Update UI
    questionText.textContent = data.question;
    choicesContainer.innerHTML = "";
    
    // Reset timer bar
    timerBar.style.transition = "none";
    timerBar.style.width = "100%";

    // Remove any existing difficulty indicators
    const existingIndicators = document.querySelectorAll('.difficulty-indicator');
    existingIndicators.forEach(indicator => indicator.remove());

    // Add difficulty indicator if available
    if (data.difficulty) {
        const difficultyIndicator = document.createElement("div");
        difficultyIndicator.className = "difficulty-indicator " + data.difficulty.toLowerCase();
        difficultyIndicator.textContent = data.difficulty;
        questionText.parentNode.insertBefore(difficultyIndicator, questionText);
    }

    // Create buttons for each choice
    data.choices.forEach((choice) => {
        const button = document.createElement("button");
        button.classList.add("choice-button");
        button.textContent = choice;
        button.onclick = () => selectAnswer(button, choice, data.correctAnswer);
        choicesContainer.appendChild(button);
    });

    // Start timer animation
    setTimeout(() => {
        timerBar.style.transition = `width ${duration / 1000}s linear`;
        timerBar.style.width = "0%";
    }, 100);

    // Show the question screen
    setUIState("question");
    
    // Start the answer timer
    startTriviaTimer(duration, data.correctAnswer);
}

// ✅ Improved transitionToCountdown function
function transitionToCountdown(intervalTime) {
    console.log("🎭 Transitioning to countdown screen...");
    
    // Validate interval time with fallbacks
    if (!intervalTime || isNaN(intervalTime)) {
        intervalTime = triviaSettings.intervalTime || 600000; // Default to 10 minutes
    }
    
    triviaActive = true;
    nextQuestionTime = Date.now() + intervalTime;
    
    // Set UI state and start countdown
    setUIState("countdown");
    updateCountdown(intervalTime);
}

// ✅ Improved startTriviaTimer function
function startTriviaTimer(duration, correctAnswer) {
    console.log(`⏳ Starting trivia timer for duration: ${duration}ms`);
    
    // Use the current question timestamp to verify timer validity
    const currentQuestionTime = questionStartTime;
    
    setTimeout(() => {
        // Check if we're still showing the same question
        if (questionStartTime !== currentQuestionTime) {
            console.log("⚠️ Question changed, not revealing answers");
            return;
        }
        
        console.log("⌛ Time's up! Revealing correct answer...");
        
        // Mark correct and incorrect answers
        const buttons = document.querySelectorAll(".choice-button");
        buttons.forEach((btn) => {
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

        // Now that timer has ended, show points info if we have it
        if (lastAnswerData && lastAnswerData.pointsEarned > 0) {
            const pointsInfo = document.createElement("div");
            pointsInfo.className = "points-info";
            pointsInfo.innerHTML = `
                <span class="points">+${lastAnswerData.pointsEarned} points!</span>
                <span class="time-bonus">${lastAnswerData.timePercentage}% time bonus</span>
            `;
            lastAnswerData.button.parentNode.appendChild(pointsInfo);
            
            // Clear the data after using it
            lastAnswerData = null;
        }

        console.log("🔄 Returning to countdown screen in 5 seconds...");

        // After 5 seconds, transition back to countdown screen
        setTimeout(() => {
            // Transition to countdown with next interval
            const nextInterval = triviaSettings.intervalTime || 600000;
            transitionToCountdown(nextInterval);
        }, 5000);
    }, duration);
}

// Update displayScore to handle both total and session scores
function displayScores(totalScore, sessionScore) {
    // Find or create score elements
    const scoreContainer = document.getElementById("user-score");
    
    if (scoreContainer) {
        // Format scores nicely
        const formattedTotal = Number(totalScore).toLocaleString();
        const formattedSession = Number(sessionScore).toLocaleString();
        
        // Create HTML with both scores
        scoreContainer.innerHTML = `
            <div class="total-score">Total Score: ${formattedTotal}</div>
            <div class="session-score">Session Score: ${formattedSession}</div>
        `;
        
        console.log(`🏆 Scores updated: Total=${formattedTotal}, Session=${formattedSession}`);
    } else {
        console.error("❌ Score container not found!");
        
        // Try again after a short delay
        setTimeout(() => {
            const retryElement = document.getElementById("user-score");
            if (retryElement) {
                const formattedTotal = Number(totalScore).toLocaleString();
                const formattedSession = Number(sessionScore).toLocaleString();
                
                retryElement.innerHTML = `
                    <div class="total-score">Total Score: ${formattedTotal}</div>
                    <div class="session-score">Session Score: ${formattedSession}</div>
                `;
                console.log(`🏆 Scores updated on retry: Total=${totalScore}, Session=${sessionScore}`);
            }
        }, 500);
    }
}


// Update selectAnswer function to handle both scores
function selectAnswer(button, selectedChoice, correctAnswer) {
    if (!userId) {
        console.warn("⚠ User ID missing. Cannot track score.");
        return;
    }
    
    console.log("User selected:", selectedChoice, " | Correct answer:", correctAnswer);
    
    // Disable all buttons to prevent multiple selections
    const buttons = document.querySelectorAll(".choice-button");
    buttons.forEach((btn) => btn.disabled = true);
    
    // Mark the selected button
    button.classList.add("selected");
    button.dataset.selected = "true";
    button.dataset.isCorrect = selectedChoice === correctAnswer ? "true" : "false";

    // Calculate response time
    const answerTime = Date.now() - questionStartTime;
    console.log(`📩 User ${userId} answered in ${answerTime}ms (Difficulty: ${currentQuestionDifficulty})`);

    // Submit answer to server
    fetch("/submit-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            userId,
            selectedAnswer: selectedChoice,
            correctAnswer,
            answerTime,
            difficulty: currentQuestionDifficulty,
            duration: currentQuestionDuration
        }),
    })
    .then(response => response.json())
    .then(data => {
        console.log("🏆 Score updated!", data);
        // Update both scores
        displayScores(data.totalScore || 0, data.sessionScore || 0);
        
        // Store the answer data for later display when timer ends
        if (data.pointsEarned > 0) {
            lastAnswerData = {
                button: button,
                pointsEarned: data.pointsEarned,
                timePercentage: data.timePercentage
            };
        }
    })
    .catch(error => console.error("❌ Error submitting answer:", error));
}

// Initialize UI in waiting state
setUIState("waiting");