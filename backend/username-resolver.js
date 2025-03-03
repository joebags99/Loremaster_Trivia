// Create a file called username-resolver.js in your backend directory
require('dotenv').config();
const axios = require('axios');
const { Sequelize } = require('sequelize');
const sequelize = new Sequelize({
  dialect: 'mysql',
  host: process.env.DB_HOST,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  logging: false
});

// Simple cache to avoid excessive API calls
const usernameCache = new Map();

/**
 * Gets a Twitch OAuth token for API access
 */
async function getTwitchOAuthToken() {
  try {
    console.log("🔑 Requesting Twitch OAuth token...");
    
    // Check required environment variables
    if (!process.env.EXT_CLIENT_ID || !process.env.CLIENT_SECRET) {
      console.error("❌ Missing required environment variables for Twitch OAuth");
      return null;
    }
    
    // Create form data for token request
    const formData = new URLSearchParams();
    formData.append('client_id', process.env.EXT_CLIENT_ID);
    formData.append('client_secret', process.env.CLIENT_SECRET);
    formData.append('grant_type', 'client_credentials');
    
    const response = await axios.post(
      'https://id.twitch.tv/oauth2/token',
      formData.toString(),
      { 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    console.log("✅ Twitch OAuth Token received successfully");
    return response.data.access_token;
  } catch (error) {
    console.error("❌ Error getting Twitch OAuth token:", error.response?.data || error.message);
    return null;
  }
}

/**
 * Cleans user IDs by removing 'U' prefix if present
 */
function cleanUserId(userId) {
  if (!userId) return userId;
  
  // Convert to string if not already
  userId = String(userId);
  
  // Remove 'U' prefix if present
  if (userId.startsWith('U') && /^U\d+$/.test(userId)) {
    return userId.substring(1);
  }
  
  return userId;
}

/**
 * Resolves a user ID to a username using Twitch API
 * - Tries both original and cleaned ID formats
 * - Updates database and memory cache
 */
async function resolveUsername(userId) {
  if (!userId) return null;
  
  // Check cache first (for both formats)
  const originalId = userId;
  const cleanId = cleanUserId(userId);
  
  if (usernameCache.has(originalId)) {
    return usernameCache.get(originalId);
  }
  if (usernameCache.has(cleanId) && cleanId !== originalId) {
    return usernameCache.get(cleanId);
  }
  
  // Check database next
  try {
    const [rows] = await sequelize.query(
      "SELECT username FROM user_scores WHERE userId = ? OR userId = ? LIMIT 1",
      { 
        replacements: [originalId, cleanId],
        type: sequelize.QueryTypes.SELECT
      }
    );
    
    if (rows && rows.username) {
      console.log(`📂 Found username in database: ${rows.username} for ${userId}`);
      
      // Save to cache
      usernameCache.set(originalId, rows.username);
      if (cleanId !== originalId) {
        usernameCache.set(cleanId, rows.username);
      }
      
      return rows.username;
    }
  } catch (dbError) {
    console.error(`❌ Database error checking username for ${userId}:`, dbError);
  }
  
  // Try Twitch API as last resort
  try {
    const token = await getTwitchOAuthToken();
    if (!token) {
      console.error('❌ Failed to get Twitch OAuth token');
      return null;
    }
    
    // Try with clean ID (Twitch IDs are numeric)
    const queryParams = new URLSearchParams();
    queryParams.append('id', cleanId);
    
    console.log(`🔍 Fetching username from Twitch API for ID: ${cleanId}`);
    
    const response = await axios.get(
      `https://api.twitch.tv/helix/users?${queryParams.toString()}`,
      {
        headers: {
          'Client-ID': process.env.EXT_CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      const username = response.data.data[0].display_name;
      console.log(`✅ Retrieved username from Twitch API: ${username} for ID ${cleanId}`);
      
      // Save to cache
      usernameCache.set(originalId, username);
      usernameCache.set(cleanId, username);
      
      // Save to database
      try {
        await sequelize.query(
          "UPDATE user_scores SET username = ? WHERE userId = ? OR userId = ?",
          { 
            replacements: [username, originalId, cleanId],
            type: sequelize.QueryTypes.UPDATE
          }
        );
        console.log(`📝 Updated username in database for ${originalId}/${cleanId}`);
      } catch (updateError) {
        console.error(`❌ Error updating username in database:`, updateError);
      }
      
      return username;
    } else {
      console.warn(`⚠️ No user found on Twitch API for ID ${cleanId}`);
      return null;
    }
  } catch (apiError) {
    console.error(`❌ Error fetching username from Twitch API for ${userId}:`, 
                  apiError.response?.data || apiError.message);
    return null;
  }
}

/**
 * Batch resolves multiple user IDs to usernames
 */
async function batchResolveUsernames(userIds) {
  const results = {};
  
  // Process in batches to avoid overwhelming the API
  const batchSize = 10;
  const batches = [];
  
  for (let i = 0; i < userIds.length; i += batchSize) {
    batches.push(userIds.slice(i, i + batchSize));
  }
  
  for (const batch of batches) {
    const promises = batch.map(async (userId) => {
      const username = await resolveUsername(userId);
      if (username) {
        results[userId] = username;
      }
    });
    
    await Promise.all(promises);
  }
  
  return results;
}

/**
 * Bulk updates database with usernames
 */
async function updateDatabaseUsernames() {
  try {
    console.log("🔄 Starting bulk username update...");
    
    // Get all users without usernames
    const [rows] = await sequelize.query(
      "SELECT userId FROM user_scores WHERE username IS NULL OR username = '' LIMIT 100",
      { type: sequelize.QueryTypes.SELECT }
    );
    
    if (!rows || rows.length === 0) {
      console.log("✅ No missing usernames found in database");
      return 0;
    }
    
    console.log(`🔍 Found ${rows.length} users without usernames, resolving...`);
    const userIds = rows.map(row => row.userId);
    const resolved = await batchResolveUsernames(userIds);
    
    console.log(`✅ Resolved ${Object.keys(resolved).length} usernames out of ${userIds.length}`);
    return Object.keys(resolved).length;
  } catch (error) {
    console.error("❌ Error in bulk username update:", error);
    return 0;
  }
}

// Export functions for use in other files
module.exports = {
  resolveUsername,
  batchResolveUsernames,
  updateDatabaseUsernames,
  cleanUserId
};