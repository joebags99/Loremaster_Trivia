// Create a file called fix-usernames.js in your backend directory

require('dotenv').config();
const { Sequelize } = require('sequelize');
const usernameResolver = require('./username-resolver');

// Initialize database connection
const sequelize = new Sequelize({
  dialect: 'mysql',
  host: process.env.DB_HOST,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  logging: false
});

/**
 * Main function to fix usernames in the database
 */
async function fixUsernames() {
  try {
    console.log("🔧 Starting username fix process...");
    
    // Test database connection
    await sequelize.authenticate();
    console.log("✅ Database connection established");
    
    // First, let's clean up any duplicate user IDs (with and without 'U' prefix)
    await cleanupDuplicates();
    
    // Then update missing usernames
    const count = await usernameResolver.updateDatabaseUsernames();
    console.log(`✅ Updated ${count} usernames`);
    
    // Display some stats
    await printStats();
    
    console.log("✅ Username fix process completed");
  } catch (error) {
    console.error("❌ Error in fix process:", error);
  } finally {
    // Close the database connection
    await sequelize.close();
  }
}

/**
 * Clean up duplicate user IDs (with and without 'U' prefix)
 */
async function cleanupDuplicates() {
  try {
    console.log("🔍 Checking for duplicate user IDs...");
    
    // Find user IDs with 'U' prefix
    const [prefixedUsers] = await sequelize.query(
      "SELECT userId FROM user_scores WHERE userId LIKE 'U%' AND userId REGEXP '^U[0-9]+$'",
      { type: sequelize.QueryTypes.SELECT }
    );
    
    if (!prefixedUsers || prefixedUsers.length === 0) {
      console.log("✅ No user IDs with 'U' prefix found");
      return;
    }
    
    console.log(`🔍 Found ${prefixedUsers.length} user IDs with 'U' prefix`);
    
    // Process each prefixed user ID
    let mergedCount = 0;
    
    for (const user of prefixedUsers) {
      const prefixedId = user.userId;
      const cleanId = usernameResolver.cleanUserId(prefixedId);
      
      // Check if both versions exist
      const [duplicateCheck] = await sequelize.query(
        "SELECT userId FROM user_scores WHERE userId = ?",
        { 
          replacements: [cleanId],
          type: sequelize.QueryTypes.SELECT
        }
      );
      
      if (duplicateCheck) {
        console.log(`🔄 Found duplicate IDs: ${prefixedId} and ${cleanId}, merging...`);
        
        // Get both records
        const [prefixedRecord] = await sequelize.query(
          "SELECT score, username, lastUpdated FROM user_scores WHERE userId = ?",
          { 
            replacements: [prefixedId],
            type: sequelize.QueryTypes.SELECT
          }
        );
        
        const [cleanRecord] = await sequelize.query(
          "SELECT score, username, lastUpdated FROM user_scores WHERE userId = ?",
          { 
            replacements: [cleanId],
            type: sequelize.QueryTypes.SELECT
          }
        );
        
        // Decide which values to keep
        const totalScore = (prefixedRecord?.score || 0) + (cleanRecord?.score || 0);
        const username = cleanRecord?.username || prefixedRecord?.username || null;
        
        // Keep the more recent lastUpdated
        let lastUpdated = new Date();
        if (prefixedRecord?.lastUpdated && cleanRecord?.lastUpdated) {
          lastUpdated = new Date(prefixedRecord.lastUpdated) > new Date(cleanRecord.lastUpdated) 
            ? prefixedRecord.lastUpdated 
            : cleanRecord.lastUpdated;
        } else if (prefixedRecord?.lastUpdated) {
          lastUpdated = prefixedRecord.lastUpdated;
        } else if (cleanRecord?.lastUpdated) {
          lastUpdated = cleanRecord.lastUpdated;
        }
        
        // Update the clean record
        await sequelize.query(
          "UPDATE user_scores SET score = ?, username = ?, lastUpdated = ? WHERE userId = ?",
          { 
            replacements: [totalScore, username, lastUpdated, cleanId],
            type: sequelize.QueryTypes.UPDATE
          }
        );
        
        // Delete the prefixed record
        await sequelize.query(
          "DELETE FROM user_scores WHERE userId = ?",
          { 
            replacements: [prefixedId],
            type: sequelize.QueryTypes.DELETE
          }
        );
        
        console.log(`✅ Merged ${prefixedId} into ${cleanId}, total score: ${totalScore}`);
        mergedCount++;
      } else {
        // Just update the ID to remove the prefix
        await sequelize.query(
          "UPDATE user_scores SET userId = ? WHERE userId = ?",
          { 
            replacements: [cleanId, prefixedId],
            type: sequelize.QueryTypes.UPDATE
          }
        );
        console.log(`✅ Updated ${prefixedId} to ${cleanId}`);
        mergedCount++;
      }
    }
    
    console.log(`✅ Processed ${mergedCount} user IDs with 'U' prefix`);
  } catch (error) {
    console.error("❌ Error cleaning up duplicates:", error);
  }
}

/**
 * Print statistics about the database
 */
async function printStats() {
  try {
    console.log("📊 Database statistics:");
    
    // Total users
    const [userCount] = await sequelize.query(
      "SELECT COUNT(*) as count FROM user_scores",
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(`Total users: ${userCount.count}`);
    
    // Users with usernames
    const [usernameCount] = await sequelize.query(
      "SELECT COUNT(*) as count FROM user_scores WHERE username IS NOT NULL AND username != ''",
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(`Users with usernames: ${usernameCount.count} (${Math.round(usernameCount.count / userCount.count * 100)}%)`);
    
    // Users with 'U' prefix
    const [prefixCount] = await sequelize.query(
      "SELECT COUNT(*) as count FROM user_scores WHERE userId LIKE 'U%'",
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log(`Users with 'U' prefix: ${prefixCount.count}`);
    
    // Top scores
    const [topScores] = await sequelize.query(
      "SELECT userId, username, score FROM user_scores ORDER BY score DESC LIMIT 5",
      { type: sequelize.QueryTypes.SELECT }
    );
    console.log("Top scores:");
    topScores.forEach((user, index) => {
      console.log(`${index + 1}. ${user.username || user.userId}: ${user.score}`);
    });
  } catch (error) {
    console.error("❌ Error printing stats:", error);
  }
}

// Run the fix process
fixUsernames()
  .then(() => {
    console.log("🏁 Script completed");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });