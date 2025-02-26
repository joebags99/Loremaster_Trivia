// --- Global Variables & Initialization ---
let userId = null;             // Twitch user ID
let questionStartTime = null;  // Timestamp when the current trivia question is shown
let triviaActive = false;      // Flag indicating an active trivia round
let nextQuestionTime = null;   // 🔥 Track next trivia question time
let triviaSettings = []; //

// Retrieve Twitch User ID on authorization
window.Twitch.ext.onAuthorized((auth) => {
    console.log("✅ Extension authorized");
    userId = auth.userId;
    console.log("✅ User Authorized:", userId);
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

// ✅ Listen for Twitch PubSub Messages
window.Twitch.ext.listen("broadcast", (target, contentType, message) => {
    console.log("📩 Received broadcast:", message);
    try {
        const data = JSON.parse(message);
        console.log("📢 Parsed broadcast data:", data);

        switch (data.type) {
            case "SETTINGS_UPDATE":
                console.log("Updating Settings...");
                triviaSettings = data;
                console.log(triviaSettings);
                break;

            case "TRIVIA_START":
                console.log("🚀 Trivia has started! Switching to 'Next question in:' screen...");
                console.log(triviaSettings);
                transitionToCountdown(triviaSettings.intervalTime);
                break;

            case "TRIVIA_QUESTION":
                console.log("🎯 TRIVIA_QUESTION received! Displaying question now.");
                console.log("bullshit"+triviaSettings);
                console.log("bullshit data"+data);
                displayQuestion(data);
                break;

            case "COUNTDOWN_UPDATE":
                console.log(`⏳ COUNTDOWN_UPDATE received! Time remaining: ${data.timeRemaining / 1000} seconds`);
                countdownUpdatedByPubSub = true; // ✅ Prevent duplicate updates
                updateCountdown(data.timeRemaining);
                
                // ✅ Reset the flag after 2 seconds to allow local updates if needed
                setTimeout(() => {
                    countdownUpdatedByPubSub = false;
                }, 2000);
                break;

            case "TRIVIA_END":
                console.log("⛔ Trivia has been ended by the broadcaster.");
                transitionToWaitingScreen();
                break;

            default:
                console.warn("⚠️ Unknown broadcast type:", data.type);
                break;
        }
    } catch (err) {
        console.error("❌ Error parsing broadcast message:", err);
    }
});

// ✅ Transition Viewer to "Next Question In" Countdown Screen
function transitionToCountdown(intervalTime) {
    console.log("🎭 Transitioning to 'Next question in:' countdown screen...");

    // ✅ Ensure the waiting screen is shown with correct text
    const waitingText = document.getElementById("waiting-text");
    document.getElementById("waiting-screen").style.display = "flex";
    waitingText.textContent = "Next question in:";
    countdownTimer.style.display = "inline"; // Show countdown

    // ✅ Hide other screens
    document.getElementById("quiz-container").style.display = "none";
    document.getElementById("trivia-ended-screen").style.display = "none";

    triviaActive = true; // ✅ Trivia is now running
    console.log("im here...");

    // ✅ Validate & Set Next Question Time
    if (!intervalTime || isNaN(intervalTime)) {
        console.error("❌ Invalid intervalTime received:", intervalTime);
        intervalTime = triviaSettings?.intervalTime || 600000; // ✅ Fallback to default 10 minutes
    }

    nextQuestionTime = Date.now() + intervalTime;
    updateCountdown(intervalTime); // ✅ Start countdown immediately
}

// ✅ Transition Back to "Trivia has not started yet."
function transitionToWaitingScreen() {
    console.log("↩ Returning to 'Trivia has not started yet.' screen...");

    const waitingText = document.getElementById("waiting-text");

    document.getElementById("waiting-screen").style.display = "flex";
    waitingText.textContent = "Trivia has not started yet.";
    countdownTimer.style.display = "none"; // Hide countdown

    document.getElementById("quiz-container").style.display = "none";
    document.getElementById("trivia-ended-screen").style.display = "none";

    triviaActive = false; // ✅ Reset trivia state
    nextQuestionTime = null; // ✅ Clear countdown tracking
}

// ✅ Modified updateCountdown function
function updateCountdown(timeRemaining) {
    if (!countdownTimer || isNaN(timeRemaining) || timeRemaining <= 0) {
        countdownTimer.textContent = "0:00"; 
        return;
    }
    
    let minutes = Math.floor(timeRemaining / 60000);
    let seconds = Math.floor((timeRemaining % 60000) / 1000);
    
    if (!countdownUpdatedByPubSub) { // ✅ Only update if PubSub isn’t handling it
        countdownTimer.style.display = "inline";
        countdownTimer.textContent = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
    }
}

let questionRequested = false; // ✅ Prevents multiple requests

// ✅ Start Continuous Countdown Timer
setInterval(() => {
    if (!triviaActive || !nextQuestionTime || countdownUpdatedByPubSub) return; // ✅ Prevents conflict with PubSub updates

    const now = Date.now();
    let timeRemaining = nextQuestionTime - now;

    if (isNaN(timeRemaining) || timeRemaining <= 0) {
        if (!questionRequested) { // ✅ Prevent duplicate requests
            console.log("⏳ Countdown expired, switching to question...");
            countdownTimer.textContent = "0:00";
            questionRequested = true; // ✅ Stops further requests

            // ✅ Fetch the next trivia question
            fetch("/get-next-question")
            .then(response => response.json())
            .then(data => {
                if (!data.question || !data.choices || !data.correctAnswer) {
                    console.warn(`⚠️ Trivia question not ready yet. Waiting... (${Math.round(data.timeRemaining / 1000)}s left)`);

                    // ✅ Add a delay before retrying (instead of resetting immediately)
                    setTimeout(() => {
                        questionRequested = false; // ✅ Allows retry only after a delay
                    }, 5000); // ✅ Retry every 5 seconds

                    return;
                }

                console.log("📩 Received next question:", data);
                displayQuestion(data); // ✅ Display the next trivia question
            })
            .catch(error => {
                console.error("❌ Error fetching next question:", error);

                // ✅ Add a delay before retrying on error
                setTimeout(() => {
                    questionRequested = false;
                }, 5000);
            });
        }
        return;
    }

    // ✅ Ensure countdown is updated live every second **only if PubSub hasn't updated recently**
    if (!countdownUpdatedByPubSub) {
        updateCountdown(timeRemaining);
    }

}, 1000); // ✅ Ensures the countdown updates every second

// ✅ Transition Viewer to Trivia Screen (Displays Question & Choices)
function transitionToTrivia() {
    console.log("🎭 Transitioning to trivia question screen...");
    
    document.getElementById("waiting-screen").style.display = "none"; // Hide waiting screen
    document.getElementById("quiz-container").style.display = "flex"; // Show trivia screen
    document.getElementById("trivia-ended-screen").style.display = "none"; // Hide ended screen

    triviaActive = true; // ✅ Mark that trivia is active
}

// ✅ Start Trivia Timer & Reveal Answers
function startTriviaTimer(duration, correctAnswer) {
    console.log(`⏳ Starting trivia timer for duration: ${duration}ms`);

    setTimeout(() => {
        console.log("⌛ Time's up! Revealing correct answer...");
        
        // ✅ Mark correct and incorrect answers
        const buttons = document.querySelectorAll(".choice-button");
        buttons.forEach((btn) => {
            if (btn.textContent === correctAnswer) {
                btn.classList.add("correct"); // ✅ Highlight correct answer
            } else if (btn.dataset.selected === "true") {
                btn.classList.remove("selected");
                btn.classList.add("wrong"); // ❌ Mark incorrect answer
            } else {
                btn.classList.add("wrong");
            }
            btn.disabled = true; // ✅ Disable all buttons
        });

        console.log("🎭 Answer reveal complete. Returning to countdown screen in 5 seconds...");

        // ✅ After 5 seconds, transition back to waiting screen
        setTimeout(transitionToCountdown, 5000);
    }, duration);
}

// ✅ Display Trivia Question
function displayQuestion(data) {
    console.log("📢 displayQuestion() called with data:", data);
    if (!data.question || !data.choices || !data.correctAnswer || !data.duration) {
        console.error("❌ Missing required trivia data fields:", data);
        return;
    }

    triviaActive = true;
    questionStartTime = Date.now();
    console.log("📢 Question started at:", questionStartTime);

    questionText.textContent = data.question;
    choicesContainer.innerHTML = "";
    timerBar.style.transition = "none";
    timerBar.style.width = "100%";

    data.choices.forEach((choice) => {
        const button = document.createElement("button");
        button.classList.add("choice-button");
        button.textContent = choice;
        button.onclick = () => selectAnswer(button, choice, data.correctAnswer);
        choicesContainer.appendChild(button);
    });

    setTimeout(() => {
        timerBar.style.transition = `width ${data.duration / 1000}s linear`;
        timerBar.style.width = "0%";
    }, 100);

    transitionToTrivia();
    startTriviaTimer(data.duration, data.correctAnswer);
}

// ✅ Display User Score
function displayScore(score) {
    const scoreElement = document.getElementById("user-score");
    if (scoreElement) {
        scoreElement.textContent = `Score: ${score}`;
        console.log(`🏆 Score updated: ${score}`);
    } else {
        console.error("❌ Score element not found!");
    }
}

// ✅ Handle Answer Submission
function selectAnswer(button, selectedChoice, correctAnswer) {
    if (!userId) {
        console.warn("⚠ User ID missing. Cannot track score.");
        return;
    }
    
    console.log("User selected:", selectedChoice, " | Correct answer:", correctAnswer);
    
    const buttons = document.querySelectorAll(".choice-button");
    buttons.forEach((btn) => btn.disabled = true);
    
    button.classList.add("selected");
    button.dataset.selected = "true";
    button.dataset.isCorrect = selectedChoice === correctAnswer ? "true" : "false";

    const answerTime = Date.now() - questionStartTime;
    console.log(`📩 User ${userId} answered in ${answerTime}ms`);

    fetch("/submit-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            userId,
            selectedAnswer: selectedChoice,
            correctAnswer,
            answerTime
        }),
    })
    .then(response => response.json())
    .then(data => {
        console.log("🏆 Score updated!", data);
        displayScore(data.totalScore);
    })
    .catch(error => console.error("❌ Error submitting answer:", error));
}

// ✅ End Trivia Immediately
function endTrivia() {
    console.log("🔚 Ending Trivia Round (front-end)");
    triviaActive = false;
    waitingScreen.style.display = "none";
    quizContainer.style.display = "none";
    document.getElementById("trivia-ended-screen").style.display = "block";
}
