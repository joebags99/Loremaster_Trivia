document.addEventListener("DOMContentLoaded", function () {
    console.log("✅ DOM fully loaded, initializing event listeners.");

    // Global state for categories and difficulties
    window.trivia = {
        categories: [],
        difficulties: [],
        selectedCategories: [],
        selectedDifficulties: [],
        totalQuestions: 0
    };

    // ✅ Attach button event listeners after Twitch authorization
    attachButtonListener("save-settings", saveSettings);
    attachButtonListener("export-scores", exportScores);
    attachButtonListener("end-trivia", endTrivia);
    attachButtonListener("start-trivia", startTrivia); 
    attachButtonListener("save-filters", saveFilters);
});

// ✅ Twitch Extension Authorization
window.Twitch.ext.onAuthorized((auth) => {
    console.log("✅ Twitch Extension Config Page Loaded!");
    document.getElementById("status").textContent = "✅ Twitch Config Loaded!";
    window.authToken = auth.token; // ✅ Save token globally
    window.broadcasterId = auth.channelId;
    
    // Load categories and difficulties after auth
    loadCategories();
    loadDifficulties();
    
    // Load broadcaster's saved settings
    loadBroadcasterSettings();
});

// Use Twitch EBS to load categories
function loadCategories() {
    // Use Twitch's approved API methods instead of direct fetch
    window.Twitch.ext.rig.log('Requesting categories');
    
    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'GET_CATEGORIES'
    });
    
    // Listen for the response in the Twitch.ext.listen handler
    // The server will respond with the categories
}

// Use Twitch EBS to load difficulties
function loadDifficulties() {
    window.Twitch.ext.rig.log('Requesting difficulties');
    
    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'GET_DIFFICULTIES'
    });
    
    // Listen for the response in the Twitch.ext.listen handler
}

// Load broadcaster's saved settings via Twitch
function loadBroadcasterSettings() {
    if (!window.broadcasterId) {
        console.error("❌ Broadcaster ID not available yet");
        return;
    }
    
    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'GET_BROADCASTER_SETTINGS',
        broadcasterId: window.broadcasterId
    });
    
    // Listen for the response in the Twitch.ext.listen handler
}

// Add a listener for responses from the backend
window.Twitch.ext.listen('broadcast', (target, contentType, message) => {
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

            case "CATEGORIES_RESPONSE":
                console.log("📚 Received categories:", data);
                window.trivia.categories = data.categories || [];
                renderCategories();
                break;
                
            case "DIFFICULTIES_RESPONSE":
                console.log("🔄 Received difficulties:", data);
                window.trivia.difficulties = data.difficulties || [];
                renderDifficulties();
                break;
                
            case "BROADCASTER_SETTINGS_RESPONSE":
                console.log("⚙️ Received broadcaster settings:", data);
                if (data.settings) {
                    window.trivia.selectedCategories = data.settings.active_categories || [];
                    window.trivia.selectedDifficulties = data.settings.active_difficulties || [];
                    
                    // Update UI
                    setTimeout(() => {
                        updateCategoryCheckboxes();
                        updateDifficultyCheckboxes();
                        updateQuestionStats();
                    }, 500);
                }
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

            case "QUESTION_STATS_RESPONSE":
                console.log("📊 Received question stats:", data);
                window.trivia.totalQuestions = data.totalMatching || 0;
                updateQuestionStatsDisplay(data);
                break;

            case "FILTERS_SAVED":
                console.log("💾 Filters saved response:", data);
                document.getElementById("status").textContent = "✅ Question filters saved!";
                updateQuestionStats();
                break;

            default:
                console.warn("⚠️ Unknown broadcast type:", data.type);
                break;
        }
    } catch (err) {
        console.error("❌ Error parsing broadcast message:", err);
    }
});

