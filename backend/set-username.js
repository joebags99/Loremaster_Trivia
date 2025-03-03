// Add this to a file called 'set-username.js' in your backend directory

require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');

// Initialize database connection from existing environment variables
const sequelize = new Sequelize({
  dialect: 'mysql',
  host: process.env.DB_HOST,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  logging: false
});

// Define Score model (same as in server.js)
const Score = sequelize.define("Score", {
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  lastUpdated: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: Sequelize.NOW
  }
}, {
  tableName: "user_scores",
  timestamps: true,
  updatedAt: "lastUpdated"
});

// Function to set a username for a specific user ID
async function setUsername(userId, username) {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    
    // Check if user ID has a 'U' prefix and remove it
    let cleanId = userId;
    if (userId.startsWith('U') && /^U\d+$/.test(userId)) {
      cleanId = userId.substring(1);
      console.log(`Cleaned user ID from ${userId} to ${cleanId}`);
    }
    
    // Check both versions of the ID
    const idsToCheck = [userId, cleanId];
    
    for (const id of idsToCheck) {
      // Try to find the user
      const record = await Score.findByPk(id);
      
      if (record) {
        // Update username
        record.username = username;
        await record.save();
        console.log(`✅ Updated username for ${id} to "${username}"`);
      } else {
        // If no record, create one with 0 score
        await Score.create({
          userId: id,
          username: username,
          score: 0,
          lastUpdated: new Date()
        });
        console.log(`✅ Created new record for ${id} with username "${username}"`);
      }
    }
    
    console.log('✅ Operation completed successfully');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    // Close the connection
    await sequelize.close();
  }
}

// Your user ID and desired username
const userId = process.argv[2] || '70361469';  // Default to your ID if none provided
const username = process.argv[3] || 'YourTwitchName';  // Default name if none provided

// Execute the function
setUsername(userId, username)
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });