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

// Load categories from the API
function loadCategories() {
    fetch(`${getServerURL()}/api/categories`)
        .then(response => response.json())
        .then(data => {
            console.log("✅ Categories loaded:", data);
            window.trivia.categories = data.categories || [];
            renderCategories();
        })
        .catch(error => {
            console.error("❌ Error loading categories:", error);
            document.getElementById("categories-list").innerHTML = 
                '<div class="loading" style="color: #ff6b6b;">Failed to load categories. Please refresh.</div>';
        });
}

// Load difficulties from the API
function loadDifficulties() {
    fetch(`${getServerURL()}/api/difficulties`)
        .then(response => response.json())
        .then(data => {
            console.log("✅ Difficulties loaded:", data);
            window.trivia.difficulties = data.difficulties || [];
            renderDifficulties();
        })
        .catch(error => {
            console.error("❌ Error loading difficulties:", error);
            document.getElementById("difficulties-list").innerHTML = 
                '<div class="loading" style="color: #ff6b6b;">Failed to load difficulties. Please refresh.</div>';
        });
}

// Load broadcaster's saved settings
function loadBroadcasterSettings() {
    if (!window.broadcasterId) {
        console.error("❌ Broadcaster ID not available yet");
        return;
    }
    
    fetch(`${getServerURL()}/api/settings/${window.broadcasterId}`)
        .then(response => response.json())
        .then(data => {
            console.log("✅ Broadcaster settings loaded:", data);
            if (data.settings) {
                window.trivia.selectedCategories = data.settings.active_categories || [];
                window.trivia.selectedDifficulties = data.settings.active_difficulties || [];
                
                // Update UI once categories and difficulties are loaded
                setTimeout(() => {
                    updateCategoryCheckboxes();
                    updateDifficultyCheckboxes();
                    updateQuestionStats();
                }, 500);
            }
        })
        .catch(error => {
            console.error("❌ Error loading broadcaster settings:", error);
        });
}

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
    
    let url = `${getServerURL()}/api/sample-questions?limit=1`;
    if (categoriesParam) url += `&categories=${categoriesParam}`;
    if (difficultiesParam) url += `&difficulties=${difficultiesParam}`;
    
    fetch(url)
        .then(response => response.json())
        .then(data => {
            window.trivia.totalQuestions = data.totalMatching || 0;
            
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
        })
        .catch(error => {
            console.error("❌ Error getting question stats:", error);
            document.getElementById("question-stats").innerHTML = 
                '<div style="color: #ff6b6b;">Error loading question statistics</div>';
        });
}

// Save category and difficulty filters
function saveFilters() {
    console.log("💾 Save Filters button clicked!");
    
    if (!window.broadcasterId) {
        console.error("❌ Broadcaster ID not available");
        document.getElementById("status").textContent = "❌ Authentication error!";
        return;
    }
    
    const activeCategories = window.trivia.selectedCategories;
    const activeDifficulties = window.trivia.selectedDifficulties;
    
    fetch(`${getServerURL()}/api/settings/${window.broadcasterId}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${window.authToken}`
        },
        body: JSON.stringify({
            activeCategories,
            activeDifficulties
        }),
        credentials: "include"
    })
    .then(response => response.json())
    .then(data => {
        console.log("✅ Filters saved:", data);
        document.getElementById("status").textContent = "✅ Question filters saved!";
        
        // Update question stats
        updateQuestionStats();
    })
    .catch(error => {
        console.error("❌ Error saving filters:", error);
        document.getElementById("status").textContent = "❌ Failed to save filters!";
    });
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

// ✅ Base Server URL (Always localhost)
function getServerURL() {
    return "http://localhost:5000";
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

    fetch(`${getServerURL()}/update-settings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${window.authToken}`, // ✅ Send Twitch Auth Token
        },
        body: JSON.stringify({ answerTime, intervalTime }),
        credentials: "include", // ✅ Ensure credentials are sent
    })    
    .then(response => response.json())
    .then(data => {
        console.log("✅ Settings update response:", data);
        document.getElementById("status").textContent = "✅ Settings Saved!";
    })
    .catch(error => {
        console.error("❌ Error updating settings:", error);
        document.getElementById("status").textContent = "❌ Failed to Save!";
    });
}

// ✅ Export scores
function exportScores() {
    console.log("📥 Export Scores button clicked!");
    window.location.href = `${getServerURL()}/export-scores`;
}

// ✅ Start Trivia
function startTrivia() {
    console.log("▶️ Start Trivia button clicked!");

    fetch(`${getServerURL()}/start-trivia`, { 
        method: "POST",
        headers: {
            "Authorization": `Bearer ${window.authToken}`,
        },
        credentials: "include",
    })
    .then(response => response.json())
    .then(data => {
        console.log("🏆 Trivia started!", data);
        document.getElementById("status").textContent = "🏆 Trivia Started!";
        disableSettings(true); // ✅ Lock settings when trivia starts
    })
    .catch(error => {
        console.error("❌ Error starting trivia:", error);
        document.getElementById("status").textContent = "❌ Failed to Start!";
    });
}

// ✅ End trivia immediately
function endTrivia() {
    console.log("⛔ End Trivia button clicked!");

    fetch(`${getServerURL()}/end-trivia`, { 
        method: "POST",
        headers: {
            "Authorization": `Bearer ${window.authToken}`,
        },
        credentials: "include",
    })
    .then(response => response.json())
    .then(data => {
        console.log("⛔ Trivia force-ended:", data);
        document.getElementById("status").textContent = "🛑 Trivia Ended!";
        disableSettings(false); // ✅ Unlock settings when trivia ends
    })
    .catch(error => {
        console.error("❌ Error ending trivia:", error);
        document.getElementById("status").textContent = "❌ Failed to End Trivia!";
    });
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