// Render category checkboxes
function renderCategories() {
    const container = document.getElementById("categories-list");
    
    if (!window.trivia.categories || window.trivia.categories.length === 0) {
        container.innerHTML = '<div class="loading">No categories found.</div>';
        return;
    }
    
    let html = '';
    window.trivia.categories.forEach(category => {
        html += `
            <div class="checkbox-item">
                <input type="checkbox" id="cat-${category.id}" name="category" value="${category.id}">
                <label for="cat-${category.id}">${category.name || category.id}</label>
                <span class="checkbox-count">${category.questionCount || 0}</span>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners to checkboxes
    document.querySelectorAll('input[name="category"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateSelectedCategories();
            updateQuestionStats();
        });
    });
    
    // Update checkboxes based on saved settings
    updateCategoryCheckboxes();
}

// Render difficulty checkboxes
function renderDifficulties() {
    const container = document.getElementById("difficulties-list");
    
    if (!window.trivia.difficulties || window.trivia.difficulties.length === 0) {
        container.innerHTML = '<div class="loading">No difficulties found.</div>';
        return;
    }
    
    let html = '';
    window.trivia.difficulties.forEach(diff => {
        html += `
            <div class="checkbox-item">
                <input type="checkbox" id="diff-${diff.difficulty}" name="difficulty" value="${diff.difficulty}">
                <label for="diff-${diff.difficulty}">${diff.difficulty}</label>
                <span class="checkbox-count">${diff.count || 0}</span>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners to checkboxes
    document.querySelectorAll('input[name="difficulty"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateSelectedDifficulties();
            updateQuestionStats();
        });
    });
    
    // Update checkboxes based on saved settings
    updateDifficultyCheckboxes();
}

// Update selected categories based on checkboxes
function updateSelectedCategories() {
    window.trivia.selectedCategories = Array.from(
        document.querySelectorAll('input[name="category"]:checked')
    ).map(checkbox => checkbox.value);
    
    console.log("Selected categories:", window.trivia.selectedCategories);
}

// Update selected difficulties based on checkboxes
function updateSelectedDifficulties() {
    window.trivia.selectedDifficulties = Array.from(
        document.querySelectorAll('input[name="difficulty"]:checked')
    ).map(checkbox => checkbox.value);
    
    console.log("Selected difficulties:", window.trivia.selectedDifficulties);
}

// Update category checkboxes based on saved settings
function updateCategoryCheckboxes() {
    document.querySelectorAll('input[name="category"]').forEach(checkbox => {
        checkbox.checked = window.trivia.selectedCategories.includes(checkbox.value);
    });
}

// Update difficulty checkboxes based on saved settings
function updateDifficultyCheckboxes() {
    document.querySelectorAll('input[name="difficulty"]').forEach(checkbox => {
        checkbox.checked = window.trivia.selectedDifficulties.includes(checkbox.value);
    });
}

// Update question stats based on selected filters
function updateQuestionStats() {
    const categoriesParam = window.trivia.selectedCategories.join(',');
    const difficultiesParam = window.trivia.selectedDifficulties.join(',');
    
    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'GET_QUESTION_STATS',
        categories: window.trivia.selectedCategories,
        difficulties: window.trivia.selectedDifficulties
    });
}

// Display question stats in the UI
function updateQuestionStatsDisplay(data) {
    let statsHtml = '';
    if (window.trivia.selectedCategories.length === 0 && window.trivia.selectedDifficulties.length === 0) {
        statsHtml = `<span style="color: #ffcc00;">Using all available questions (${window.trivia.totalQuestions})</span>`;
    } else {
        const categoryText = window.trivia.selectedCategories.length === 0 ? 
            "all categories" : 
            `${window.trivia.selectedCategories.length} selected categor${window.trivia.selectedCategories.length === 1 ? 'y' : 'ies'}`;
        
        const difficultyText = window.trivia.selectedDifficulties.length === 0 ? 
            "all difficulties" : 
            `${window.trivia.selectedDifficulties.length} selected difficult${window.trivia.selectedDifficulties.length === 1 ? 'y' : 'ies'}`;
        
        statsHtml = `
            <div>Using ${categoryText} and ${difficultyText}</div>
            <div style="margin-top: 5px; font-size: 1.1em; color: #ffcc00;">
                ${window.trivia.totalQuestions} questions match your selection
            </div>
        `;
    }
    
    document.getElementById("question-stats").innerHTML = statsHtml;
}

