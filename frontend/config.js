/**
 * Loremaster Trivia Extension - Config Panel
 * Main configuration script for broadcaster settings
 */

// Initialize global trivia state
window.trivia = {
    categories: [],
    difficulties: [],
    selectedCategories: [],
    selectedDifficulties: [],
    totalQuestions: 0
};

// Global variables
let triviaActive = false;
let triviaSettings = {
    answerTime: 30000,     // Default 30 seconds
    intervalTime: 600000   // Default 10 minutes
};

// ====== INITIALIZATION FUNCTIONS ======

// Main initialization function
function initializeConfigPanel() {
    console.log("✅ Initializing config panel");
    
    // Attach all button listeners
    attachButtonListener("save-settings", saveSettings);
    attachButtonListener("export-scores", exportScores);
    attachButtonListener("start-trivia", startTrivia);
    attachButtonListener("end-trivia", endTrivia);
    attachButtonListener("save-filters", saveFilters);
    
    // Wait for Twitch authorization before loading data
    if (window.Twitch && window.Twitch.ext) {
        console.log("✅ Twitch Extension API available");
        window.Twitch.ext.onAuthorized((auth) => {
            console.log("✅ Extension authorized:", auth);
            window.broadcasterId = auth.channelId;
            window.authToken = auth.token;
            
            // Load initial data after auth
            loadCategories();
            loadDifficulties();
            
            // Request broadcaster's saved settings
            window.Twitch.ext.send('broadcast', 'application/json', {
                type: 'GET_BROADCASTER_SETTINGS',
                broadcasterId: window.broadcasterId
            });
        });
    } else {
        console.error("❌ Twitch API not available");
        
        // Only create mock in development/testing
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            createMockTwitchForTesting();
        }
    }
}

// Only create mock Twitch in development/testing environments
function createMockTwitchForTesting() {
    console.warn("⚠️ Creating mock Twitch object for testing");
    window.Twitch = {
        ext: {
            onAuthorized: (callback) => {
                console.log("🔧 Mock Twitch auth");
                callback({
                    userId: "mock-user-123",
                    channelId: "70361469",
                    token: "mock-token"
                });
            },
            listen: (type, callback) => {
                console.log("🔧 Mock Twitch listen registered for:", type);
            },
            send: (target, contentType, message) => {
                console.log("🔧 Mock Twitch send:", { target, contentType, message });
                
                // Simulate responses for testing
                if (message.type === 'GET_CATEGORIES') {
                    const mockCategories = [
                        { id: "gaming", name: "Gaming", questionCount: 50 },
                        { id: "history", name: "History", questionCount: 30 },
                        { id: "science", name: "Science", questionCount: 25 }
                    ];
                    setTimeout(() => {
                        window.trivia.categories = mockCategories;
                        renderCategories();
                    }, 500);
                }
                
                if (message.type === 'GET_DIFFICULTIES') {
                    const mockDifficulties = [
                        { difficulty: "Easy", count: 40 },
                        { difficulty: "Medium", count: 50 },
                        { difficulty: "Hard", count: 15 }
                    ];
                    setTimeout(() => {
                        window.trivia.difficulties = mockDifficulties;
                        renderDifficulties();
                    }, 500);
                }
                
                if (message.type === 'GET_QUESTION_STATS') {
                    setTimeout(() => {
                        // Simulate question stats
                        const data = {
                            totalMatching: 85,
                            filters: {
                                categories: message.categories,
                                difficulties: message.difficulties
                            }
                        };
                        window.trivia.totalQuestions = data.totalMatching;
                        updateQuestionStatsDisplay(data);
                    }, 500);
                }
            }
        }
    };
    
    // Re-initialize with mock
    initializeConfigPanel();
}

// ====== DATA LOADING FUNCTIONS ======

// Load categories from the server
function loadCategories() {
    console.log("🔍 Loading categories");
    
    // First try the test endpoint to verify connectivity
    fetch('/api/test')
        .then(response => {
            console.log(`Test API status: ${response.status}`);
            return response.text(); // Use text() instead of json() for debugging
        })
        .then(text => {
            console.log("Test API response:", text);
            
            // Now try the categories endpoint
            return fetch('/api/categories');
        })
        .then(response => {
            console.log(`Categories API status: ${response.status}`);
            if (!response.ok) {
                return response.text().then(text => {
                    console.error(`API error response: ${text}`);
                    throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
                });
            }
            return response.text(); // Get the raw text first for debugging
        })
        .then(text => {
            console.log("Raw categories response:", text);
            // Now parse as JSON
            const data = JSON.parse(text);
            console.log("Parsed categories data:", data);
            
            // Store categories in global state
            window.trivia.categories = data.categories || [];
            
            // Render categories
            renderCategories();
        })
        .catch(error => {
            console.error("❌ Error loading categories:", error);
            
            // Fall back to Twitch messaging approach
            console.log("🔄 Trying Twitch messaging for categories");
            window.Twitch.ext.send('broadcast', 'application/json', {
                type: 'GET_CATEGORIES'
            });
        });
}

// Load difficulties from the server
function loadDifficulties() {
    console.log("🔍 Loading difficulties");
    
    // First try the direct API approach
    fetch('/api/difficulties')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("🔄 Difficulties received:", data);
            
            // Store difficulties in global state
            window.trivia.difficulties = data.difficulties || [];
            
            // Render difficulties
            renderDifficulties();
        })
        .catch(error => {
            console.error("❌ Error loading difficulties directly:", error);
            
            // Fall back to Twitch messaging approach
            console.log("🔄 Trying Twitch messaging for difficulties");
            window.Twitch.ext.send('broadcast', 'application/json', {
                type: 'GET_DIFFICULTIES'
            });
        });
}

// ====== RENDERING FUNCTIONS ======

// Render category checkboxes
function renderCategories() {
    console.log("🔍 Rendering categories. Current categories:", window.trivia.categories);
    
    const container = document.getElementById("categories-list");
    
    if (!container) {
        console.error("❌ Categories container not found!");
        return;
    }
    
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
    console.log("🔍 Rendering difficulties. Current difficulties:", window.trivia.difficulties);
    
    const container = document.getElementById("difficulties-list");
    
    if (!container) {
        console.error("❌ Difficulties container not found!");
        return;
    }
    
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

// ====== EVENT HANDLERS ======

// Function to safely attach event listeners
function attachButtonListener(buttonId, handler) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.addEventListener("click", handler);
        console.log(`✅ Attached event listener to #${buttonId}`);
    } else {
        console.error(`❌ Button #${buttonId} NOT found in DOM!`);
    }
}

// Save trivia settings
function saveSettings() {
    console.log("🔘 Save Settings button clicked!");

    if (!window.authToken) {
        console.error("❌ Twitch authentication token missing!");
        document.getElementById("status").textContent = "Authentication error! Please refresh.";
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
        document.getElementById("status").textContent = "Invalid input! Answer time must be between 5-60 seconds, and interval time must be between 1-30 minutes.";
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

// Export scores via iframe download
function exportScores() {
    console.log("📥 Export Scores button clicked!");
    
    if (!window.authToken) {
        console.error("❌ Twitch authentication token missing!");
        document.getElementById("status").textContent = "Authentication error! Please refresh.";
        return;
    }
    
    // Create a hidden iframe to handle the download
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = `/export-scores?jwt=${window.authToken}`;
    document.body.appendChild(iframe);
    
    // Clean up after download starts
    setTimeout(() => {
        document.body.removeChild(iframe);
    }, 5000);
    
    document.getElementById("status").textContent = "📥 Downloading scores...";
}

// Start Trivia
function startTrivia() {
    console.log("▶️ Start Trivia button clicked!");

    if (!window.broadcasterId) {
        console.error("❌ Broadcaster ID not available");
        document.getElementById("status").textContent = "❌ Authentication error!";
        return;
    }

    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'START_TRIVIA',
        broadcasterId: window.broadcasterId
    });
    
    document.getElementById("status").textContent = "⏳ Starting trivia...";
    disableSettings(true);
}

// End trivia immediately
function endTrivia() {
    console.log("⛔ End Trivia button clicked!");

    if (!window.broadcasterId) {
        console.error("❌ Broadcaster ID not available");
        document.getElementById("status").textContent = "❌ Authentication error!";
        return;
    }

    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'END_TRIVIA',
        broadcasterId: window.broadcasterId
    });
    
    document.getElementById("status").textContent = "⏳ Ending trivia...";
    disableSettings(false);
}

// Function to Enable/Disable Settings
function disableSettings(isDisabled) {
    const elements = [
        document.getElementById("answer-time"),
        document.getElementById("interval-time"),
        document.getElementById("save-settings"),
        document.getElementById("save-filters")
    ];
    
    elements.forEach(element => {
        if (element) element.disabled = isDisabled;
    });
    
    // Disable all category checkboxes
    document.querySelectorAll('input[name="category"]').forEach(checkbox => {
        checkbox.disabled = isDisabled;
    });
    
    // Disable all difficulty checkboxes
    document.querySelectorAll('input[name="difficulty"]').forEach(checkbox => {
        checkbox.disabled = isDisabled;
    });
}

