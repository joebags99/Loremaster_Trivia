document.addEventListener("DOMContentLoaded", function() {
    console.log("🔍 Debug script loaded");
    
    // Global debug div for persistent messaging
    const createDebugDiv = () => {
        const debugDiv = document.createElement('div');
        debugDiv.id = 'debug-info-panel';
        debugDiv.style.position = 'fixed';
        debugDiv.style.bottom = '10px';
        debugDiv.style.right = '10px';
        debugDiv.style.background = 'rgba(0,0,0,0.8)';
        debugDiv.style.color = '#fff';
        debugDiv.style.padding = '15px';
        debugDiv.style.borderRadius = '5px';
        debugDiv.style.zIndex = '9999';
        debugDiv.style.maxWidth = '300px';
        debugDiv.style.wordWrap = 'break-word';
        debugDiv.style.fontFamily = 'monospace';
        document.body.appendChild(debugDiv);
        return debugDiv;
    };

    const debugDiv = createDebugDiv();

    // Update debug info function
    const updateDebugInfo = (message, isError = false) => {
        console.log(isError ? "❌" : "ℹ️", message);
        debugDiv.innerHTML += `<div style="color: ${isError ? 'red' : 'white'}">${message}</div>`;
        debugDiv.scrollTop = debugDiv.scrollHeight;
    };

    // Test direct API call
    fetch('/api/categories')
        .then(response => {
            updateDebugInfo(`Categories API response status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            updateDebugInfo(`Categories data received`);
            
            // Detailed category logging
            if (data.categories) {
                updateDebugInfo(`Total Categories: ${data.categories.length}`);
                data.categories.forEach((category, index) => {
                    updateDebugInfo(`Category ${index + 1}: 
                        ID: ${category.id}, 
                        Name: ${category.name}, 
                        Questions: ${category.questionCount}`);
                });
            } else {
                updateDebugInfo('No categories found in response', true);
            }
        })
        .catch(error => {
            updateDebugInfo(`Error fetching categories: ${error.message}`, true);
        });
    
    // Enhanced Twitch API availability check
    const checkTwitchAPI = () => {
        return new Promise((resolve, reject) => {
            try {
                if (window.Twitch && window.Twitch.ext) {
                    updateDebugInfo("✅ Twitch Extension API available");
                    
                    // Add more detailed checks
                    updateDebugInfo(`Twitch ext methods: ${Object.keys(window.Twitch.ext).join(', ')}`);
                    
                    // Check specific method availability
                    const requiredMethods = [
                        'onAuthorized', 
                        'listen', 
                        'send', 
                        'rig'
                    ];
                    
                    requiredMethods.forEach(method => {
                        if (typeof window.Twitch.ext[method] === 'function') {
                            updateDebugInfo(`✅ Method ${method} is available`);
                        } else {
                            updateDebugInfo(`❌ Method ${method} is NOT available`, true);
                        }
                    });
                    
                    resolve(true);
                } else {
                    updateDebugInfo("❌ Twitch Extension API NOT available", true);
                    
                    // Create a comprehensive mock Twitch object for testing
                    window.Twitch = {
                        ext: {
                            onAuthorized: (callback) => {
                                updateDebugInfo("🔧 Invoking mock Twitch auth");
                                callback({
                                    userId: "mock-user-123",
                                    channelId: "70361469",
                                    token: "mock-token"
                                });
                            },
                            listen: (type, callback) => {
                                updateDebugInfo(`🔧 Mock Twitch listen registered for: ${type}`);
                            },
                            send: (target, contentType, message) => {
                                updateDebugInfo(`🔧 Mock Twitch send: ${JSON.stringify({ target, contentType, message })}`);
                            },
                            rig: {
                                log: (message) => {
                                    updateDebugInfo(`🔧 Mock Rig Log: ${message}`);
                                }
                            }
                        }
                    };
                    
                    resolve(false);
                }
            } catch (error) {
                updateDebugInfo(`❌ Error checking Twitch API: ${error.message}`, true);
                reject(error);
            }
        });
    };

    // Run Twitch API check
    checkTwitchAPI()
        .then(apiAvailable => {
            if (apiAvailable) {
                // Simulate authorization for debugging
                window.Twitch.ext.onAuthorized((auth) => {
                    updateDebugInfo(`🔑 Authorized with Channel ID: ${auth.channelId}`);
                    
                    // Attempt to manually trigger category and difficulty loading
                    if (typeof loadCategories === 'function') {
                        updateDebugInfo("🔄 Calling loadCategories()");
                        loadCategories();
                    } else {
                        updateDebugInfo("❌ loadCategories() function not found", true);
                    }
                    
                    if (typeof loadDifficulties === 'function') {
                        updateDebugInfo("🔄 Calling loadDifficulties()");
                        loadDifficulties();
                    } else {
                        updateDebugInfo("❌ loadDifficulties() function not found", true);
                    }
                });
            }
        })
        .catch(error => {
            updateDebugInfo(`❌ Fatal error in Twitch API check: ${error.message}`, true);
        });

    // Optional: Add error logging for unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
        updateDebugInfo(`🚨 Unhandled Promise Rejection: ${event.reason}`, true);
    });
});

// Use Twitch EBS to load difficulties
// Render category checkboxes
function renderCategories() {
    console.log("🔍 Rendering categories. Current categories:", window.trivia.categories);
    
    const container = document.getElementById("categories-list");
    
    if (!container) {
        console.error("❌ Categories container not found!");
        return;
    }
    
    if (!window.trivia.categories || window.trivia.categories.length === 0) {
        console.warn("⚠️ No categories to render");
        container.innerHTML = '<div class="loading">No categories found.</div>';
        return;
    }
    
    let html = '';
    window.trivia.categories.forEach(category => {
        console.log(`📝 Rendering category: ${JSON.stringify(category)}`);
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

            // Add these new case handlers
            case "GET_CATEGORIES":
                console.log("📚 Received request for categories");
                loadCategories();
                break;

            case "GET_DIFFICULTIES":
                console.log("🔄 Received request for difficulties");
                loadDifficulties();
                break;

            case "GET_BROADCASTER_SETTINGS":
                console.log("⚙️ Received request for broadcaster settings");
                loadBroadcasterSettings();
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

document.addEventListener("DOMContentLoaded", function() {
    console.log("🔍 Debug script loaded");
    
    // Test direct API call
    fetch('/api/categories')
        .then(response => {
            console.log("🔄 Categories API response status:", response.status);
            return response.json();
        })
        .then(data => {
            console.log("📊 Categories data:", data);
            // Display categories count in the UI for debugging
            const debugDiv = document.createElement('div');
            debugDiv.style.position = 'fixed';
            debugDiv.style.bottom = '10px';
            debugDiv.style.right = '10px';
            debugDiv.style.background = 'rgba(0,0,0,0.7)';
            debugDiv.style.color = '#fff';
            debugDiv.style.padding = '10px';
            debugDiv.style.borderRadius = '5px';
            debugDiv.style.zIndex = '9999';
            
            const count = data.categories ? data.categories.length : 0;
            debugDiv.textContent = `Categories found: ${count}`;
            document.body.appendChild(debugDiv);
        })
        .catch(error => {
            console.error("❌ Error fetching categories:", error);
            
            // Try an absolute URL instead
            console.log("🔄 Trying with absolute URL...");
            fetch('https://loremaster-trivia.com/api/categories')
                .then(response => response.json())
                .then(data => console.log("📊 Categories data (absolute URL):", data))
                .catch(err => console.error("❌ Still failed:", err));
        });
    
    // Check Twitch API availability
    if (window.Twitch && window.Twitch.ext) {
        console.log("✅ Twitch Extension API available");
    } else {
        console.log("❌ Twitch Extension API NOT available");
        
        // Create a mock Twitch object for testing
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
                }
            }
        };
    }
});

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