// Save category and difficulty filters
function saveFilters() {
    console.log("💾 Save Filters button clicked!");
    
    if (!window.broadcasterId) {
        console.error("❌ Broadcaster ID not available");
        document.getElementById("status").textContent = "❌ Authentication error!";
        return;
    }
    
    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'SAVE_FILTERS',
        broadcasterId: window.broadcasterId,
        activeCategories: window.trivia.selectedCategories,
        activeDifficulties: window.trivia.selectedDifficulties
    });
    
    document.getElementById("status").textContent = "⏳ Saving filters...";
}

// ✅ Function to safely attach event listeners
function attachButtonListener(buttonId, handler) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.addEventListener("click", handler);
        console.log(`✅ Attached event listener to #${buttonId}`);
    } else {
        console.error(`❌ Button #${buttonId} NOT found in DOM!`);
    }
}

// ✅ Save trivia settings
function saveSettings() {
    console.log("🔘 Save Settings button clicked!");

    if (!window.authToken) {
        console.error("❌ Twitch authentication token missing!");
        return;
    }

    const answerTimeInput = document.getElementById("answer-time");
    const intervalTimeInput = document.getElementById("interval-time");

    if (!answerTimeInput || !intervalTimeInput) {
        console.error("❌ Input elements not found in DOM!");
        return;
    }

    const answerTime = parseInt(answerTimeInput.value, 10) * 1000;
    const intervalTime = parseInt(intervalTimeInput.value, 10) * 60000;

    if (isNaN(answerTime) || isNaN(intervalTime) || answerTime < 5000 || answerTime > 60000 || intervalTime < 60000 || intervalTime > 1800000) {
        console.error("❌ Invalid input detected:", { answerTime, intervalTime });
        alert("❌ Invalid input! Answer time must be between 5-60 seconds, and interval time must be between 1-30 minutes.");
        return;
    }

    console.log("📤 Sending settings update:", { answerTime, intervalTime });

    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'UPDATE_SETTINGS',
        answerTime: answerTime,
        intervalTime: intervalTime
    });
    
    document.getElementById("status").textContent = "⏳ Saving settings...";
}

// ✅ Export scores via iframe download
function exportScores() {
    console.log("📥 Export Scores button clicked!");
    
    // Create a hidden iframe to handle the download
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = `https://api.loremaster-trivia.com/export-scores?jwt=${window.authToken}`;
    document.body.appendChild(iframe);
    
    // Clean up after download starts
    setTimeout(() => {
        document.body.removeChild(iframe);
    }, 5000);
    
    document.getElementById("status").textContent = "📥 Downloading scores...";
}

// ✅ Start Trivia
function startTrivia() {
    console.log("▶️ Start Trivia button clicked!");

    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'START_TRIVIA'
    });
    
    document.getElementById("status").textContent = "⏳ Starting trivia...";
    disableSettings(true); // ✅ Lock settings when trivia starts
}

// ✅ End trivia immediately
function endTrivia() {
    console.log("⛔ End Trivia button clicked!");

    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'END_TRIVIA'
    });
    
    document.getElementById("status").textContent = "⏳ Ending trivia...";
    disableSettings(false); // ✅ Unlock settings when trivia ends
}

// ✅ Function to Enable/Disable Settings
function disableSettings(isDisabled) {
    document.getElementById("answer-time").disabled = isDisabled;
    document.getElementById("interval-time").disabled = isDisabled;
    document.getElementById("save-settings").disabled = isDisabled;
    document.getElementById("save-filters").disabled = isDisabled;
    
    // Disable all category checkboxes
    document.querySelectorAll('input[name="category"]').forEach(checkbox => {
        checkbox.disabled = isDisabled;
    });
    
    // Disable all difficulty checkboxes
    document.querySelectorAll('input[name="difficulty"]').forEach(checkbox => {
        checkbox.disabled = isDisabled;
    });
}