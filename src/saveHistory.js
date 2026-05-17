const { pool } = require('./db');

/**
 * Saves conversation to MySQL database
 */
async function saveHistory(userId, role, content, phone = '', pushname = 'bot') {
    try {
        await pool.query(
            'INSERT INTO chat_history (user_id, role, content, phone, pushname) VALUES (?, ?, ?, ?, ?)',
            [userId, role, content, phone, pushname]
        );
    } catch (err) {
        console.error('Error saving history to database:', err);
    }
}

module.exports = { saveHistory };