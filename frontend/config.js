document.addEventListener("DOMContentLoaded", function () {
    console.log("✅ DOM fully loaded, initializing event listeners.");

    // ✅ Attach button event listeners after Twitch authorization
    attachButtonListener("save-settings", saveSettings);
    attachButtonListener("upload-btn", uploadCSV);
    attachButtonListener("export-scores", exportScores);
    attachButtonListener("end-trivia", endTrivia);
    attachButtonListener("start-trivia", startTrivia); // ✅ Added Start Trivia
});

// ✅ Twitch Extension Authorization
window.Twitch.ext.onAuthorized((auth) => {
    console.log("✅ Twitch Extension Config Page Loaded!");
    document.getElementById("status").textContent = "✅ Twitch Config Loaded!";
    window.authToken = auth.token; // ✅ Save token globally
});

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

// ✅ Upload trivia CSV
function uploadCSV() {
    console.log("📤 Upload CSV button clicked!");

    const fileInput = document.getElementById("upload-trivia").files[0];
    if (!fileInput) {
        alert("Please select a CSV file to upload.");
        console.error("❌ No file selected for upload.");
        return;
    }

    const formData = new FormData();
    formData.append("file", fileInput);

    fetch(`${getServerURL()}/upload-csv`, {
        method: "POST",
        body: formData,
        credentials: "include",
    })
    .then(response => response.json())
    .then(data => {
        console.log("✅ Trivia CSV uploaded:", data);
        document.getElementById("status").textContent = "✅ Trivia uploaded!";
    })
    .catch(error => {
        console.error("❌ Error uploading CSV:", error);
        document.getElementById("status").textContent = "❌ Failed to Upload!";
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
    document.getElementById("upload-trivia").disabled = isDisabled;
    document.getElementById("upload-btn").disabled = isDisabled;
}