// ====== HELPER FUNCTIONS ======

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
    
    // Use Twitch messaging
    window.Twitch.ext.send('broadcast', 'application/json', {
        type: 'GET_QUESTION_STATS',
        categories: window.trivia.selectedCategories,
        difficulties: window.trivia.selectedDifficulties
    });
    
    // Update UI while waiting for response
    document.getElementById("question-stats").innerHTML = "<div class='loading'>Loading question statistics...</div>";
}

// Display question stats in the UI
function updateQuestionStatsDisplay(data) {
    let statsHtml = '';
    if (window.trivia.selectedCategories.length === 0 && window.trivia.selectedDifficulties.length === 0) {
        statsHtml = `<span style="color: #ffcc00;">Using all available questions (${data.totalMatching || window.trivia.totalQuestions})</span>`;
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
                ${data.totalMatching || window.trivia.totalQuestions} questions match your selection
            </div>
        `;
    }
    
    document.getElementById("question-stats").innerHTML = statsHtml;
}

// ====== TWITCH MESSAGE HANDLER ======

// Add a listener for responses from the backend
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
                
                // Update UI if needed
                const answerTimeInput = document.getElementById("answer-time");
                const intervalTimeInput = document.getElementById("interval-time");
                
                if (answerTimeInput && data.answerTime) {
                    answerTimeInput.value = Math.round(data.answerTime / 1000);
                }
                
                if (intervalTimeInput && data.intervalTime) {
                    intervalTimeInput.value = Math.round(data.intervalTime / 60000);
                }
                
                document.getElementById("status").textContent = "Settings updated!";
                break;
        
            case "TRIVIA_START":
            case "START_TRIVIA": // Added this case to handle both message types
                console.log("🚀 Trivia has started!");
                triviaActive = true;
                disableSettings(true);
                document.getElementById("status").textContent = "Trivia has started!";
                break;
        
            case "TRIVIA_END":
            case "END_TRIVIA": // Added this case to handle both message types
                console.log("⛔ Trivia has been ended.");
                triviaActive = false;
                disableSettings(false);
                document.getElementById("status").textContent = "Trivia has ended!";
                break;
        
            case "CATEGORIES_RESPONSE":
                console.log("📚 Categories received:", data.categories);
                // Store categories in global state
                window.trivia.categories = data.categories || [];
                
                // Render categories
                renderCategories();
                break;
        
            case "DIFFICULTIES_RESPONSE":
                console.log("🔄 Difficulties received:", data.difficulties);
                // Store difficulties in global state
                window.trivia.difficulties = data.difficulties || [];
                
                // Render difficulties
                renderDifficulties();
                break;
        
            case "QUESTION_STATS_RESPONSE":
                console.log("📊 Question stats received:", data);
                // Update total questions and display stats
                window.trivia.totalQuestions = data.totalMatching || 0;
                updateQuestionStatsDisplay(data);
                break;
        
            case "FILTERS_SAVED":
                console.log("💾 Filters saved:", data);
                // Update UI or show a success message
                document.getElementById("status").textContent = data.message || "Filters saved successfully!";
                
                // If message includes updated question count, update the stats
                if (data.questionCount) {
                    window.trivia.totalQuestions = data.questionCount;
                    updateQuestionStatsDisplay({
                        totalMatching: data.questionCount
                    });
                }
                break;
        
            case "BROADCASTER_SETTINGS_RESPONSE":
                console.log("⚙️ Broadcaster settings received:", data.settings);
                
                // Update local state with saved settings
                if (data.settings) {
                    window.trivia.selectedCategories = data.settings.active_categories || [];
                    window.trivia.selectedDifficulties = data.settings.active_difficulties || ["Easy", "Medium", "Hard"];
                    
                    // Update UI checkboxes
                    updateCategoryCheckboxes();
                    updateDifficultyCheckboxes();
                    
                    // Update question stats
                    updateQuestionStats();
                }
                break;
        
            default:
                console.warn("⚠️ Unknown broadcast type:", data.type);
                break;
        }
    } catch (err) {
        console.error("❌ Error parsing broadcast message:", err);
    }
});

// Initialize on DOMContentLoaded
document.addEventListener("DOMContentLoaded", initializeConfigPanel);