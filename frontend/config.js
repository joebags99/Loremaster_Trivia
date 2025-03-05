/**
 * ====================================
 * SECTION 1: Core Configuration & Constants
 * ====================================
 * Central location for all configuration values and constants
 * used throughout the application.
 */

const CONFIG = {
    // Environment & API configuration
    API_BASE_URL: () => window.location.hostname.includes('ext-twitch.tv') 
      ? 'https://loremaster-trivia.com' 
      : '',
    
    // Default trivia settings
    DEFAULT_SETTINGS: {
      answerTime: 30000,     // 30 seconds for answering questions
      intervalTime: 600000   // 10 minutes between questions
    },
    
    // Time intervals
    REFRESH_INTERVALS: {
      leaderboard: 60000,    // 1 minute for leaderboard auto-refresh
      buttonFeedback: 3000,  // 3 seconds for button feedback animations
      disableDelay: 1000     // 1 second for button disable after click
    },
    
    // DOM element IDs for easy reference
    DOM_IDS: {
      // Containers
      categoriesList: "categories-list",
      difficultiesList: "difficulties-list",
      leaderboardBody: "leaderboard-body",
      questionStats: "question-stats",
      statusDisplay: "status",
      
      // Inputs & form elements
      answerTime: "answer-time",
      intervalTime: "interval-time",
      
      // Buttons
      saveSettings: "save-settings",
      startTrivia: "start-trivia",
      endTrivia: "end-trivia",
      saveFilters: "save-filters",
      showSessionScores: "show-session-scores",
      showTotalScores: "show-total-scores",
      refreshLeaderboard: "refresh-leaderboard"
    },
    
    // CSS classes
    CSS_CLASSES: {
      activeBoard: "active-board",
      loading: "loading",
      success: "btn-success",
      error: "btn-error",
      originalText: "btn-original-text",
      tempText: "btn-text-temp"
    }
  };
  
  /**
   * ====================================
   * SECTION 2: State Management
   * ====================================
   * Centralized state management for the application.
   * Handles all data and provides methods to update it.
   */
  
  const TriviaState = {
    // Application state data with defaults
    data: {
      // Content data
      categories: [],
      difficulties: [],
      selectedCategories: [],
      selectedDifficulties: ["Easy", "Medium", "Hard"], // Default to all difficulties
      totalQuestions: 0,
      leaderboardData: {
        total: [],
        session: []
      },
      
      // Application state
      triviaActive: false,
      currentView: 'total', // 'total' or 'session' for leaderboard
      
      // Settings
      triviaSettings: {...CONFIG.DEFAULT_SETTINGS},
      
      // Auth data
      broadcasterId: null,
      authToken: null
    },
    
    /**
     * State update methods - all return this for chaining
     */
    
    // Category methods
    setCategories(categories) {
      this.data.categories = Array.isArray(categories) ? categories : [];
      return this;
    },
    
    setSelectedCategories(categoryIds) {
      this.data.selectedCategories = Array.isArray(categoryIds) ? categoryIds : [];
      return this;
    },
    
    // Difficulty methods
    setDifficulties(difficulties) {
      this.data.difficulties = Array.isArray(difficulties) ? difficulties : [];
      return this;
    },
    
    setSelectedDifficulties(difficultyIds) {
      this.data.selectedDifficulties = Array.isArray(difficultyIds) ? difficultyIds : ["Easy", "Medium", "Hard"];
      return this;
    },
    
    // Stats and counts
    setTotalQuestions(count) {
      this.data.totalQuestions = parseInt(count) || 0;
      return this;
    },
    
    // Leaderboard data
    setLeaderboardData(data) {
      if (data) {
        this.data.leaderboardData.total = Array.isArray(data.total) ? data.total : [];
        this.data.leaderboardData.session = Array.isArray(data.session) ? data.session : [];
      }
      return this;
    },
    
    setLeaderboardView(view) {
      if (view === 'total' || view === 'session') {
        this.data.currentView = view;
      }
      return this;
    },
    
    // Application state
    setTriviaActive(isActive) {
      this.data.triviaActive = !!isActive; // Convert to boolean
      return this;
    },
    
    // Settings
    updateSettings(settings = {}) {
      if (settings.answerTime) {
        this.data.triviaSettings.answerTime = parseInt(settings.answerTime);
      }
      
      if (settings.intervalTime) {
        this.data.triviaSettings.intervalTime = parseInt(settings.intervalTime);
      }
      return this;
    },
    
    // Authentication
    setAuthData(broadcasterId, authToken) {
      if (broadcasterId) this.data.broadcasterId = broadcasterId;
      if (authToken) this.data.authToken = authToken;
      return this;
    },
    
    /**
     * Helper methods
     */
    
    // Check if we have valid auth data
    hasValidAuth() {
      return !!(this.data.broadcasterId && this.data.authToken);
    },
    
    // Get the current filter state for API calls
    getFilterState() {
      return {
        categories: this.data.selectedCategories,
        difficulties: this.data.selectedDifficulties
      };
    },
    
    /**
     * Persistence methods - for future use with localStorage if needed
     */
    saveToLocalStorage() {
      try {
        // Store only what needs to persist between sessions
        const dataToStore = {
          selectedCategories: this.data.selectedCategories,
          selectedDifficulties: this.data.selectedDifficulties,
          triviaSettings: this.data.triviaSettings
        };
        
        localStorage.setItem('triviaConfigState', JSON.stringify(dataToStore));
        return true;
      } catch (e) {
        console.error('❌ Failed to save state to localStorage:', e);
        return false;
      }
    },
    
    loadFromLocalStorage() {
      try {
        const savedData = localStorage.getItem('triviaConfigState');
        if (savedData) {
          const parsed = JSON.parse(savedData);
          
          // Selectively update state with saved values
          if (parsed.selectedCategories) this.data.selectedCategories = parsed.selectedCategories;
          if (parsed.selectedDifficulties) this.data.selectedDifficulties = parsed.selectedDifficulties;
          if (parsed.triviaSettings) this.data.triviaSettings = {...CONFIG.DEFAULT_SETTINGS, ...parsed.triviaSettings};
          
          return true;
        }
      } catch (e) {
        console.error('❌ Failed to load state from localStorage:', e);
      }
      return false;
    },
    
    // Clear all persisted state
    clearSavedState() {
      try {
        localStorage.removeItem('triviaConfigState');
        return true;
      } catch (e) {
        console.error('❌ Failed to clear saved state:', e);
        return false;
      }
    }
  };

/**
 * ====================================
 * SECTION 3: API Services
 * ====================================
 * Handles all communication with the backend server.
 * Provides consistent error handling and fallback mechanisms.
 */

