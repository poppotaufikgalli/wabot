const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_isp_bot',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDB() {
    try {
        const connection = await pool.getConnection();
        console.log('Connected to MySQL database');
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(255),
                role ENUM('admin', 'user') DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS chat_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                phone VARCHAR(50),
                pushname VARCHAR(255),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                \`key\` VARCHAR(255) NOT NULL UNIQUE,
                \`value\` TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        
        // Check if there is an admin user, if not create one
        const [rows] = await connection.query('SELECT * FROM users WHERE username = ?', ['admin']);
        if (rows.length === 0) {
            const bcrypt = require('bcrypt');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await connection.query(
                'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
                ['admin', hashedPassword, 'Administrator', 'admin']
            );
            console.log('Default admin user created (admin/admin123)');
        }

        // Initialize default settings
        const [settingRows] = await connection.query('SELECT * FROM settings WHERE \`key\` = ?', ['bot_mode']);
        if (settingRows.length === 0) {
            await connection.query('INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)', ['bot_mode', 'manual']);
            console.log('Default bot_mode set to manual');
        }
        
        connection.release();
    } catch (err) {
        console.error('Error connecting to MySQL:', err.message);
    }
}

module.exports = { pool, initDB };