const ApiService = {
  /**
   * Core API request method with improved error handling
   * @param {string} endpoint - API endpoint path
   * @param {object} options - Fetch options
   * @returns {Promise} - JSON response or error
   */
  async request(endpoint, options = {}) {
    const url = `${CONFIG.API_BASE_URL()}${endpoint}`;
    
    try {
      console.log(`🔍 API Request: ${options.method || 'GET'} ${url}`);
      
      // Add authentication if available
      if (TriviaState.data.authToken && !options.headers?.Authorization) {
        options.headers = {
          ...options.headers,
          'Authorization': `Bearer ${TriviaState.data.authToken}`
        };
      }
      
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`❌ API Error (${response.status}):`, errorData);
        throw new Error(`HTTP error ${response.status}: ${errorData.error || response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`❌ API Error (${endpoint}):`, error);
      throw error;
    }
  },
  
  /**
   * Get categories from API
   * @returns {Promise<Object>} - Response from server
   */
  async getCategories() {
    try {
      console.log("📚 Fetching categories from API");
      const data = await this.request('/api/categories');
      
      // Update state with categories
      if (data && data.categories) {
        TriviaState.setCategories(data.categories);
        console.log(`✅ Loaded ${data.categories.length} categories`);
      }
      
      return data;
    } catch (error) {
      console.error("❌ Error fetching categories:", error);
      
      // Try fallback via Twitch messaging
      console.log("🔄 Trying Twitch messaging as fallback for categories");
      TwitchService.sendMessage({
        type: 'GET_CATEGORIES'
      });
      
      throw error;
    }
  },
  
  /**
   * Get difficulties from API
   * @returns {Promise<Object>} - Response from server
   */
  async getDifficulties() {
    try {
      console.log("🔄 Fetching difficulties from API");
      const data = await this.request('/api/difficulties');
      
      // Update state with difficulties
      if (data && data.difficulties) {
        TriviaState.setDifficulties(data.difficulties);
        console.log(`✅ Loaded ${data.difficulties.length} difficulties`);
      }
      
      return data;
    } catch (error) {
      console.error("❌ Error fetching difficulties:", error);
      
      // Try fallback via Twitch messaging
      console.log("🔄 Trying Twitch messaging as fallback for difficulties");
      TwitchService.sendMessage({
        type: 'GET_DIFFICULTIES'
      });
      
      throw error;
    }
  },
  
  /**
   * Get question stats based on filters
   * @param {Array} categories - Array of category IDs
   * @param {Array} difficulties - Array of difficulty levels
   * @returns {Promise<Object>} - Response from server
   */
  async getQuestionStats(categories = [], difficulties = []) {
    try {
      console.log("📊 Fetching question stats with filters:", { categories, difficulties });
      
      // Build query string
      const params = new URLSearchParams();
      
      if (categories && categories.length > 0) {
        params.append('categories', categories.join(','));
      }
      
      if (difficulties && difficulties.length > 0) {
        params.append('difficulties', difficulties.join(','));
      }
      
      const endpoint = `/api/sample-questions?${params.toString()}`;
      const data = await this.request(endpoint);
      
      // Update state with question count
      if (data && data.totalMatching !== undefined) {
        TriviaState.setTotalQuestions(data.totalMatching);
        console.log(`✅ Found ${data.totalMatching} questions matching filters`);
      }
      
      return data;
    } catch (error) {
      console.error("❌ Error fetching question stats:", error);
      
      // Try fallback via Twitch messaging
      console.log("🔄 Trying Twitch messaging as fallback for question stats");
      TwitchService.sendMessage({
        type: 'GET_QUESTION_STATS',
        categories: categories,
        difficulties: difficulties
      });
      
      throw error;
    }
  },
  
  /**
   * Get leaderboard data from API
   * @returns {Promise<Object>} - Response from server
   */
  async getLeaderboard() {
    try {
      console.log("🏆 Fetching leaderboard data");
      const data = await this.request('/api/leaderboard');
      
      // Update state with leaderboard data
      if (data) {
        TriviaState.setLeaderboardData(data);
        console.log("✅ Leaderboard data loaded");
      }
      
      return data;
    } catch (error) {
      console.error("❌ Error fetching leaderboard:", error);
      throw error;
    }
  },
  
  /**
   * Get broadcaster settings
   * @param {string} broadcasterId - Broadcaster's Twitch ID
   * @returns {Promise<Object>} - Response from server
   */
  async getBroadcasterSettings(broadcasterId) {
    if (!broadcasterId) {
      console.error("❌ Missing broadcaster ID for fetching settings");
      return { error: "Missing broadcaster ID" };
    }
    
    try {
      console.log(`⚙️ Fetching settings for broadcaster: ${broadcasterId}`);
      const data = await this.request(`/api/settings/${broadcasterId}`);
      
      // Update state with settings
      if (data && data.settings) {
        TriviaState
          .setSelectedCategories(data.settings.active_categories || [])
          .setSelectedDifficulties(data.settings.active_difficulties || ["Easy", "Medium", "Hard"]);
        
        console.log("✅ Broadcaster settings loaded");
      }
      
      return data;
    } catch (error) {
      console.error("❌ Error fetching broadcaster settings:", error);
      
      // Try fallback via Twitch messaging
      console.log("🔄 Trying Twitch messaging as fallback for broadcaster settings");
      TwitchService.sendMessage({
        type: 'GET_BROADCASTER_SETTINGS',
        broadcasterId: broadcasterId
      });
      
      throw error;
    }
  },
  
  /**
   * Save trivia settings
   * @param {Object} settings - Settings object with answerTime and intervalTime
   * @returns {Promise<Object>} - Response from server
   */
  async saveSettings(settings) {
    if (!settings || !settings.answerTime || !settings.intervalTime) {
      console.error("❌ Invalid settings object:", settings);
      return { success: false, error: "Invalid settings" };
    }
    
    try {
      console.log("⚙️ Saving trivia settings:", settings);
      
      const data = await this.request('/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answerTime: settings.answerTime,
          intervalTime: settings.intervalTime
        })
      });
      
      // If successful, update local state
      if (data.success) {
        TriviaState.updateSettings(settings);
        console.log("✅ Settings saved successfully");
      }
      
      return data;
    } catch (error) {
      console.error("❌ Error saving settings:", error);
      
      // Try fallback via Twitch messaging
      console.log("🔄 Trying Twitch messaging as fallback for settings");
      TwitchService.sendMessage({
        type: 'UPDATE_SETTINGS',
        answerTime: settings.answerTime,
        intervalTime: settings.intervalTime
      });
      
      // Return error response
      return { 
        success: false, 
        error: error.message || "Failed to save settings",
        fallback: "Used Twitch messaging"
      };
    }
  },
  
  /**
   * Save filter preferences for broadcaster
   * @param {string} broadcasterId - Broadcaster's Twitch ID
   * @param {Object} filters - Filter object with categories and difficulties
   * @returns {Promise<Object>} - Response from server
   */
  async saveFilters(broadcasterId, filters) {
    if (!broadcasterId) {
      console.error("❌ Missing broadcaster ID for saving filters");
      return { success: false, error: "Missing broadcaster ID" };
    }
    
    try {
      console.log(`📁 Saving filters for broadcaster ${broadcasterId}:`, filters);
      
      const data = await this.request(`/api/settings/${broadcasterId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeCategories: filters.categories,
          activeDifficulties: filters.difficulties
        })
      });
      
      console.log("✅ Filters saved successfully");
      return { ...data, success: true };
    } catch (error) {
      console.error("❌ Error saving filters:", error);
      
      // Try fallback via Twitch messaging
      console.log("🔄 Trying Twitch messaging as fallback for filters");
      TwitchService.sendMessage({
        type: 'SAVE_FILTERS',
        broadcasterId: broadcasterId,
        activeCategories: filters.categories,
        activeDifficulties: filters.difficulties
      });
      
      // Return error response with fallback info
      return { 
        success: false, 
        error: error.message || "Failed to save filters",
        fallback: "Used Twitch messaging"
      };
    }
  },
  
  /**
   * Start trivia with improved error handling
   * @param {string} broadcasterId - The broadcaster's Twitch ID
   * @returns {Promise<Object>} - Response from server
   */
  async startTrivia(broadcasterId) {
    if (!broadcasterId) {
      console.error("❌ Missing broadcaster ID for starting trivia");
      return { success: false, error: "Missing broadcaster ID" };
    }
    
    // Log full request details for debugging
    console.log(`🚀 Sending start trivia request with broadcaster ID: ${broadcasterId}`);
    console.log(`🔑 Using auth token: ${TriviaState.data.authToken ? (TriviaState.data.authToken.substring(0, 10) + '...') : 'MISSING'}`);
    
    try {
      const result = await this.request('/start-trivia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcasterId })
      });
      
      console.log("✅ Start trivia API response:", result);
      TriviaState.setTriviaActive(true);
      return result;
    } catch (error) {
      console.error("❌ Error starting trivia via API:", error);
      
      // Provide more detailed error info
      const errorInfo = {
        success: false,
        error: error.message || "Failed to start trivia",
        details: {
          broadcasterId: broadcasterId,
          hasAuth: !!TriviaState.data.authToken,
          timestamp: new Date().toISOString()
        }
      };
      
      // Check the connection and try to recover
      this.checkConnection()
        .then(isConnected => {
          if (!isConnected) {
            console.log("🔄 Connection issue detected, trying Twitch messaging fallback");
            TwitchService.sendMessage({
              type: 'START_TRIVIA',
              broadcasterId
            });
          }
        });
      
      return errorInfo;
    }
  },
  
  /**
   * End trivia with improved error handling
   * @param {string} broadcasterId - The broadcaster's Twitch ID
   * @returns {Promise<Object>} - Response from server
   */
  async endTrivia(broadcasterId) {
    if (!broadcasterId) {
      console.error("❌ Missing broadcaster ID for ending trivia");
      return { success: false, error: "Missing broadcaster ID" };
    }
    
    try {
      const result = await this.request('/end-trivia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcasterId })
      });
      
      console.log("✅ End trivia API response:", result);
      TriviaState.setTriviaActive(false);
      return result;
    } catch (error) {
      console.error("❌ Error ending trivia via API:", error);
      
      // Try fallback to Twitch messaging
      console.log("🔄 Trying Twitch messaging fallback for ending trivia");
      TwitchService.sendMessage({
        type: 'END_TRIVIA',
        broadcasterId
      });
      
      // Set active state anyway for UI
      TriviaState.setTriviaActive(false);
      
      // Return a fake success response for the UI
      return { 
        success: false, 
        error: error.message || "Failed to end trivia via API",
        fallback: "Used Twitch messaging instead"
      };
    }
  },
  
  /**
   * Check API connection health
   * @returns {Promise<boolean>} True if connection is healthy
   */
  async checkConnection() {
    try {
      // Use a lightweight endpoint to check connection
      const response = await fetch(`${CONFIG.API_BASE_URL()}/api/ping`, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        // Short timeout to quickly detect issues
        signal: AbortSignal.timeout(3000)
      });
      
      return response.ok;
    } catch (error) {
      console.warn("⚠️ API connection check failed:", error);
      return false;
    }
  },
  
  /**
   * Reconnect to API and recover session
   * Call this when connection issues are detected
   */
  async reconnect() {
    console.log("🔄 Attempting API reconnection");
    
    try {
      // Request new authorization from Twitch instead of just failing
      if (!TriviaState.data.broadcasterId || !TriviaState.data.authToken) {
        console.log("🔄 Missing auth data, requesting new identity share from Twitch");
        if (window.Twitch && window.Twitch.ext && window.Twitch.ext.actions) {
          // Use the correct method
          if (typeof window.Twitch.ext.actions.requestIdShare === 'function') {
            window.Twitch.ext.actions.requestIdShare();
            return true; // We've started the reauthorization process
          }
        } else {
          console.error("❌ Twitch SDK not available for reauthorization");
          return false;
        }
      }
      
      // Rest of your reconnect function...
    } catch (error) {
      console.error("❌ Error during API reconnection:", error);
      return false;
    }
  }
};
  
  /**
   * ====================================
   * SECTION 4: UI Component Management
   * ====================================
   * Handles rendering and updating the user interface.
   * Each component has its own render and update methods.
   */
  
  const UI = {
    /**
     * Initialize all UI components
     */
    init() {
      console.log("🎨 Initializing UI components");
      // Initial renderings will happen when data is available
    },
    
    /**
     * Category UI methods
     */
    renderCategories() {
      console.log("🔍 Rendering categories");
      const container = document.getElementById(CONFIG.DOM_IDS.categoriesList);
      
      if (!container) {
        console.error("❌ Categories container not found!");
        return;
      }
      
      const categories = TriviaState.data.categories;
      
      // Handle empty state
      if (!categories || categories.length === 0) {
        container.innerHTML = `<div class="${CONFIG.CSS_CLASSES.loading}">No categories found.</div>`;
        return;
      }
      
      // Build HTML for categories
      let html = '';
      categories.forEach(category => {
        const isChecked = TriviaState.data.selectedCategories.includes(category.id) ? 'checked' : '';
        
        html += `
          <div class="checkbox-item">
            <input type="checkbox" id="cat-${category.id}" name="category" value="${category.id}" ${isChecked}>
            <label for="cat-${category.id}">${category.name || category.id}</label>
            <span class="checkbox-count">${category.questionCount || 0}</span>
          </div>
        `;
      });
      
      // Update the DOM
      container.innerHTML = html;
      
      // Add event listeners to checkboxes
      document.querySelectorAll('input[name="category"]').forEach(checkbox => {
        checkbox.addEventListener('change', this.handleCategoryChange);
      });
    },
    
    handleCategoryChange() {
      // Update selected categories in state
      const checkboxes = document.querySelectorAll('input[name="category"]:checked');
      const selectedCategories = Array.from(checkboxes).map(cb => cb.value);
      
      TriviaState.setSelectedCategories(selectedCategories);
      
      // Update question stats
      UI.updateQuestionStats();
    },
    
    /**
     * Difficulty UI methods
     */
    renderDifficulties() {
      console.log("🔍 Rendering difficulties");
      const container = document.getElementById(CONFIG.DOM_IDS.difficultiesList);
      
      if (!container) {
        console.error("❌ Difficulties container not found!");
        return;
      }
      
      const difficulties = TriviaState.data.difficulties;
      
      // Handle empty state
      if (!difficulties || difficulties.length === 0) {
        container.innerHTML = `<div class="${CONFIG.CSS_CLASSES.loading}">No difficulties found.</div>`;
        return;
      }
      
      // Build HTML for difficulties
      let html = '';
      difficulties.forEach(diff => {
        const isChecked = TriviaState.data.selectedDifficulties.includes(diff.difficulty) ? 'checked' : '';
        
        html += `
          <div class="checkbox-item">
            <input type="checkbox" id="diff-${diff.difficulty}" name="difficulty" value="${diff.difficulty}" ${isChecked}>
            <label for="diff-${diff.difficulty}">${diff.difficulty}</label>
            <span class="checkbox-count">${diff.count || 0}</span>
          </div>
        `;
      });
      
      // Update the DOM
      container.innerHTML = html;
      
      // Add event listeners to checkboxes
      document.querySelectorAll('input[name="difficulty"]').forEach(checkbox => {
        checkbox.addEventListener('change', this.handleDifficultyChange);
      });
    },
    
    handleDifficultyChange() {
      // Update selected difficulties in state
      const checkboxes = document.querySelectorAll('input[name="difficulty"]:checked');
      const selectedDifficulties = Array.from(checkboxes).map(cb => cb.value);
      
      TriviaState.setSelectedDifficulties(selectedDifficulties);
      
      // Update question stats
      UI.updateQuestionStats();
    },
    
    /**
     * Question stats UI methods
     */
    updateQuestionStats() {
      console.log("📊 Updating question stats display");
      const container = document.getElementById(CONFIG.DOM_IDS.questionStats);
      
      if (!container) {
        console.error("❌ Question stats container not found!");
        return;
      }
      
      // Show loading state
      container.innerHTML = `<div class="${CONFIG.CSS_CLASSES.loading}">Loading question statistics...</div>`;
      
      // Get filter state from state management
      const filters = TriviaState.getFilterState();
      
      // Fetch stats from API
      ApiService.getQuestionStats(filters.categories, filters.difficulties)
        .then(() => {
          this.renderQuestionStats();
        })
        .catch(() => {
          // Render with whatever data we have in state
          this.renderQuestionStats();
        });
    },
    
    renderQuestionStats() {
      const container = document.getElementById(CONFIG.DOM_IDS.questionStats);
      
      if (!container) return;
      
      const categories = TriviaState.data.selectedCategories;
      const difficulties = TriviaState.data.selectedDifficulties;
      const totalQuestions = TriviaState.data.totalQuestions;
      
      // Format user-friendly output
      let statsHtml = '';
      
      if (categories.length === 0 && difficulties.length === 0) {
        statsHtml = `<span style="color: #ffcc00;">Using all available questions (${totalQuestions})</span>`;
      } else {
        const categoryText = categories.length === 0 ? 
          "all categories" : 
          `${categories.length} selected categor${categories.length === 1 ? 'y' : 'ies'}`;
        
        const difficultyText = difficulties.length === 0 ? 
          "all difficulties" : 
          `${difficulties.length} selected difficult${difficulties.length === 1 ? 'y' : 'ies'}`;
        
        statsHtml = `
          <div>Using ${categoryText} and ${difficultyText}</div>
          <div style="margin-top: 5px; font-size: 1.1em; color: #ffcc00;">
            ${totalQuestions} questions match your selection
          </div>
        `;
      }
      
      container.innerHTML = statsHtml;
    },
    
    /**
     * Leaderboard UI methods
     */
    initializeLeaderboard() {
      console.log("🏆 Initializing leaderboard");
      
      // Initial data fetch
      this.fetchLeaderboardData();
      
      // Set up auto-refresh
      setInterval(() => this.fetchLeaderboardData(), CONFIG.REFRESH_INTERVALS.leaderboard);
    },
    
    fetchLeaderboardData() {
      const container = document.getElementById(CONFIG.DOM_IDS.leaderboardBody);
      
      if (!container) {
        console.error("❌ Leaderboard container not found!");
        return;
      }
      
      // Show loading state
      container.innerHTML = `
        <tr>
          <td colspan="3" class="loading-text">Loading leaderboard data...</td>
        </tr>
      `;
      
      // Fetch data from API
      ApiService.getLeaderboard()
        .then(() => {
          // Display the appropriate board based on current view
          this.renderLeaderboard();
        })
        .catch(error => {
          console.error("❌ Error fetching leaderboard:", error);
          container.innerHTML = `
            <tr>
              <td colspan="3" class="loading-text">Error loading leaderboard: ${error.message}</td>
            </tr>
          `;
        });
    },
    
    /**
     * Leaderboard UI methods with improved username handling
     */
    renderLeaderboard() {
      const container = document.getElementById(CONFIG.DOM_IDS.leaderboardBody);
      
      if (!container) return;
      
      // Get the appropriate data based on current view
      const currentView = TriviaState.data.currentView;
      const scores = TriviaState.data.leaderboardData[currentView] || [];
      
      // Handle empty state
      if (!scores || scores.length === 0) {
        container.innerHTML = `
          <tr>
            <td colspan="3" class="loading-text">No scores to display yet</td>
          </tr>
        `;
        return;
      }
      
      // Build HTML for leaderboard
      let html = '';
      
      scores.forEach((entry, index) => {
        const rank = index + 1;
        
        // IMPROVED: Prioritize using the username from database
        // If no username exists, create a friendlier format for the user ID
        const displayName = entry.username 
          ? this.escapeHtml(entry.username)
          : `User-${entry.userId ? entry.userId.substring(0, 5) : 'Unknown'}`;
        
        html += `
          <tr class="rank-${rank}">
            <td>${rank}</td>
            <td>${displayName}</td>
            <td>${entry.score.toLocaleString()}</td>
          </tr>
        `;
      });
      
      container.innerHTML = html;
      console.log(`✅ Displayed ${scores.length} entries in leaderboard`);
      
      // Update the active board buttons
      this.updateLeaderboardButtons();
    },
    
    updateLeaderboardButtons() {
      const sessionButton = document.getElementById(CONFIG.DOM_IDS.showSessionScores);
      const totalButton = document.getElementById(CONFIG.DOM_IDS.showTotalScores);
      
      if (!sessionButton || !totalButton) return;
      
      // Remove active class from both
      sessionButton.classList.remove(CONFIG.CSS_CLASSES.activeBoard);
      totalButton.classList.remove(CONFIG.CSS_CLASSES.activeBoard);
      
      // Add active class to current view button
      if (TriviaState.data.currentView === 'session') {
        sessionButton.classList.add(CONFIG.CSS_CLASSES.activeBoard);
      } else {
        totalButton.classList.add(CONFIG.CSS_CLASSES.activeBoard);
      }
    },
    
    /**
     * UI feedback methods
     */
    showButtonSuccess(buttonId, message = "Success!") {
      const button = document.getElementById(buttonId);
      if (!button) return;
      
      // Store the original text
      const originalHtml = button.innerHTML;
      
      // Add success class
      button.classList.add(CONFIG.CSS_CLASSES.success);
      
      // Replace content with wrapped original + temp message
      button.innerHTML = `
        <span class="${CONFIG.CSS_CLASSES.originalText}">${originalHtml}</span>
        <span class="${CONFIG.CSS_CLASSES.tempText}">${message}</span>
      `;
      
      // Remove feedback after animation completes
      setTimeout(() => {
        button.classList.remove(CONFIG.CSS_CLASSES.success);
        button.innerHTML = originalHtml;
      }, CONFIG.REFRESH_INTERVALS.buttonFeedback);
    },
    
    showButtonError(buttonId, message = "Failed!") {
      const button = document.getElementById(buttonId);
      if (!button) return;
      
      // Store the original text
      const originalHtml = button.innerHTML;
      
      // Add error class
      button.classList.add(CONFIG.CSS_CLASSES.error);
      
      // Replace content with wrapped original + temp message
      button.innerHTML = `
        <span class="${CONFIG.CSS_CLASSES.originalText}">${originalHtml}</span>
        <span class="${CONFIG.CSS_CLASSES.tempText}">${message}</span>
      `;
      
      // Remove feedback after animation completes
      setTimeout(() => {
        button.classList.remove(CONFIG.CSS_CLASSES.error);
        button.innerHTML = originalHtml;
      }, CONFIG.REFRESH_INTERVALS.buttonFeedback);
    },
    
    /**
     * Settings UI methods
     */
    updateSettingsInputs() {
      const answerTimeInput = document.getElementById(CONFIG.DOM_IDS.answerTime);
      const intervalTimeInput = document.getElementById(CONFIG.DOM_IDS.intervalTime);
      
      if (answerTimeInput) {
        answerTimeInput.value = Math.round(TriviaState.data.triviaSettings.answerTime / 1000);
      }
      
      if (intervalTimeInput) {
        intervalTimeInput.value = Math.round(TriviaState.data.triviaSettings.intervalTime / 60000);
      }
    },
    
    /**
     * UI state methods
     */
    setUIForTriviaActive(isActive) {
      this.disableSettings(isActive);
      
      // Update status display
      const statusEl = document.getElementById(CONFIG.DOM_IDS.statusDisplay);
      if (statusEl) {
        statusEl.textContent = isActive ? "Trivia is active!" : "Trivia is not running";
      }
    },
    
    disableSettings(isDisabled) {
      // Form inputs
      const elements = [
        document.getElementById(CONFIG.DOM_IDS.answerTime),
        document.getElementById(CONFIG.DOM_IDS.intervalTime),
        document.getElementById(CONFIG.DOM_IDS.saveSettings),
        document.getElementById(CONFIG.DOM_IDS.saveFilters)
      ];
      
      elements.forEach(element => {
        if (element) element.disabled = isDisabled;
      });
      
      // Category checkboxes
      document.querySelectorAll('input[name="category"]').forEach(checkbox => {
        checkbox.disabled = isDisabled;
      });
      
      // Difficulty checkboxes
      document.querySelectorAll('input[name="difficulty"]').forEach(checkbox => {
        checkbox.disabled = isDisabled;
      });
    },
    
    /**
     * Utility methods
     */
    escapeHtml(unsafe) {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  };

/**
 * ====================================
 * SECTION 5: Event Handlers
 * ====================================
 * Handles all user interactions with the UI.
 * Each handler is focused on one specific action.
 */

const EventHandlers = {
  /**
   * Main initialization function for all event handlers
   */
  init() {
    console.log("🔄 Initializing event handlers");
    
    // Attach handlers to all UI controls
    this.attachAllEventListeners();
  },
  
  /**
   * Attach all event listeners to UI elements
   */
  attachAllEventListeners() {
    // Main action buttons
    this.attachButtonListener(CONFIG.DOM_IDS.saveSettings, this.handleSaveSettings);
    this.attachButtonListener(CONFIG.DOM_IDS.startTrivia, this.handleStartTrivia);
    this.attachButtonListener(CONFIG.DOM_IDS.endTrivia, this.handleEndTrivia);
    this.attachButtonListener(CONFIG.DOM_IDS.saveFilters, this.handleSaveFilters);
    
    // Identity button (if it exists)
    this.attachButtonListener('identity-btn', this.handleRequestIdentity);
    
    // Leaderboard controls
    this.attachButtonListener(CONFIG.DOM_IDS.showSessionScores, this.handleShowSessionScores);
    this.attachButtonListener(CONFIG.DOM_IDS.showTotalScores, this.handleShowTotalScores);
    this.attachButtonListener(CONFIG.DOM_IDS.refreshLeaderboard, this.handleRefreshLeaderboard);
    
    console.log("✅ All event listeners attached");
  },
  
  /**
   * Helper to safely attach event listeners
   * @param {string} buttonId - The DOM ID of the button
   * @param {function} handler - The event handler function
   */
  attachButtonListener(buttonId, handler) {
    const button = document.getElementById(buttonId);
    if (button) {
      // Bind 'this' to ensure the handler has access to EventHandlers methods
      button.addEventListener("click", handler.bind(this));
      console.log(`✅ Attached event listener to #${buttonId}`);
    } else {
      // Not necessarily an error for optional buttons
      console.log(`ℹ️ Button #${buttonId} not found in DOM, skipping listener`);
    }
  },
  
  /**
   * Handle identity request button
   * Manually triggers the Twitch identity share flow
   */
  handleRequestIdentity(event) {
    if (event) event.preventDefault();
    console.log("🔑 Identity request button clicked");
    
    if (TwitchService.requestIdentity()) {
      this.updateStatus("Identity request sent. Please accept the prompt.");
    } else {
      this.updateStatus("Failed to request identity. Please refresh the page.");
    }
  },
  
  /**
   * Settings form handlers
   */
  handleSaveSettings(event) {
    console.log("🔘 Save Settings button clicked");
    event.preventDefault();
    
    // Verify authentication
    if (!TriviaState.hasValidAuth()) {
      console.error("❌ Missing authentication for saving settings");
      UI.showButtonError(CONFIG.DOM_IDS.saveSettings, "Auth Error!");
      
      // Try to reconnect and recover session
      this.promptReconnect("Authentication issue. Please wait...");
      return;
    }
    
    // Get and validate input values
    const answerTimeInput = document.getElementById(CONFIG.DOM_IDS.answerTime);
    const intervalTimeInput = document.getElementById(CONFIG.DOM_IDS.intervalTime);
    
    if (!answerTimeInput || !intervalTimeInput) {
      console.error("❌ Settings inputs not found in DOM");
      UI.showButtonError(CONFIG.DOM_IDS.saveSettings, "UI Error!");
      return;
    }
    
    // Convert to milliseconds and validate ranges
    const answerTime = parseInt(answerTimeInput.value, 10) * 1000; // seconds to ms
    const intervalTime = parseInt(intervalTimeInput.value, 10) * 60000; // minutes to ms
    
    // Validate input ranges
    if (isNaN(answerTime) || isNaN(intervalTime) || 
        answerTime < 5000 || answerTime > 60000 || 
        intervalTime < 60000 || intervalTime > 1800000) {
        
      console.error("❌ Invalid time values:", { answerTime, intervalTime });
      UI.showButtonError(CONFIG.DOM_IDS.saveSettings, "Invalid Input!");
      return;
    }
    
    // Prepare settings object
    const settings = { answerTime, intervalTime };
    console.log("📤 Saving settings:", settings);
    
    // Temporarily disable button to prevent multiple clicks
    const button = document.getElementById(CONFIG.DOM_IDS.saveSettings);
    if (button) button.disabled = true;
    
    // Update settings via API
    ApiService.saveSettings(settings)
      .then(data => {
        if (data.success) {
          console.log("✅ Settings saved successfully");
          UI.showButtonSuccess(CONFIG.DOM_IDS.saveSettings, "Settings Saved!");
          
          // Update state and UI
          TriviaState.updateSettings(settings);
        } else {
          console.error("❌ Error saving settings:", data.error);
          UI.showButtonError(CONFIG.DOM_IDS.saveSettings, data.error || "Save Failed!");
          
          // Check for auth issues
          if (data.error && (data.error.includes("token") || data.error.includes("auth"))) {
            this.promptReconnect("Authentication issue. Please wait...");
          }
        }
      })
      .catch(error => {
        console.error("❌ Exception saving settings:", error);
        UI.showButtonError(CONFIG.DOM_IDS.saveSettings, "Error!");
        
        // Try fallback
        console.log("🔄 Trying Twitch messaging as fallback for settings");
        TwitchService.sendMessage({
          type: 'UPDATE_SETTINGS',
          ...settings
        });
      })
      .finally(() => {
        // Re-enable button after a short delay
        setTimeout(() => {
          if (button) button.disabled = false;
        }, CONFIG.REFRESH_INTERVALS.disableDelay);
      });
  },
  
  /**
   * Filter handlers
   */
  handleSaveFilters(event) {
    console.log("💾 Save Filters button clicked");
    event.preventDefault();
    
    // Verify broadcaster ID
    const broadcasterId = TriviaState.data.broadcasterId;
    if (!broadcasterId) {
      console.error("❌ Missing broadcaster ID for saving filters");
      UI.showButtonError(CONFIG.DOM_IDS.saveFilters, "Auth Error!");
      
      // Try to reconnect
      this.promptReconnect("Missing broadcaster ID. Attempting to reconnect...");
      return;
    }
    
    // Get current filter state
    const filters = TriviaState.getFilterState();
    console.log("📊 Saving filters:", filters);
    
    // Temporarily disable button to prevent multiple clicks
    const button = document.getElementById(CONFIG.DOM_IDS.saveFilters);
    if (button) button.disabled = true;
    
    // Save filters via API
    ApiService.saveFilters(broadcasterId, filters)
      .then(data => {
        if (data.success || data.settings) {
          console.log("✅ Filters saved successfully");
          UI.showButtonSuccess(CONFIG.DOM_IDS.saveFilters, "Filters Saved!");
          
          // Update question stats display if count is returned
          if (data.questionCount) {
            TriviaState.setTotalQuestions(data.questionCount);
            UI.renderQuestionStats();
          } else {
            // Otherwise refresh question stats
            UI.updateQuestionStats();
          }
        } else {
          console.error("❌ Error saving filters:", data.error);
          UI.showButtonError(CONFIG.DOM_IDS.saveFilters, data.error || "Save Failed!");
          
          // Check for auth or connection issues
          if (data.error && (data.error.includes("token") || data.error.includes("auth"))) {
            this.promptReconnect("Authentication issue. Please wait...");
          }
        }
      })
      .catch(error => {
        console.error("❌ Exception saving filters:", error);
        UI.showButtonError(CONFIG.DOM_IDS.saveFilters, "Error!");
        
        // Try fallback
        console.log("🔄 Trying Twitch messaging as fallback for filters");
        TwitchService.sendMessage({
          type: 'SAVE_FILTERS',
          broadcasterId: broadcasterId,
          activeCategories: filters.categories,
          activeDifficulties: filters.difficulties
        });
        
        // Still update stats on error, as we might have updated state
        UI.updateQuestionStats();
      })
      .finally(() => {
        // Re-enable button after a short delay
        setTimeout(() => {
          if (button) button.disabled = false;
        }, CONFIG.REFRESH_INTERVALS.disableDelay);
      });
  },
  
  /**
   * Trivia control handlers
   */
  handleStartTrivia(event) {
    console.log("▶️ Start Trivia button clicked");
    event.preventDefault();
    
    // Get broadcaster ID with better validation
    const broadcasterId = TriviaState.data.broadcasterId;
    if (!broadcasterId) {
      console.error("❌ Missing broadcaster ID for starting trivia");
      UI.showButtonError(CONFIG.DOM_IDS.startTrivia, "Auth Error!");
      
      // Try to reconnect and recover session using TwitchService instead of ApiService
      TwitchService.reconnect().then(success => {
        if (success) {
          // Prompt user to try again after reconnection
          setTimeout(() => {
            UI.showButtonError(CONFIG.DOM_IDS.startTrivia, "Try Again!");
          }, 1000);
        } else {
          this.promptReconnect("Authentication issue. Please wait...");
        }
      });
      return;
    }
    
    // Check if already active
    if (TriviaState.data.triviaActive) {
      console.warn("⚠️ Trivia is already active!");
      UI.showButtonError(CONFIG.DOM_IDS.startTrivia, "Already Active!");
      return;
    }
    
    // Verify token is available
    if (!TriviaState.data.authToken) {
      console.error("❌ Missing auth token for starting trivia");
      UI.showButtonError(CONFIG.DOM_IDS.startTrivia, "Auth Error!");
      
      // Try to reconnect
      this.promptReconnect("Authentication error. Please try again.");
      return;
    }
    
    // Pre-emptively update UI state (optimistic update)
    TriviaState.setTriviaActive(true);
    UI.setUIForTriviaActive(true);
    
    // Start trivia via API with better error handling
    ApiService.startTrivia(broadcasterId)
      .then(data => {
        if (data.success) {
          console.log("✅ Trivia started successfully");
          UI.showButtonSuccess(CONFIG.DOM_IDS.startTrivia, "Trivia Started!");
          
          // Ensure UI is up to date
          TriviaState.setTriviaActive(true);
          UI.setUIForTriviaActive(true);
        } else {
          console.error("❌ Error starting trivia:", data.error || "Unknown error");
          UI.showButtonError(CONFIG.DOM_IDS.startTrivia, data.error || "Start Failed!");
          
          // If we have specific connection errors, try to recover
          if (data.error && (data.error.includes("connection") || data.error.includes("token"))) {
            this.promptReconnect("Connection issue. Please try again.");
          }
          
          // Only revert state if we don't have a fallback confirmation
          if (!data.fallback) {
            TriviaState.setTriviaActive(false);
            UI.setUIForTriviaActive(false);
          }
        }
      })
      .catch(error => {
        console.error("❌ Exception starting trivia:", error);
        UI.showButtonError(CONFIG.DOM_IDS.startTrivia, "Error!");
        
        // Try Twitch messaging as a fallback
        console.log("🔄 Trying Twitch messaging as fallback for start trivia");
        TwitchService.sendMessage({
          type: 'START_TRIVIA',
          broadcasterId
        });
      });
  },
  
  /**
   * Handle end trivia button click with better error handling
   */
  handleEndTrivia(event) {
    console.log("⛔ End Trivia button clicked");
    event.preventDefault();
    
    // Get broadcaster ID with better validation
    const broadcasterId = TriviaState.data.broadcasterId;
    if (!broadcasterId) {
      console.error("❌ Missing broadcaster ID for ending trivia");
      UI.showButtonError(CONFIG.DOM_IDS.endTrivia, "Auth Error!");
      return;
    }
    
    // Check if currently active
    if (!TriviaState.data.triviaActive) {
      console.warn("⚠️ Trivia is not active!");
      UI.showButtonError(CONFIG.DOM_IDS.endTrivia, "Not Active!");
      return;
    }
    
    // Pre-emptively update UI state (optimistic update)
    TriviaState.setTriviaActive(false);
    UI.setUIForTriviaActive(false);
    
    // End trivia via API
    ApiService.endTrivia(broadcasterId)
      .then(data => {
        if (data.success) {
          console.log("✅ Trivia ended successfully");
          UI.showButtonSuccess(CONFIG.DOM_IDS.endTrivia, "Trivia Ended!");
          
          // Refresh leaderboard to show final scores
          UI.fetchLeaderboardData();
        } else {
          console.error("❌ Error ending trivia:", data.error);
          
          // If we used the fallback, still show success
          if (data.fallback) {
            UI.showButtonSuccess(CONFIG.DOM_IDS.endTrivia, "Via Twitch!");
          } else {
            UI.showButtonError(CONFIG.DOM_IDS.endTrivia, data.error || "End Failed!");
            
            // Revert state on error
            TriviaState.setTriviaActive(true);
            UI.setUIForTriviaActive(true);
          }
        }
      })
      .catch(error => {
        console.error("❌ Exception ending trivia:", error);
        
        // Try the fallback via Twitch directly
        console.log("🔄 Trying Twitch messaging as fallback for end trivia");
        TwitchService.sendMessage({
          type: 'END_TRIVIA',
          broadcasterId
        });
        
        // Show success message for the fallback attempt
        UI.showButtonSuccess(CONFIG.DOM_IDS.endTrivia, "Via Twitch!");
      });
  },
  
  /**
   * Leaderboard control handlers
   */
  handleShowSessionScores(event) {
    console.log("🏆 Show Session Scores clicked");
    event.preventDefault();
    
    // Update state
    TriviaState.setLeaderboardView('session');
    
    // Update UI
    UI.renderLeaderboard();
  },
  
  handleShowTotalScores(event) {
    console.log("🏆 Show Total Scores clicked");
    event.preventDefault();
    
    // Update state
    TriviaState.setLeaderboardView('total');
    
    // Update UI
    UI.renderLeaderboard();
  },
  
  handleRefreshLeaderboard(event) {
    console.log("🔄 Refresh Leaderboard clicked");
    event.preventDefault();
    
    // Refresh leaderboard data
    UI.fetchLeaderboardData();
  },
  
  /**
   * Prompt user to reconnect due to connection/auth issues
   * Uses the new TwitchService.reconnect method
   * @param {string} message - Message to display
   */
  promptReconnect(message) {
    console.log(`🔄 Prompting reconnect: ${message}`);
    
    // Show status message
    this.updateStatus(message);
    
    // Try to reconnect using TwitchService
    TwitchService.reconnect().then(success => {
      if (success) {
        this.updateStatus("Reconnected successfully!");
      } else {
        // If TwitchService reconnect fails, provide manual option
        this.updateStatus("Reconnection failed. Please try manually sharing your identity.");
        
        // Add a temporary identity button if it doesn't exist
        if (!document.getElementById('identity-btn')) {
          const container = document.getElementById(CONFIG.DOM_IDS.statusDisplay)?.parentNode;
          if (container) {
            const tempButton = document.createElement('button');
            tempButton.id = 'temp-identity-btn';
            tempButton.className = 'temp-auth-button';
            tempButton.textContent = '🔑 Share Identity for Authentication';
            tempButton.onclick = this.handleRequestIdentity.bind(this);
            container.appendChild(tempButton);
            
            // Remove after 15 seconds
            setTimeout(() => {
              if (tempButton.parentNode) {
                tempButton.parentNode.removeChild(tempButton);
              }
            }, 15000);
          }
        }
      }
    });
  },
  
  /**
   * Form validation helpers
   */
  validateTimeInput(value, min, max) {
    const parsed = parseInt(value, 10);
    return !isNaN(parsed) && parsed >= min && parsed <= max;
  },
  
  /**
   * Helper to show status updates
   * @param {string} message - The status message to display
   */
  updateStatus(message) {
    const statusEl = document.getElementById(CONFIG.DOM_IDS.statusDisplay);
    if (statusEl) {
      statusEl.textContent = message;
      
      // Highlight the status message briefly to draw attention
      statusEl.style.transition = 'background-color 0.3s ease';
      statusEl.style.backgroundColor = 'rgba(106, 61, 232, 0.2)';
      setTimeout(() => {
        statusEl.style.backgroundColor = 'transparent';
      }, 800);
    }
  }
};

/**
 * ====================================
 * SECTION 6: Twitch Integration
 * ====================================
 * Handles all interactions with the Twitch Extension SDK.
 * Responsible for authentication, messaging, and PubSub.
 */

const TwitchService = {
  /**
   * Initialize Twitch integration
   */
  init() {
    console.log("🔄 Initializing Twitch integration");
    
    if (window.Twitch && window.Twitch.ext) {
      console.log("✅ Twitch Extension SDK available");
      
      // Check if we're already authorized
      if (window.Twitch.ext.viewer && window.Twitch.ext.viewer.id) {
        console.log("👤 Already have viewer identity:", window.Twitch.ext.viewer.id);
        console.log("🎙️ Channel:", window.Twitch.ext.viewer.channelId);
        // Update status
        if (document.getElementById(CONFIG.DOM_IDS.statusDisplay)) {
          document.getElementById(CONFIG.DOM_IDS.statusDisplay).textContent = 
            "Identity available. Loading...";
        }
      }
      
      // CORRECTED: Use proper authentication request method
      if (window.Twitch.ext.actions && typeof window.Twitch.ext.actions.requestIdShare === 'function') {
        console.log("🔑 Requesting Twitch identity sharing");
        window.Twitch.ext.actions.requestIdShare();
      }
      
      // Try to load saved auth data first (before setting up listeners)
      this.loadSavedAuth();
      
      // Set up listeners
      this.setupMessageListener();
      this.setupAuthorization();
      this.setupBroadcasterIdentity();
      
      // Set up dev fallback for testing environments
      if (!Utils.isProduction()) {
        this.setupDevFallback();
      }
    } else {
      console.error("❌ Twitch Extension SDK not found");
      
      // Only create a mock in development environments
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.warn("⚠️ Creating mock Twitch for development");
        this.createMockForTesting();
      }
    }
  },
  
  /**
   * Set up broadcaster identity tracking with better error handling
   * Ensures at least the broadcaster has their username in the system
   */
  setupBroadcasterIdentity() {
    if (!window.Twitch || !window.Twitch.ext) {
      console.error("❌ Twitch Extension SDK not available");
      return;
    }
    
    // Check if we get the channel info
    window.Twitch.ext.onAuthorized((auth) => {
      if (auth.channelId) {
        console.log(`🎙️ Extension running on channel ID: ${auth.channelId}`);
        
        // Store broadcaster ID for API calls
        TriviaState.data.broadcasterId = auth.channelId;
        
        // Try to get broadcaster display name from Twitch SDK
        if (window.Twitch.ext.viewer && window.Twitch.ext.viewer.channelDisplayName) {
          const broadcasterName = window.Twitch.ext.viewer.channelDisplayName;
          console.log(`🎙️ Channel display name: ${broadcasterName}`);
          
          // Store for API calls
          TriviaState.data.broadcasterName = broadcasterName;
          
          // Send to server - special case for broadcaster
          this.sendServerBroadcasterInfo(auth.channelId, broadcasterName, auth.token);
        } else {
          // Try to resolve via API endpoint with better error handling
          this.resolveBroadcasterViaAPI(auth.channelId, auth.token);
        }
      }
    });
  },

  /**
   * Resolve broadcaster info via API with better error handling
   */
  resolveBroadcasterViaAPI(channelId, token) {
    if (!channelId) {
      console.error("❌ Missing channelId for broadcaster resolution");
      return;
    }
    
    console.log(`🔍 Resolving broadcaster info via API for channel ${channelId}`);
    console.log(`🔑 Token available: ${token ? 'YES' : 'NO'}`);
    
    // Make the API request with better formatting and error handling
    fetch(`${CONFIG.API_BASE_URL()}/api/set-broadcaster-name`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : undefined
      },
      body: JSON.stringify({
        channelId: channelId,
        jwt: token,
        timestamp: Date.now()  // Add timestamp for debugging
      })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.success && data.displayName) {
        console.log(`🎙️ Resolved broadcaster name via API: ${data.displayName}`);
        TriviaState.data.broadcasterName = data.displayName;
      } else {
        console.warn(`⚠️ Server response did not contain broadcaster name: ${JSON.stringify(data)}`);
      }
    })
    .catch(error => {
      console.error("❌ Failed to resolve broadcaster name:", error);
      
      // Try fallback method - send directly to server
      if (token) {
        console.log("🔄 Trying direct Twitch API lookup fallback");
        this.sendServerBroadcasterInfo(channelId, null, token);
      }
    });
  },

  /**
   * Send broadcaster info directly to server with JWT
   * This allows the server to use the token to look up the info
   */
  sendServerBroadcasterInfo(channelId, displayName, token) {
    // Build the message data
    const messageData = {
      type: 'BROADCASTER_IDENTITY',
      channelId: channelId,
    };
    
    // Add display name if available
    if (displayName) {
      messageData.displayName = displayName;
    }
    
    // Send to server with JWT in headers
    fetch(`${CONFIG.API_BASE_URL()}/twitch/broadcaster-identity`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : undefined
      },
      body: JSON.stringify(messageData)
    })
    .then(response => response.json())
    .then(data => {
      console.log("✅ Broadcaster identity sent to server:", data);
    })
    .catch(error => {
      console.error("❌ Error sending broadcaster identity to server:", error);
    });
  },

  /**
   * Set up Twitch authorization handling with better token management
   */
  setupAuthorization() {
    if (!window.Twitch || !window.Twitch.ext) {
      console.error("❌ Cannot set up authorization: Twitch SDK not available");
      return;
    }
    
    window.Twitch.ext.onAuthorized((auth) => {
      // Log full auth details (with token partially masked)
      const maskedToken = auth.token ? 
        `${auth.token.substring(0, 10)}...${auth.token.substring(auth.token.length - 5)}` : 
        'MISSING';
        
      console.log(`🔑 AUTHORIZED: userId=${auth.userId}, channelId=${auth.channelId}, token=${maskedToken}`);
      
      // Validate auth data before storing
      if (!auth.channelId || !auth.token) {
        console.error("❌ Incomplete auth data received:", auth);
        EventHandlers.updateStatus("Authentication error. Please refresh.");
        return;
      }
      
      // Store auth data in state with validation
      TriviaState.setAuthData(auth.channelId, auth.token);
      
      // Save to session storage
      this.saveAuthToSession(auth);
      
      // Update UI to reflect authentication
      EventHandlers.updateStatus("✅ Authentication successful!");
      
      // Initialize app data after authorization
      this.initializeAfterAuth();
    });
  },

  /**
   * Save current auth data to session storage
   * This allows persistence when the panel is closed and reopened
   * @param {Object} auth - Auth data from Twitch
   */
  saveAuthToSession(auth) {
    try {
      if (!auth || !auth.channelId || !auth.token) {
        console.warn("⚠️ Incomplete auth data, not saving to session storage");
        return false;
      }
      
      // Store essential auth data
      const authData = {
        channelId: auth.channelId,
        token: auth.token,
        userId: auth.userId,
        clientId: auth.clientId,
        timestamp: Date.now()
      };
      
      // Save to session storage
      sessionStorage.setItem('twitchAuthData', JSON.stringify(authData));
      console.log("💾 Auth data saved to session storage");
      
      // Also log if the user has allowed identity sharing
      if (window.Twitch.ext.viewer && window.Twitch.ext.viewer.isLinked) {
        console.log("👤 User has shared identity. Username:", 
          window.Twitch.ext.viewer.displayName || "unknown");
      }
      
      return true;
    } catch (error) {
      console.error("❌ Failed to save auth data to session storage:", error);
      return false;
    }
  },
  
  /**
   * Load saved auth data from session storage
   * Called during initialization before onAuthorized
   */
  loadSavedAuth() {
    try {
      const savedAuth = sessionStorage.getItem('twitchAuthData');
      if (!savedAuth) return false;
      
      const authData = JSON.parse(savedAuth);
      console.log("📂 Found saved auth data in session storage");
      
      // Check if data is still fresh (under 1 hour old)
      const now = Date.now();
      const age = now - (authData.timestamp || 0);
      if (age > 3600000) { // 1 hour in milliseconds
        console.warn("⚠️ Saved auth data is expired, waiting for new authorization");
        sessionStorage.removeItem('twitchAuthData');
        return false;
      }
      
      // Use saved auth data immediately
      TriviaState.setAuthData(authData.channelId, authData.token);
      console.log("🔑 Using saved auth data:", 
        `Channel: ${authData.channelId}, Token: ${authData.token?.substring(0, 10)}...`);
      
      // Initialize immediately with saved data
      this.initializeAfterAuth();
      return true;
    } catch (error) {
      console.error("❌ Error loading saved auth data:", error);
      return false;
    }
  },
  
  /**
   * Set up a development fallback for auth
   * Only used in development environments
   */
  setupDevFallback() {
    // Only use in development environments
    if (Utils.isProduction()) return;
    
    console.log("🔧 Setting up development fallback auth");
    
    // If we haven't gotten auth within 3 seconds, create a fallback
    setTimeout(() => {
      if (!TriviaState.hasValidAuth()) {
        console.log("⚠️ No auth after timeout, using development fallback");
        
        // Set minimal auth data for development
        TriviaState.setAuthData("123456789", "dev_mock_token_for_testing");
        
        // Update status
        EventHandlers.updateStatus("Using development fallback auth");
        
        // Initialize app data
        this.initializeAfterAuth();
      }
    }, 3000);
  },
  
  /**
   * Set up listener for Twitch PubSub messages
   */
  setupMessageListener() {
    if (!window.Twitch || !window.Twitch.ext) {
      console.error("❌ Cannot set up message listener: Twitch SDK not available");
      return;
    }
    
    window.Twitch.ext.listen("broadcast", (target, contentType, message) => {
      console.log("📩 Received Twitch broadcast:", target, contentType);
      
      try {
        // Parse the message
        const data = JSON.parse(message);
        console.log("📢 Parsed broadcast data:", data);
        
        // Process the message
        this.handleMessage(data);
      } catch (err) {
        console.error("❌ Error parsing Twitch message:", err);
      }
    });
    
    console.log("✅ Twitch message listener set up");
  },
  
  /**
   * Initialize data loading after authentication
   */
  initializeAfterAuth() {
    console.log("🔄 Loading initial data after Twitch auth");
    
    // Load categories from API or Twitch
    ApiService.getCategories()
      .then(() => {
        UI.renderCategories();
      })
      .catch(error => {
        console.error("❌ Failed to load categories:", error);
      });
    
    // Load difficulties from API or Twitch
    ApiService.getDifficulties()
      .then(() => {
        UI.renderDifficulties();
      })
      .catch(error => {
        console.error("❌ Failed to load difficulties:", error);
      });
    
    // Load broadcaster settings (filter preferences)
    ApiService.getBroadcasterSettings(TriviaState.data.broadcasterId)
      .then(() => {
        // Update UI checkboxes based on loaded settings
        UI.renderCategories();
        UI.renderDifficulties();
        UI.updateQuestionStats();
      })
      .catch(error => {
        console.error("❌ Failed to load broadcaster settings:", error);
      });
    
    // Request broadcaster settings via Twitch as fallback
    this.sendMessage({
      type: 'GET_BROADCASTER_SETTINGS',
      broadcasterId: TriviaState.data.broadcasterId
    });
  },
  
  /**
   * Handle received Twitch messages
   * @param {Object} data - The parsed message data
   */
  handleMessage(data) {
    if (!data || !data.type) {
      console.warn("⚠️ Received invalid message format from Twitch");
      return;
    }
    
    switch (data.type) {
      // Settings messages
      case "COUNTDOWN_UPDATE":
          console.log("⏱️ Received countdown update with time remaining:", data.timeRemaining);
          break;

      case "SETTINGS_UPDATE":
      case "UPDATE_SETTINGS":
        console.log("⚙️ Received settings update:", data);
        
        // Update local settings state
        TriviaState.updateSettings({
          answerTime: data.answerTime,
          intervalTime: data.intervalTime
        });
        
        // Update UI
        UI.updateSettingsInputs();
        EventHandlers.updateStatus("Settings updated!");
        break;
      
      // Trivia state messages
      case "TRIVIA_START":
      case "START_TRIVIA":
        console.log("🚀 Received trivia start notification");
        TriviaState.setTriviaActive(true);
        UI.setUIForTriviaActive(true);
        EventHandlers.updateStatus("Trivia has started!");
        break;
      
      case "TRIVIA_END":
      case "END_TRIVIA":
        console.log("⛔ Received trivia end notification");
        TriviaState.setTriviaActive(false);
        UI.setUIForTriviaActive(false);
        EventHandlers.updateStatus("Trivia has ended!");
        
        // Refresh leaderboard to show final scores
        UI.fetchLeaderboardData();
        break;
      
      // Data responses
      case "CATEGORIES_RESPONSE":
        console.log("📚 Received categories response:", data.categories);
        TriviaState.setCategories(data.categories);
        UI.renderCategories();
        break;
      
      case "DIFFICULTIES_RESPONSE":
        console.log("🔄 Received difficulties response:", data.difficulties);
        TriviaState.setDifficulties(data.difficulties);
        UI.renderDifficulties();
        break;
      
      case "QUESTION_STATS_RESPONSE":
        console.log("📊 Received question stats response:", data);
        TriviaState.setTotalQuestions(data.totalMatching || 0);
        UI.renderQuestionStats();
        break;
      
      case "FILTERS_SAVED":
        console.log("💾 Received filter save confirmation:", data);
        EventHandlers.updateStatus(data.message || "Filters saved successfully!");
        
        // Update question count if available
        if (data.questionCount) {
          TriviaState.setTotalQuestions(data.questionCount);
          UI.renderQuestionStats();
        }
        break;
      
      case "BROADCASTER_SETTINGS_RESPONSE":
        console.log("⚙️ Received broadcaster settings:", data.settings);
        
        if (data.settings) {
          // Update state with received settings
          TriviaState
            .setSelectedCategories(data.settings.active_categories)
            .setSelectedDifficulties(data.settings.active_difficulties);
          
          // Update UI
          UI.renderCategories();
          UI.renderDifficulties();
          UI.updateQuestionStats();
        }
        break;
      
      default:
        console.warn("⚠️ Unknown message type received:", data.type);
        break;
    }
  },
  
  /**
   * Helper to manually trigger identity request
   * Can be called directly for manual authentication
   * @returns {boolean} Success or failure
   */
  requestIdentity() {
    if (window.Twitch && window.Twitch.ext && window.Twitch.ext.actions) {
      if (typeof window.Twitch.ext.actions.requestIdShare === 'function') {
        console.log("🔑 Manually requesting Twitch identity sharing");
        window.Twitch.ext.actions.requestIdShare();
        return true;
      }
    }
    console.error("❌ Cannot request identity: Twitch SDK action not available");
    return false;
  },
  
  /**
   * Attempt to reconnect and get fresh authentication
   * @returns {Promise<boolean>} Success or failure
   */
  async reconnect() {
    console.log("🔄 Attempting API reconnection");
    
    try {
      // Request new authorization from Twitch instead of just failing
      if (!TriviaState.data.broadcasterId || !TriviaState.data.authToken) {
        console.log("🔄 Missing auth data, requesting new identity share from Twitch");
        if (window.Twitch && window.Twitch.ext && window.Twitch.ext.actions) {
          // Use the correct method
          if (typeof window.Twitch.ext.actions.requestIdShare === 'function') {
            window.Twitch.ext.actions.requestIdShare();
            return true; // We've started the reauthorization process
          }
        } else {
          console.error("❌ Twitch SDK not available for reauthorization");
          return false;
        }
      }
      
      // If we have auth data already, try to test it
      if (TriviaState.data.authToken) {
        // Test token with a simple API call
        try {
          const testResponse = await fetch(`${CONFIG.API_BASE_URL()}/api/ping`, {
            headers: {
              'Authorization': `Bearer ${TriviaState.data.authToken}`
            }
          });
          
          if (testResponse.ok) {
            console.log("✅ Token still valid");
            return true;
          } else {
            console.log("❌ Token invalid, requesting new identity");
            this.requestIdentity();
          }
        } catch (error) {
          console.error("❌ Token test failed:", error);
          this.requestIdentity();
        }
      }
      
      return false;
    } catch (error) {
      console.error("❌ Error during API reconnection:", error);
      return false;
    }
  },
  
  /**
   * Send a message via Twitch PubSub
   * @param {Object} message - The message to send
   * @returns {boolean} Success status
   */
  sendMessage(message) {
    if (!window.Twitch || !window.Twitch.ext) {
      console.error("❌ Twitch SDK not available for sending messages");
      return false;
    }
    
    try {
      console.log("📤 Sending Twitch message:", message);
      window.Twitch.ext.send('broadcast', 'application/json', message);
      return true;
    } catch (error) {
      console.error("❌ Error sending Twitch message:", error);
      return false;
    }
  },
  
  /**
   * Send message via Twitch server endpoint (alternative)
   * @param {string} channelId - The channel to send to
   * @param {Object} message - The message to send
   */
  async sendServerMessage(channelId, message) {
    try {
      const response = await fetch(`${CONFIG.API_BASE_URL()}/twitch/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: channelId || TriviaState.data.broadcasterId,
          message: message
        })
      });
      
      const data = await response.json();
      console.log("📡 Server message endpoint response:", data);
      return data;
    } catch (error) {
      console.error("❌ Error using server message endpoint:", error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Create mock Twitch for testing in development
   * Simulates Twitch SDK for local development
   */
  createMockForTesting() {
    console.warn("⚠️ Creating mock Twitch object for testing");
    
    // Create mock Twitch object
    window.Twitch = {
      ext: {
        actions: {
          // Update mock to match real SDK method names
          requestIdShare: () => {
            console.log("🔧 Mock requestIdShare called");
            
            // Auto-resolve with mock data in development
            setTimeout(() => {
              if (window.Twitch.ext.onAuthorized && typeof window.Twitch.ext.onAuthorized.callback === 'function') {
                window.Twitch.ext.onAuthorized.callback({
                  userId: "mock-user-123",
                  channelId: "70361469", 
                  token: "mock-token-for-testing"
                });
              }
            }, 500);
          }
        },
        
        onAuthorized: (callback) => {
          console.log("🔧 Mock Twitch auth handler registered");
          window.Twitch.ext.onAuthorized.callback = callback;
          
          // Simulate auth with test broadcaster ID
          setTimeout(() => {
            callback({
              userId: "mock-user-123",
              channelId: "70361469", // Test broadcaster ID
              token: "mock-token-for-testing"
            });
          }, 500);
        },
        
        listen: (type, callback) => {
          console.log("🔧 Mock Twitch listen registered for:", type);
          window.mockTwitchCallback = callback; // Store for simulated events
        },
        
        send: (target, contentType, message) => {
          console.log("🔧 Mock Twitch send:", { target, contentType, message });
          
          // Simulate responses based on message type
          this.simulateMockResponse(message);
        },
        
        // Mock viewer object
        viewer: {
          id: "mock-user-123",
          isLinked: true,
          displayName: "MockUser",
          channelId: "70361469"
        }
      }
    };
    
    // Re-initialize with mock
    this.init();
    
    // Add some debug controls for mock
    this.addMockTwitchControls();
  },
  
  /**
   * Simulate response for mock Twitch
   * @param {Object} message - The message to respond to
   */
  simulateMockResponse(message) {
    if (!message || !message.type) return;
    
    setTimeout(() => {
      switch (message.type) {
        case 'GET_CATEGORIES':
          const mockCategories = [
            { id: "gaming", name: "Gaming", questionCount: 50 },
            { id: "history", name: "History", questionCount: 30 },
            { id: "science", name: "Science", questionCount: 25 },
            { id: "music", name: "Music", questionCount: 45 },
            { id: "movies", name: "Movies & TV", questionCount: 60 }
          ];
          
          if (window.mockTwitchCallback) {
            window.mockTwitchCallback('broadcast', 'application/json', 
              JSON.stringify({
                type: 'CATEGORIES_RESPONSE',
                categories: mockCategories
              })
            );
          }
          
          // Also update state directly
          TriviaState.setCategories(mockCategories);
          UI.renderCategories();
          break;
          
        case 'GET_DIFFICULTIES':
          const mockDifficulties = [
            { difficulty: "Easy", count: 40 },
            { difficulty: "Medium", count: 50 },
            { difficulty: "Hard", count: 15 }
          ];
          
          if (window.mockTwitchCallback) {
            window.mockTwitchCallback('broadcast', 'application/json', 
              JSON.stringify({
                type: 'DIFFICULTIES_RESPONSE',
                difficulties: mockDifficulties
              })
            );
          }
          
          // Also update state directly
          TriviaState.setDifficulties(mockDifficulties);
          UI.renderDifficulties();
          break;
          
        case 'GET_QUESTION_STATS':
          if (window.mockTwitchCallback) {
            window.mockTwitchCallback('broadcast', 'application/json', 
              JSON.stringify({
                type: 'QUESTION_STATS_RESPONSE',
                totalMatching: 85,
                filters: {
                  categories: message.categories,
                  difficulties: message.difficulties
                }
              })
            );
          }
          
          // Also update state directly
          TriviaState.setTotalQuestions(85);
          UI.renderQuestionStats();
          break;
          
        case 'GET_BROADCASTER_SETTINGS':
          if (window.mockTwitchCallback) {
            window.mockTwitchCallback('broadcast', 'application/json',
              JSON.stringify({
                type: 'BROADCASTER_SETTINGS_RESPONSE',
                settings: {
                  broadcaster_id: message.broadcasterId || '70361469',
                  active_categories: ['gaming', 'science'],
                  active_difficulties: ['Easy', 'Medium', 'Hard']
                }
              })
            );
          }
          break;
          
        case 'UPDATE_SETTINGS':
          if (window.mockTwitchCallback) {
            window.mockTwitchCallback('broadcast', 'application/json',
              JSON.stringify({
                type: 'SETTINGS_UPDATE',
                answerTime: message.answerTime,
                intervalTime: message.intervalTime
              })
            );
          }
          break;
          
        case 'START_TRIVIA':
          if (window.mockTwitchCallback) {
            window.mockTwitchCallback('broadcast', 'application/json',
              JSON.stringify({
                type: 'TRIVIA_START'
              })
            );
          }
          break;
          
        case 'END_TRIVIA':
          if (window.mockTwitchCallback) {
            window.mockTwitchCallback('broadcast', 'application/json',
              JSON.stringify({
                type: 'TRIVIA_END'
              })
            );
          }
          break;
      }
    }, 500); // Simulate network delay
  },
  
  /**
   * Add mock Twitch debug controls
   * Only used in development environment
   */
  addMockTwitchControls() {
    // Only add if we're in development
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return;
    }
    
    // Create a floating debug panel
    const debugPanel = document.createElement('div');
    debugPanel.style.position = 'fixed';
    debugPanel.style.bottom = '10px';
    debugPanel.style.right = '10px';
    debugPanel.style.padding = '10px';
    debugPanel.style.background = 'rgba(0,0,0,0.8)';
    debugPanel.style.color = '#fff';
    debugPanel.style.borderRadius = '5px';
    debugPanel.style.zIndex = '9999';
    debugPanel.style.fontSize = '12px';
    debugPanel.innerHTML = `
      <div style="margin-bottom:8px"><strong>Mock Twitch Controls</strong></div>
      <button id="mock-auth" style="margin:2px;padding:5px">Simulate Auth</button>
      <button id="mock-trivia-start" style="margin:2px;padding:5px">Simulate Trivia Start</button>
      <button id="mock-trivia-end" style="margin:2px;padding:5px">Simulate Trivia End</button>
    `;
    
    document.body.appendChild(debugPanel);
    
    // Add event listeners
    document.getElementById('mock-auth').addEventListener('click', () => {
      if (window.Twitch.ext.onAuthorized && typeof window.Twitch.ext.onAuthorized.callback === 'function') {
        window.Twitch.ext.onAuthorized.callback({
          userId: "mock-user-123",
          channelId: "70361469", 
          token: "mock-token-for-testing"
        });
      }
    });
    
    document.getElementById('mock-trivia-start').addEventListener('click', () => {
      if (window.mockTwitchCallback) {
        window.mockTwitchCallback('broadcast', 'application/json',
          JSON.stringify({ type: 'TRIVIA_START' })
        );
      }
    });
    
    document.getElementById('mock-trivia-end').addEventListener('click', () => {
      if (window.mockTwitchCallback) {
        window.mockTwitchCallback('broadcast', 'application/json',
          JSON.stringify({ type: 'TRIVIA_END' })
        );
      }
    });
  }
};

/**
 * ====================================
 * SECTION 7: Utilities and Helpers
 * ====================================
 * Common utility functions used throughout the application.
 * These provide basic functionality that doesn't belong to a specific domain.
 */

const Utils = {
    /**
     * Escape HTML to prevent XSS attacks
     * @param {string} unsafe - Potentially unsafe string containing HTML
     * @returns {string} Escaped safe string
     */
    escapeHtml(unsafe) {
      if (!unsafe || typeof unsafe !== 'string') return '';
      
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },
    
    /**
     * Create a debounced function to limit frequent calls
     * @param {function} func - The function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {function} Debounced function
     */
    debounce(func, wait) {
      let timeout;
      
      return function executedFunction(...args) {
        const context = this;
        
        const later = () => {
          timeout = null;
          func.apply(context, args);
        };
        
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },
    
    /**
     * Format number with commas for readability
     * @param {number} num - Number to format
     * @returns {string} Formatted number string
     */
    formatNumber(num) {
      if (isNaN(num)) return '0';
      return num.toLocaleString();
    },
    
    /**
     * Convert seconds to minutes and seconds display
     * @param {number} seconds - Seconds to format
     * @returns {string} Formatted time string (MM:SS)
     */
    formatTime(seconds) {
      if (isNaN(seconds) || seconds < 0) return '0:00';
      
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    },
    
    /**
     * Convert milliseconds to seconds
     * @param {number} ms - Milliseconds to convert
     * @returns {number} Seconds (rounded)
     */
    msToSeconds(ms) {
      return Math.round(ms / 1000);
    },
    
    /**
     * Convert seconds to milliseconds
     * @param {number} s - Seconds to convert
     * @returns {number} Milliseconds
     */
    secondsToMs(s) {
      return s * 1000;
    },
    
    /**
     * Convert minutes to milliseconds
     * @param {number} m - Minutes to convert
     * @returns {number} Milliseconds
     */
    minutesToMs(m) {
      return m * 60 * 1000;
    },
    
    /**
     * Check if a value is within a specific range
     * @param {number} value - Value to check
     * @param {number} min - Minimum allowed value
     * @param {number} max - Maximum allowed value
     * @returns {boolean} True if within range
     */
    isInRange(value, min, max) {
      return value >= min && value <= max;
    },
    
    /**
     * Log a message only in development environments
     * @param {string} message - Message to log
     * @param {any} data - Optional data to log
     */
    devLog(message, data) {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (data !== undefined) {
          console.log(`🔧 DEV: ${message}`, data);
        } else {
          console.log(`🔧 DEV: ${message}`);
        }
      }
    },
    
    /**
     * Set up console logging with timestamps
     * Useful for debugging to see when things happen
     */
    setupTimestampedLogs() {
      // Store the original console methods
      const originalLog = console.log;
      const originalWarn = console.warn;
      const originalError = console.error;
      
      // Add timestamps to log messages
      console.log = function() {
        const args = Array.from(arguments);
        const timestamp = new Date().toISOString().substr(11, 8); // HH:MM:SS
        originalLog.apply(console, [`[${timestamp}]`, ...args]);
      };
      
      console.warn = function() {
        const args = Array.from(arguments);
        const timestamp = new Date().toISOString().substr(11, 8); // HH:MM:SS
        originalWarn.apply(console, [`[${timestamp}]`, ...args]);
      };
      
      console.error = function() {
        const args = Array.from(arguments);
        const timestamp = new Date().toISOString().substr(11, 8); // HH:MM:SS
        originalError.apply(console, [`[${timestamp}]`, ...args]);
      };
    },
    
    /**
     * Check if we're running in production environment
     * @returns {boolean} True if in production
     */
    isProduction() {
      return window.location.hostname.includes('ext-twitch.tv');
    },
    
    /**
     * Show visual toast notification for users
     * @param {string} message - Message to display
     * @param {string} type - 'success', 'error', or 'info'
     * @param {number} duration - Duration in milliseconds
     */
    showToast(message, type = 'info', duration = 3000) {
      // Create toast container if it doesn't exist
      let toastContainer = document.getElementById('toast-container');
      
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.position = 'fixed';
        toastContainer.style.top = '20px';
        toastContainer.style.right = '20px';
        toastContainer.style.zIndex = '9999';
        document.body.appendChild(toastContainer);
      }
      
      // Create the toast element
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.style.padding = '10px 20px';
      toast.style.marginBottom = '10px';
      toast.style.backgroundColor = type === 'success' ? '#4CAF50' : 
                                   type === 'error' ? '#F44336' : '#2196F3';
      toast.style.color = 'white';
      toast.style.borderRadius = '4px';
      toast.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
      toast.style.minWidth = '200px';
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease-in-out';
      toast.textContent = message;
      
      // Add the toast to the container
      toastContainer.appendChild(toast);
      
      // Fade in
      setTimeout(() => {
        toast.style.opacity = '1';
      }, 10);
      
      // Remove the toast after the specified duration
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
          toastContainer.removeChild(toast);
        }, 300);
      }, duration);
    }
  };
  
  /**
   * ====================================
   * SECTION 8: Application Initialization
   * ====================================
   * The main entry point that initializes all components.
   * Handles the startup sequence and error recovery.
   */
  
  /**
   * Main application initialization
   * Loads all components in the correct order
   */
  function initializeApplication() {
    console.log("🚀 Starting application initialization");
    
    // Enable timestamp logging in development
    if (!Utils.isProduction()) {
      Utils.setupTimestampedLogs();
      console.log("🔧 Development mode with timestamped logs enabled");
    }
    
    try {
      // Initialize state (load any saved state from localStorage)
      TriviaState.loadFromLocalStorage();
      console.log("✅ State initialized");
      
      // Initialize Twitch integration
      TwitchService.init();
      console.log("✅ Twitch integration initialized");
      
      // Initialize UI components
      UI.init();
      console.log("✅ UI components initialized");
      
      // Initialize event handlers
      EventHandlers.init();
      console.log("✅ Event handlers initialized");
      
      // Add special development tools if in local environment
      if (!Utils.isProduction()) {
        addDevelopmentTools();
      }
      
      console.log("🎉 Application initialization complete");
    } catch (error) {
      console.error("❌ Failed to initialize application:", error);
      
      // Show error message to user
      const statusEl = document.getElementById(CONFIG.DOM_IDS.statusDisplay);
      if (statusEl) {
        statusEl.textContent = "Error initializing application. Please refresh the page.";
        statusEl.style.color = "#ff4444";
      }
      
      // Try to recover what we can
      attemptRecovery();
    }
  }
  
  /**
   * Attempt to recover from initialization errors
   */
  function attemptRecovery() {
    console.log("🔄 Attempting error recovery");
    
    try {
      // At minimum, try to set up basic UI
      const saveSettingsBtn = document.getElementById(CONFIG.DOM_IDS.saveSettings);
      if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener("click", () => {
          const answerTimeInput = document.getElementById(CONFIG.DOM_IDS.answerTime);
          const intervalTimeInput = document.getElementById(CONFIG.DOM_IDS.intervalTime);
          
          if (answerTimeInput && intervalTimeInput) {
            const settings = {
              answerTime: parseInt(answerTimeInput.value, 10) * 1000,
              intervalTime: parseInt(intervalTimeInput.value, 10) * 60000
            };
            
            // Try to use ApiService if available, otherwise fetch directly
            if (typeof ApiService !== 'undefined') {
              ApiService.saveSettings(settings);
            } else {
              fetch(`${CONFIG.API_BASE_URL()}/update-settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
              });
            }
          }
        });
      }
      
      console.log("✅ Basic recovery complete");
    } catch (recoveryError) {
      console.error("❌ Recovery failed:", recoveryError);
    }
  }
  
  /**
   * Add development-specific tools and helpers
   * Only used in local development environment
   */
  function addDevelopmentTools() {
    console.log("🛠️ Adding development tools");
    
    // Add a dev helper menu
    const devTools = document.createElement('div');
    devTools.id = 'dev-tools';
    devTools.style.position = 'fixed';
    devTools.style.left = '10px';
    devTools.style.bottom = '10px';
    devTools.style.padding = '10px';
    devTools.style.background = 'rgba(0,0,0,0.8)';
    devTools.style.color = '#fff';
    devTools.style.borderRadius = '5px';
    devTools.style.zIndex = '9999';
    devTools.style.fontSize = '12px';
    devTools.innerHTML = `
      <div style="margin-bottom:8px"><strong>Dev Tools</strong></div>
      <button id="dev-reset-state" style="margin:2px;padding:5px">Reset State</button>
      <button id="dev-log-state" style="margin:2px;padding:5px">Log State</button>
    `;
    
    document.body.appendChild(devTools);
    
    // Add event handlers
    document.getElementById('dev-reset-state').addEventListener('click', () => {
      TriviaState.clearSavedState();
      console.log("🧹 State cleared. Reloading...");
      setTimeout(() => window.location.reload(), 500);
    });
    
    document.getElementById('dev-log-state').addEventListener('click', () => {
      console.log("📊 Current state:", TriviaState.data);
    });
  }
  
  // Initialize the application when the DOM is ready
  document.addEventListener("DOMContentLoaded", initializeApplication);